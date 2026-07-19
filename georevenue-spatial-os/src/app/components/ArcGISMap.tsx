"use client";

import { useEffect, useRef, useState } from "react";
import { API_KEY, ensureEsriReady } from "../lib/arcgis-auth";
import { api, type ActiveArcgisLayer } from "../lib/api";
import { Loader } from "../lib/shared";

export interface ArcGISFeatureSelection {
  objectId: number;
  longitude: number;
  latitude: number;
  recordType: string;
  recordTypeId: number | null;
  layerTitle: string;
  attributes: Record<string, unknown>;
}

export type LayerLoadState = "loading" | "ready" | "failed";

export interface LayerStatus {
  itemId: string;
  state: LayerLoadState;
  /** Set when state === "failed". */
  error?: string;
  /** Populated once the layer's own queryExtent has completed. */
  featureCount?: number;
}

export interface ArcGISMapProps {
  zoom?: number;
  center?: [number, number];
  basemap?: string;
  className?: string;
  showControls?: boolean;
  pins?: { lng: number; lat: number; label?: string; color?: string }[];
  /** Receive parcel/feature selection when the user clicks a feature layer. */
  onSelectFeature?: (selection: ArcGISFeatureSelection) => void;
  /**
   * Per-layer load state reporter. Fires "loading" when the layer is added,
   * then "ready" or "failed" once the ArcGIS runtime tries to load it. The
   * sidebar uses this to tell the user when a layer's counts are cached-only
   * because the actual FeatureLayer failed to render.
   */
  onLayerStatus?: (status: LayerStatus) => void;
  /** Skip the server-driven attached-layer load (e.g. in the record detail map). */
  hideAttachedLayers?: boolean;
  /** Per-layer visibility, keyed by ArcGIS itemId. Layers default to visible. */
  layerVisibility?: Record<string, boolean>;
  /**
   * OBJECTID → record health. When provided, ArcGIS feature layers render
   * each polygon coloured by the financial state of the linked taxpayer
   * record (paid / outstanding / pending / inactive), with a neutral fill
   * for unlinked features.
   */
  recordsByObjectId?: Record<number, "paid" | "outstanding" | "pending" | "inactive">;
  /**
   * Free-text search term. When non-empty, attached layers are queried with
   * a generic LIKE across their string fields; first hit is zoomed-to and
   * passed to `onSelectFeature`. Empty string clears the highlight.
   */
  searchQuery?: string;
  onReady?: (ctx: { view: ArcGISView; map: unknown }) => void;
}

interface FeatureLayerHandle {
  visible: boolean;
  id?: string;
  renderer?: unknown;
  /** WHERE clause applied to every fetch — null/"" means "all features". */
  definitionExpression?: string | null;
  popupEnabled?: boolean;
  /** Available after load() resolves */
  fields?: { name: string; type: string; alias?: string }[];
  /** Load promise so we can await metadata + token registration */
  load?: () => Promise<unknown>;
  /** Returns matching features (with geometry + attributes) */
  queryFeatures?: (q: {
    where: string;
    outFields?: string[];
    returnGeometry?: boolean;
    num?: number;
  }) => Promise<{
    features: {
      attributes: Record<string, unknown>;
      geometry?: {
        type?: string;
        longitude?: number;
        latitude?: number;
        extent?: { center?: { longitude: number; latitude: number } };
      };
    }[];
  }>;
}

interface ArcGISMapInstance {
  basemap: unknown;
  add: (layer: unknown) => void;
}

interface ArcGISHitResult {
  graphic: {
    layer: { id: string };
    attributes: Record<string, unknown>;
    geometry: { type: string; longitude?: number; latitude?: number; extent?: { center?: { longitude: number; latitude: number } } };
  };
}

interface ArcGISView {
  destroy: () => void;
  zoom: number;
  goTo: (target: unknown) => Promise<unknown>;
  when: () => Promise<void>;
  map: ArcGISMapInstance;
  on: (
    event: "click",
    cb: (event: { mapPoint: { longitude: number; latitude: number } }) => void,
  ) => { remove: () => void };
  hitTest: (point: unknown) => Promise<{ results: ArcGISHitResult[] }>;
}

type ThemeMode = "light" | "dark";

function readThemeFromDom(): ThemeMode {
  if (typeof document === "undefined") return "light";
  const el = document.querySelector("[data-theme]");
  return el?.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function useTheme(): ThemeMode {
  const [theme, setTheme] = useState<ThemeMode>(readThemeFromDom);

  useEffect(() => {
    const target = document.querySelector("[data-theme]");
    if (!target) return;
    const update = () => setTheme(readThemeFromDom());
    update();
    const observer = new MutationObserver(update);
    observer.observe(target, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

/** Status colour palette — kept in sync with shared.HEALTH_COLORS. */
const HEALTH_FILL: Record<string, [number, number, number, number]> = {
  paid:        [16, 185, 129, 0.32],   // green
  outstanding: [239, 68, 68, 0.34],    // red
  pending:     [245, 158, 11, 0.32],   // amber
  inactive:    [156, 163, 175, 0.26],  // grey
  unlinked:    [37, 99, 235, 0.10],    // primary @ 10% — neutral
};
const HEALTH_STROKE: Record<string, [number, number, number, number]> = {
  paid:        [16, 185, 129, 0.95],
  outstanding: [239, 68, 68, 0.95],
  pending:     [245, 158, 11, 0.95],
  inactive:    [156, 163, 175, 0.85],
  unlinked:    [37, 99, 235, 0.55],
};

function symbolFor(geometryType: string | null | undefined, key: string) {
  const gt = (geometryType || "").toLowerCase();
  const fill = HEALTH_FILL[key] ?? HEALTH_FILL.unlinked;
  const stroke = HEALTH_STROKE[key] ?? HEALTH_STROKE.unlinked;
  if (gt.includes("polygon")) {
    return {
      type: "simple-fill",
      color: fill,
      outline: { color: stroke, width: 1.2 },
    };
  }
  if (gt.includes("line")) {
    return { type: "simple-line", color: stroke, width: 2 };
  }
  return {
    type: "simple-marker",
    color: stroke,
    size: 8,
    outline: { color: "#ffffff", width: 1 },
  };
}

/**
 * Build a UniqueValueRenderer that colours each feature by the health of
 * its linked taxpayer record. The OID itself is the value field; we generate
 * one infos entry per OID we know about, and the default symbol catches
 * unlinked features.
 */
function healthRenderer(
  geometryType: string | null | undefined,
  objectIdField: string,
  recordsByObjectId: Record<number, string>,
): Record<string, unknown> {
  const uniqueValueInfos = Object.entries(recordsByObjectId).map(
    ([oid, health]) => ({
      value: Number(oid),
      symbol: symbolFor(geometryType, health),
    }),
  );
  return {
    type: "unique-value",
    field: objectIdField || "OBJECTID",
    defaultSymbol: symbolFor(geometryType, "unlinked"),
    defaultLabel: "Unlinked",
    uniqueValueInfos,
  };
}

/** Default renderer per geometry type so polygons/lines/points are clearly visible. */
function rendererFor(geometryType: string | null | undefined): Record<string, unknown> {
  switch ((geometryType || "").toLowerCase()) {
    case "esrigeometrypolygon":
    case "polygon":
      return {
        type: "simple",
        symbol: {
          type: "simple-fill",
          color: [37, 99, 235, 0.18], // var(--primary) @ 18%
          outline: { color: [37, 99, 235, 0.9], width: 1.2 },
        },
      };
    case "esrigeometrypolyline":
    case "polyline":
      return {
        type: "simple",
        symbol: { type: "simple-line", color: [6, 182, 212, 0.95], width: 2 },
      };
    case "esrigeometrypoint":
    case "point":
    default:
      return {
        type: "simple",
        symbol: {
          type: "simple-marker",
          color: [16, 185, 129, 0.9],
          size: 7,
          outline: { color: "#ffffff", width: 1 },
        },
      };
  }
}

/**
 * Extract a useful message from an ArcGIS SDK error. ArcGIS wraps HTTP/token
 * failures in an Error whose stringification is just "[object Object]" — the
 * real detail lives on `.name`, `.details.messages`, or `.details.error`.
 */
function describeArcgisError(err: unknown, layerTitle: string): string {
  if (!err || typeof err !== "object") return `Layer "${layerTitle}" failed to load`;
  const e = err as {
    name?: string;
    message?: string;
    details?: {
      messages?: string[];
      httpStatus?: number;
      url?: string;
      error?: { code?: number; message?: string; details?: string[] };
    };
  };
  const parts: string[] = [];
  if (e.name && e.name !== "Error") parts.push(e.name);
  if (e.message) parts.push(e.message);
  const nested = e.details?.error?.message;
  if (nested && !e.message?.includes(nested)) parts.push(nested);
  const inner = e.details?.messages?.filter(Boolean).join("; ");
  if (inner && !parts.join(" ").includes(inner)) parts.push(inner);
  const status = e.details?.httpStatus;
  if (status) parts.push(`HTTP ${status}`);
  if (!parts.length) return `Layer "${layerTitle}" failed to load`;
  return parts.join(" · ");
}

function pickBasemapId(theme: ThemeMode, override?: string): string {
  if (override) return override;
  if (API_KEY) {
    return theme === "dark" ? "arcgis-dark-gray" : "arcgis-light-gray";
  }
  return theme === "dark" ? "dark-gray-vector" : "gray-vector";
}

export function ArcGISMap({
  zoom = 11,
  center = [36.8219, -1.2921],
  basemap,
  className = "",
  showControls = true,
  pins = [],
  onSelectFeature,
  onLayerStatus,
  hideAttachedLayers = false,
  layerVisibility,
  recordsByObjectId,
  searchQuery,
  onReady,
}: ArcGISMapProps) {
  // Ref pattern so status changes reach the parent even if the effect ran
  // before the callback prop was stable across renders.
  const onLayerStatusRef = useRef(onLayerStatus);
  onLayerStatusRef.current = onLayerStatus;
  const containerRef = useRef<HTMLDivElement>(null);
  const galleryRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ArcGISView | null>(null);
  const galleryWidgetRef = useRef<{ destroy?: () => void } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showGallery, setShowGallery] = useState(false);
  const theme = useTheme();
  const themeRef = useRef<ThemeMode>(theme);
  themeRef.current = theme;
  // Keep the latest callback in a ref so re-renders don't tear down the map
  const onSelectFeatureRef = useRef(onSelectFeature);
  onSelectFeatureRef.current = onSelectFeature;
  // Map of itemId → FeatureLayer instance, so we can flip visibility / renderer
  // without re-initialising the whole view when props change.
  const featureLayersByItemRef = useRef<Record<string, FeatureLayerHandle>>({});
  // Parallel cache of the layer metadata so the renderer effect knows each
  // layer's geometry type + objectIdField without re-fetching.
  const activeMetaByItemRef = useRef<Record<string, ActiveArcgisLayer>>({});
  // Tracks which layer is currently being narrowed to a single search hit so
  // we can clear the definitionExpression when the user empties the search.
  const activeFilterItemRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    const init = async () => {
      try {
        await ensureEsriReady();
        if (cancelled || !containerRef.current) return;

        // Premium Basemap Styles Service requires an API key; named-user
        // tokens registered with IdentityManager don't authenticate against
        // basemapstyles-api.arcgis.com. Fall back to the free vector basemaps.
        const resolvedBasemap = pickBasemapId(themeRef.current, basemap);
        if (cancelled || !containerRef.current) return;

        const modules = await new Promise<unknown[]>((resolve, reject) => {
          if (!window.require) {
            reject(new Error("ArcGIS SDK not loaded"));
            return;
          }
          window.require(
            [
              "esri/Map",
              "esri/views/MapView",
              "esri/Graphic",
              "esri/layers/GraphicsLayer",
              "esri/layers/FeatureLayer",
              "esri/identity/IdentityManager",
            ],
            (...args: unknown[]) => resolve(args),
            (err) => reject(err),
          );
        });

        if (cancelled || !containerRef.current) return;

        const [Map, MapView, Graphic, GraphicsLayer, FeatureLayer, esriId] = modules as [
          new (props: { basemap: string }) => { add: (l: unknown) => void },
          new (props: Record<string, unknown>) => ArcGISView,
          new (props: Record<string, unknown>) => unknown,
          new (props?: Record<string, unknown>) => { add: (g: unknown) => void },
          new (props: Record<string, unknown>) => {
            id?: string;
            when?: () => Promise<unknown>;
            queryExtent?: () => Promise<{ extent: unknown; count: number }>;
          },
          { registerToken: (t: { server: string; token: string; expires?: number }) => void },
        ];

        const map = new Map({ basemap: resolvedBasemap });

        // Attached feature layers — keyed by layer.id so click hits can be mapped back
        const featureLayerMeta: Record<string, ActiveArcgisLayer> = {};
        let pendingExtents: Promise<{ extent: unknown; count: number } | null>[] = [];
        if (!hideAttachedLayers) {
          try {
            const { layers, auth } = await api.admin.arcgisActiveLayers();
            if (cancelled) return;

            // Register the backend token with IdentityManager so private layers load.
            // Register against BOTH the server host and the specific FeatureServer
            // URL of every layer — IdentityManager's server-match is prefix-based
            // and sometimes host-only isn't specific enough for a hosted service.
            if (auth?.token && auth.servers.length) {
              const registrations = new Set<string>(auth.servers);
              for (const meta of layers) {
                if (meta.layerUrl) {
                  // Strip /<layerIndex> so we register against the whole service.
                  const svc = String(meta.layerUrl).replace(/\/\d+$/, "");
                  registrations.add(svc);
                }
              }
              for (const server of registrations) {
                try {
                  esriId.registerToken({
                    server,
                    token: auth.token,
                    expires: auth.expiresAt,
                  });
                } catch {
                  /* tolerate IdentityManager errors */
                }
              }
            }

            for (const meta of layers) {
              try {
                const initialVisible = layerVisibility?.[meta.itemId] ?? true;
                const useHealth = !!recordsByObjectId && Object.keys(recordsByObjectId).length > 0;
                const featureLayer = new FeatureLayer({
                  url: meta.layerUrl,
                  title: meta.title,
                  outFields: ["*"],
                  visible: initialVisible,
                  // Either colour each feature by linked-record health, or fall
                  // back to a generic per-geometry symbol when nothing's linked.
                  renderer: useHealth
                    ? healthRenderer(meta.geometryType, meta.objectIdField, recordsByObjectId!)
                    : rendererFor(meta.geometryType),
                  // Default popup is suppressed — we render selection details
                  // in the sidebar inspector instead. Keeping this in sync with
                  // view.popupEnabled below.
                  popupEnabled: false,
                });
                map.add(featureLayer);
                const id = featureLayer.id;
                if (id) featureLayerMeta[id] = meta;
                featureLayersByItemRef.current[meta.itemId] =
                  featureLayer as unknown as FeatureLayerHandle;
                activeMetaByItemRef.current[meta.itemId] = meta;

                // Signal "loading" now, then flip to "ready"/"failed" once the
                // ArcGIS runtime actually resolves the layer. The parent uses
                // this to distinguish cached counts from live features.
                onLayerStatusRef.current?.({ itemId: meta.itemId, state: "loading" });
                const flAny = featureLayer as unknown as {
                  when?: () => Promise<unknown>;
                  queryExtent?: () => Promise<{ extent: unknown; count: number }>;
                };
                if (flAny.when) {
                  flAny
                    .when()
                    .then(async () => {
                      let count: number | undefined;
                      if (flAny.queryExtent) {
                        try {
                          const ext = await flAny.queryExtent();
                          count = ext?.count;
                        } catch {
                          /* count optional */
                        }
                      }
                      if (!cancelled) {
                        onLayerStatusRef.current?.({
                          itemId: meta.itemId,
                          state: "ready",
                          featureCount: count,
                        });
                      }
                    })
                    .catch((err: unknown) => {
                      if (cancelled) return;
                      // ArcGIS errors nest the real cause in `.details.messages`
                      // or `.details.error.message`. Walk it so the sidebar can
                      // show something useful (token expired, CORS, 404, etc.).
                      const message = describeArcgisError(err, meta.title);
                      console.error(
                        `[ArcGISMap] Layer "${meta.title}" failed to load:`,
                        message,
                        err,
                      );
                      onLayerStatusRef.current?.({
                        itemId: meta.itemId,
                        state: "failed",
                        error: message,
                      });
                    });
                }
                if (featureLayer.queryExtent) {
                  pendingExtents.push(
                    featureLayer
                      .queryExtent()
                      .catch(() => null as { extent: unknown; count: number } | null),
                  );
                }
              } catch (err) {
                onLayerStatusRef.current?.({
                  itemId: meta.itemId,
                  state: "failed",
                  error: err instanceof Error ? err.message : "Layer construction failed",
                });
              }
            }
          } catch (err) {
            console.warn("Could not load attached layers from server:", err);
          }
        }

        const graphicsLayer = new GraphicsLayer();

        for (const pin of pins) {
          const graphic = new Graphic({
            geometry: {
              type: "point",
              longitude: pin.lng,
              latitude: pin.lat,
            },
            symbol: {
              type: "simple-marker",
              color: pin.color ?? "#007ac2",
              size: 10,
              outline: { color: "#ffffff", width: 2 },
            },
            attributes: { label: pin.label ?? "" },
            popupTemplate: pin.label
              ? {
                  title: pin.label,
                  content: `Lat ${pin.lat.toFixed(4)}, Lng ${pin.lng.toFixed(4)}`,
                }
              : undefined,
          });
          graphicsLayer.add(graphic);
        }

        map.add(graphicsLayer);

        const view = new MapView({
          container: containerRef.current,
          map,
          zoom,
          center,
          ui: { components: ["attribution"] },
          constraints: { snapToZoom: false },
          // We render parcel detail in the sidebar inspector — no native popup
          popupEnabled: false,
        });

        viewRef.current = view;
        await view.when();
        if (cancelled) return;

        // Auto-zoom: if any attached feature layer has features, fit the view to
        // their combined extent so hundreds of parcels are visible at once.
        if (pendingExtents.length) {
          Promise.all(pendingExtents)
            .then((results) => {
              if (cancelled) return;
              const extents = results.filter(
                (r): r is { extent: { union?: (e: unknown) => unknown }; count: number } =>
                  !!r && !!r.extent && r.count > 0,
              );
              if (!extents.length) return;
              let union = extents[0].extent;
              for (let i = 1; i < extents.length; i++) {
                try {
                  const next = (union as { union: (e: unknown) => unknown }).union(extents[i].extent);
                  if (next) union = next as typeof union;
                } catch {
                  /* incompatible spatial refs — fall back to first */
                }
              }
              view.goTo(union).catch(() => undefined);
            })
            .catch(() => undefined);
        }

        // Click → hit-test attached layers → emit selection
        const clickHandler = view.on("click", (event) => {
          if (!onSelectFeatureRef.current) return;
          view
            .hitTest(event)
            .then(({ results }) => {
              for (const hit of results) {
                const layerId = hit.graphic?.layer?.id;
                const meta = layerId ? featureLayerMeta[layerId] : undefined;
                if (!meta) continue;
                const attrs = hit.graphic.attributes ?? {};
                const objectIdRaw = attrs[meta.objectIdField] ?? attrs.OBJECTID ?? attrs.objectid;
                const objectId = Number(objectIdRaw);
                if (!Number.isFinite(objectId)) continue;
                const geom = hit.graphic.geometry;
                const longitude =
                  geom?.longitude ?? geom?.extent?.center?.longitude ?? event.mapPoint.longitude;
                const latitude =
                  geom?.latitude ?? geom?.extent?.center?.latitude ?? event.mapPoint.latitude;
                onSelectFeatureRef.current?.({
                  objectId,
                  longitude,
                  latitude,
                  recordType: meta.recordType,
                  recordTypeId: meta.recordTypeId,
                  layerTitle: meta.title,
                  attributes: attrs,
                });
                return;
              }
            })
            .catch(() => undefined);
        });
        cleanups.push(() => clickHandler.remove());

        // If the theme changed mid-init, snap the basemap to the latest value
        const liveBasemap = pickBasemapId(themeRef.current, basemap);
        if (liveBasemap !== resolvedBasemap) {
          view.map.basemap = liveBasemap;
        }
        setStatus("ready");
        onReady?.({ view, map });
      } catch (err) {
        if (cancelled) return;
        console.error("ArcGIS init failed", err);
        setErrorMessage(err instanceof Error ? err.message : "Map failed to initialize");
        setStatus("error");
      }
    };

    init();

    return () => {
      cancelled = true;
      for (const c of cleanups) {
        try {
          c();
        } catch {
          /* noop */
        }
      }
      const v = viewRef.current;
      if (v && typeof v.destroy === "function") {
        try {
          v.destroy();
        } catch {
          /* noop */
        }
      }
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, JSON.stringify(center), JSON.stringify(pins), zoom]);

  // Live basemap swap when the user toggles light/dark — no re-init needed
  useEffect(() => {
    const view = viewRef.current;
    if (!view || status !== "ready") return;
    view.map.basemap = pickBasemapId(theme, basemap);
  }, [theme, basemap, status]);

  // Apply layer-visibility changes without recreating the view
  useEffect(() => {
    if (!layerVisibility) return;
    for (const [itemId, fl] of Object.entries(featureLayersByItemRef.current)) {
      const v = layerVisibility[itemId];
      if (typeof v === "boolean") fl.visible = v;
    }
  }, [layerVisibility]);

  // Reapply per-OBJECTID health colouring when the record map changes —
  // again without recreating the view.
  useEffect(() => {
    if (!recordsByObjectId) return;
    for (const [itemId, fl] of Object.entries(featureLayersByItemRef.current)) {
      const meta = activeMetaByItemRef.current[itemId];
      if (!meta) continue;
      const hasData = Object.keys(recordsByObjectId).length > 0;
      fl.renderer = hasData
        ? healthRenderer(meta.geometryType, meta.objectIdField, recordsByObjectId)
        : rendererFor(meta.geometryType);
    }
  }, [recordsByObjectId]);

  // Helper: drop any active definitionExpression filter (called when the user
  // clears the search or dismisses the inspector).
  const clearSearchFilter = () => {
    const item = activeFilterItemRef.current;
    if (!item) return;
    const fl = featureLayersByItemRef.current[item];
    if (fl) fl.definitionExpression = null;
    activeFilterItemRef.current = null;
  };

  // Search across attached feature layers and zoom to the first hit
  useEffect(() => {
    const term = (searchQuery ?? "").trim();

    // Empty / too-short: clear any active filter, show everything again.
    if (!term || term.length < 2) {
      if (status === "ready") clearSearchFilter();
      return;
    }
    if (status !== "ready") return;

    const view = viewRef.current;
    if (!view) return;

    let cancelled = false;

    const safe = term.replace(/'/g, "''"); // escape for LIKE
    const upperLike = `'%${safe.toUpperCase()}%'`;
    const isNumeric = /^\d+$/.test(term);

    // 350ms debounce keeps queries off the layer on every keystroke
    const t = setTimeout(() => {
      void runSearch();
    }, 350);

    async function runSearch() {
      for (const [itemId, fl] of Object.entries(featureLayersByItemRef.current)) {
        if (cancelled) return;
        const meta = activeMetaByItemRef.current[itemId];
        if (!meta || !fl.queryFeatures) continue;
        try {
          if (fl.load) await fl.load();
          // Build a generic LIKE across every string field plus an OBJECTID
          // exact match if the user typed a number. This is best-effort —
          // some services reject OR expressions on indexed-only fields.
          const stringFieldNames = (fl.fields ?? [])
            .filter((f) => /string|text/i.test(f.type))
            .map((f) => f.name);
          const clauses: string[] = [];
          for (const fname of stringFieldNames) {
            clauses.push(`UPPER(${fname}) LIKE ${upperLike}`);
          }
          if (isNumeric) {
            clauses.push(`${meta.objectIdField || "OBJECTID"} = ${term}`);
          }
          if (clauses.length === 0) continue;
          const where = clauses.join(" OR ");
          const result = await fl.queryFeatures({
            where,
            outFields: ["*"],
            returnGeometry: true,
            num: 1,
          });
          if (cancelled || !result.features.length) continue;
          const hit = result.features[0];
          const objectIdRaw =
            hit.attributes[meta.objectIdField] ??
            hit.attributes.OBJECTID ??
            hit.attributes.objectid;
          const objectId = Number(objectIdRaw);
          if (!Number.isFinite(objectId)) continue;

          // Filter this layer to ONLY the matched feature so every other
          // parcel disappears. Any other layer keeps showing its content.
          // First clear any previous search filter (could be on a different
          // layer), then apply the new one.
          clearSearchFilter();
          const oidField = meta.objectIdField || "OBJECTID";
          fl.definitionExpression = `${oidField} = ${objectId}`;
          activeFilterItemRef.current = meta.itemId;

          // Zoom to the feature
          const geom = hit.geometry;
          const liveView = viewRef.current;
          if (geom && liveView) {
            try {
              await liveView.goTo({ target: geom, zoom: 17 });
            } catch {
              /* feature without renderable geometry */
            }
          }
          // Notify caller so the inspector can open
          const lng =
            geom?.longitude ?? geom?.extent?.center?.longitude ?? 0;
          const lat = geom?.latitude ?? geom?.extent?.center?.latitude ?? 0;
          onSelectFeatureRef.current?.({
            objectId,
            longitude: lng,
            latitude: lat,
            recordType: meta.recordType,
            recordTypeId: meta.recordTypeId,
            layerTitle: meta.title,
            attributes: hit.attributes,
          });
          return;
        } catch (err) {
          console.warn(`Search failed on layer "${meta.title}":`, err);
        }
      }
    }

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [searchQuery, status]);

  // Mount the BasemapGallery widget on demand
  useEffect(() => {
    if (!showGallery || status !== "ready" || !galleryRef.current || !window.require) {
      // tear down on close
      if (!showGallery && galleryWidgetRef.current) {
        try {
          galleryWidgetRef.current.destroy?.();
        } catch {
          /* noop */
        }
        galleryWidgetRef.current = null;
      }
      return;
    }
    let cancelled = false;
    window.require(["esri/widgets/BasemapGallery"], (...args: unknown[]) => {
      if (cancelled) return;
      const [BasemapGallery] = args as [
        new (props: { container: HTMLElement; view: unknown }) => {
          destroy?: () => void;
        },
      ];
      try {
        if (galleryWidgetRef.current) {
          galleryWidgetRef.current.destroy?.();
        }
        galleryWidgetRef.current = new BasemapGallery({
          container: galleryRef.current as HTMLDivElement,
          view: viewRef.current as unknown,
        });
      } catch (err) {
        console.error("BasemapGallery init failed", err);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [showGallery, status]);

  const adjustZoom = (delta: number) => {
    const v = viewRef.current;
    if (!v) return;
    void v.goTo({ zoom: Math.max(0, Math.min(20, v.zoom + delta)) }).catch(() => {
      /* noop */
    });
  };

  const recenter = () => {
    const v = viewRef.current;
    if (!v) return;
    void v.goTo({ center, zoom }).catch(() => {
      /* noop */
    });
  };

  return (
    <div className={`relative isolate h-full w-full overflow-hidden rounded-lg ${className}`}>
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ minHeight: 320 }}
      />
      {status === "loading" && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-[var(--surface)]/70 backdrop-blur-sm">
          <Loader label="Loading ArcGIS map" />
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-x-3 top-3 z-20">
          <calcite-notice open icon="exclamation-mark-triangle" kind="danger" scale="s">
            <div slot="title">Map unavailable</div>
            <div slot="message">{errorMessage ?? "Unknown error"}</div>
          </calcite-notice>
        </div>
      )}
      {showControls && status === "ready" && (
        <div className="pointer-events-none absolute right-3 top-3 z-10 flex flex-col gap-1.5">
          <calcite-action-pad layout="vertical" expand-disabled="true" class="pointer-events-auto">
            <calcite-action
              icon="plus"
              text="Zoom in"
              scale="s"
              onClick={() => adjustZoom(1)}
            />
            <calcite-action
              icon="minus"
              text="Zoom out"
              scale="s"
              onClick={() => adjustZoom(-1)}
            />
            <calcite-action
              icon="extent"
              text="Recenter"
              scale="s"
              onClick={recenter}
            />
            <calcite-action
              icon="basemap"
              text="Basemap"
              scale="s"
              active={showGallery ? "true" : undefined}
              onClick={() => setShowGallery((v) => !v)}
            />
          </calcite-action-pad>
        </div>
      )}
      {showControls && status === "ready" && showGallery && (
        <div className="pointer-events-auto absolute right-14 top-3 z-20 max-h-[calc(100%-1.5rem)] w-[260px] overflow-auto rounded-lg border border-[var(--line)] bg-[var(--panel)] shadow-lg">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2">
            <span className="text-[12.5px] font-semibold">Basemap</span>
            <button
              type="button"
              onClick={() => setShowGallery(false)}
              className="text-[var(--muted)] hover:text-[var(--on-surface)]"
              aria-label="Close basemap gallery"
            >
              ×
            </button>
          </div>
          <div ref={galleryRef} />
        </div>
      )}
    </div>
  );
}

export default ArcGISMap;
