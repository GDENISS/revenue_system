"use client";

import { useEffect, useState } from "react";
import {
  ChevronRight,
  Eye,
  EyeOff,
  Layers as LayersIcon,
  Link2,
  MapPin,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  ArcGISMap,
  type ArcGISFeatureSelection,
  type LayerStatus,
} from "../components/ArcGISMap";
import {
  api,
  ApiError,
  type ActiveArcgisLayer,
  type RecordType,
  type TaxpayerRecord,
  type Zone,
} from "../lib/api";
import {
  HEALTH_COLORS,
  HEALTH_LABELS,
  Icon,
  Loader,
  NAIROBI_CENTER,
  type RecordHealth,
  colorForHealth,
  colorForType,
  formatKesM,
  recordHealth,
  recordTypeLabel,
} from "../lib/shared";
import { AddRecordModal, type AddRecordPrefill } from "./record";


/** Heuristic: try to discover an owner-name field on a parcel feature. */
function findOwnerName(attrs: Record<string, unknown>): string | undefined {
  for (const key of Object.keys(attrs)) {
    if (/^(owner|owner_?name|registered_?owner|taxpayer|holder)$/i.test(key)) {
      const v = attrs[key];
      if (v && String(v).trim()) return String(v).trim();
    }
  }
  return undefined;
}

function MapWorkspace({
  onOpenRecord,
  pendingLink,
  onClearPendingLink,
}: {
  onOpenRecord: (id: number) => void;
  pendingLink: { recordId: number; recordName: string } | null;
  onClearPendingLink: () => void;
}) {
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<TaxpayerRecord[]>([]);
  const [allRecordTypes, setAllRecordTypes] = useState<RecordType[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [arcgisLayers, setArcgisLayers] = useState<ActiveArcgisLayer[]>([]);
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({});
  // Live per-layer status reported by ArcGISMap. "cached" here means the
  // sidebar count came from the DB but the FeatureLayer never rendered — the
  // ArcGIS server is unreachable or the layer was misconfigured.
  const [layerStatuses, setLayerStatuses] = useState<Record<string, LayerStatus>>({});
  const handleLayerStatus = (s: LayerStatus) => {
    setLayerStatuses((prev) => ({ ...prev, [s.itemId]: s }));
  };
  const [selected, setSelected] = useState<TaxpayerRecord | null>(null);
  const [feature, setFeature] = useState<ArcGISFeatureSelection | null>(null);
  // The taxpayer record bound to the selected feature — looked up from the
  // backend by OBJECTID (not the loaded page, which is paginated/searched).
  const [featureRecord, setFeatureRecord] = useState<TaxpayerRecord | null>(null);

  const clearFeature = () => {
    setFeature(null);
    setFeatureRecord(null);
  };
  const [prefill, setPrefill] = useState<AddRecordPrefill | null>(null);
  const [linkTargetFeature, setLinkTargetFeature] = useState<ArcGISFeatureSelection | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load record types, zones, and ArcGIS layers (with featureCount) once
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.records.types(),
      api.zones.list(),
      api.admin.arcgisActiveLayers().catch(() => ({ layers: [], auth: null })),
    ])
      .then(([types, zoneList, active]) => {
        if (cancelled) return;
        setAllRecordTypes(types);
        setZones(zoneList);
        setArcgisLayers(active.layers);
        // Default every layer to visible
        const visMap: Record<string, boolean> = {};
        for (const layer of active.layers) visMap[layer.itemId] = true;
        setLayerVisibility(visMap);
      })
      .catch(() => {
        /* non-fatal */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleLayerVisibility = (itemId: string) =>
    setLayerVisibility((cur) => ({ ...cur, [itemId]: !(cur[itemId] ?? true) }));

  // When user clicks a parcel on the map: if we're in "link this record to a
  // parcel" mode, PATCH the link directly. Otherwise: if a record already
  // binds that OBJECTID, open it; else show the create/link affordance.
  const handleSelectFeature = (sel: ArcGISFeatureSelection) => {
    if (pendingLink) {
      api.records
        .linkFeature(pendingLink.recordId, sel.objectId)
        .then(() => {
          setToast({
            kind: "ok",
            message: `${pendingLink.recordName} linked to OBJECTID ${sel.objectId}.`,
          });
          onClearPendingLink();
          // Refresh local pins so the next click on this parcel opens the record
          return api.records
            .list({ limit: 200, search: query.trim() || undefined })
            .then((res) => setRecords(res.data));
        })
        .catch((err) => {
          setToast({
            kind: "err",
            message:
              err instanceof ApiError
                ? err.message
                : "Could not link record to parcel.",
          });
        });
      return;
    }
    // Show the inspector immediately; resolve the linked record from the
    // backend by OBJECTID so it's correct even when the record isn't in the
    // currently-loaded page.
    setFeature(sel);
    setSelected(null);
    setFeatureRecord(null);
    api.records
      .list({ arcgisObjectId: sel.objectId, limit: 1 })
      .then((res) => setFeatureRecord(res.data[0] ?? null))
      .catch(() => setFeatureRecord(null));
  };

  const startCreateFromFeature = () => {
    if (!feature) return;
    setPrefill({
      taxpayerName: findOwnerName(feature.attributes),
      recordTypeId: feature.recordTypeId ?? undefined,
      arcgisObjectId: feature.objectId,
      attributes: feature.attributes,
      sourceLabel: `${recordTypeLabel(feature.recordType)} parcel`,
    });
  };

  // Load records when query or active types change (debounced lightly via search delay)
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const debounce = setTimeout(() => {
      api.records
        .list({ limit: 200, search: query.trim() || undefined })
        .then((res) => {
          if (cancelled) return;
          setRecords(res.data);
          setError(null);
          if (!selected && res.data.length > 0) {
            setSelected(res.data[0]);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          setError(
            err instanceof ApiError && err.status === 0
              ? `Cannot reach the API (${api.baseUrl}). Is the backend running?`
              : err instanceof Error
                ? err.message
                : "Could not load records.",
          );
        })
        .finally(() => !cancelled && setLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Geometry now lives entirely in ArcGIS. We don't draw pins from Postgres
  // any more — instead we colour each ArcGIS feature by the linked record's
  // health using a UniqueValueRenderer driven by the OBJECTID → health map.
  const recordsByObjectId: Record<number, RecordHealth> = {};
  const healthCounts: Record<RecordHealth, number> = {
    paid: 0,
    outstanding: 0,
    pending: 0,
    inactive: 0,
  };
  let linkedCount = 0;
  let unlinkedCount = 0;
  for (const r of records) {
    if (r.arcgisObjectId != null) {
      const h = recordHealth(r);
      recordsByObjectId[r.arcgisObjectId] = h;
      healthCounts[h] += 1;
      linkedCount += 1;
    } else {
      unlinkedCount += 1;
    }
  }

  // The ArcGIS layer's own extent drives the initial framing now (see the
  // auto-zoom-to-attached-layers logic in ArcGISMap). We just fall back to
  // the county centroid if nothing is attached.
  const center: [number, number] = NAIROBI_CENTER;

  return (
    <section className="grid gap-3 lg:grid-cols-[1fr_320px]">
      {error && (
        <div className="lg:col-span-2">
          <calcite-notice open icon="exclamation-mark-triangle" kind="danger" scale="s" closable onCalciteNoticeClose={() => setError(null)}>
            <div slot="title">Could not load records</div>
            <div slot="message">{error}</div>
          </calcite-notice>
        </div>
      )}
      <div className="glass-panel relative h-[640px] overflow-hidden p-0">
        {pendingLink && (
          <div className="pointer-events-auto absolute inset-x-3 top-3 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--primary)] bg-[var(--primary-container)] px-3 py-2 text-[12.5px] text-[var(--primary)] shadow-md">
            <Link2 className="h-3.5 w-3.5" strokeWidth={2.4} />
            <span>
              <span className="font-semibold">Link mode:</span> click any parcel
              to link it to <strong>{pendingLink.recordName}</strong>.
            </span>
            <button
              type="button"
              className="control ml-auto !h-7 !text-[11px]"
              onClick={onClearPendingLink}
            >
              <X className="h-3 w-3" strokeWidth={2.4} />
              Cancel
            </button>
          </div>
        )}
        <ArcGISMap
          zoom={11}
          center={center}
          layerVisibility={layerVisibility}
          recordsByObjectId={recordsByObjectId}
          searchQuery={query}
          onSelectFeature={handleSelectFeature}
          onLayerStatus={handleLayerStatus}
        />
        <div className="pointer-events-none absolute left-3 right-3 top-3 z-10 flex items-start gap-3">
          <div className="glass-panel pointer-events-auto flex h-10 flex-1 items-center gap-2.5 px-3 md:max-w-[460px]">
            <Icon className="text-[var(--muted)]">search</Icon>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search parcels, owners, OBJECTID…"
              className="flex-1 bg-transparent text-[12.5px] text-[var(--on-surface)] placeholder-[var(--muted)] outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="icon-btn h-6 w-6"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.4} />
              </button>
            )}
          </div>
          {loading && (
            <div className="glass-panel pointer-events-auto flex h-10 items-center gap-2 px-3 text-[12px] text-[var(--muted)]">
              <Loader inline scale="s" />
              Loading…
            </div>
          )}
        </div>
      </div>

      <aside className="flex flex-col gap-3 lg:sticky lg:top-3">
        {/* The sidebar toggles: a selected parcel shows the inspector;
            otherwise the ArcGIS layers + status legend panel. */}
        {feature ? (
          <FeatureInspectorCard
            feature={feature}
            linkedRecord={featureRecord}
            onClose={clearFeature}
            onCreate={startCreateFromFeature}
            onLinkExisting={() => setLinkTargetFeature(feature)}
            onOpenRecord={onOpenRecord}
          />
        ) : (

      <div className="flex flex-col gap-3">
        {/* ── Reachability banner ─────────────────────────────────────
            Any layer reported as "failed" means the ArcGIS server did not
            deliver features even though the DB has cached counts. Surface
            that mismatch instead of letting the sidebar look healthy. */}
        {arcgisLayers.length > 0 &&
          arcgisLayers.some((l) => layerStatuses[l.itemId]?.state === "failed") && (
            <calcite-notice open icon="offline" kind="warning" scale="s">
              <div slot="title">Some layers not reachable</div>
              <div slot="message">
                <div className="space-y-1.5">
                  <p>
                    {(() => {
                      const failed = arcgisLayers.filter(
                        (l) => layerStatuses[l.itemId]?.state === "failed",
                      ).length;
                      return `${failed} of ${arcgisLayers.length} layer${
                        arcgisLayers.length === 1 ? "" : "s"
                      } could not load. Counts below are from the last successful sync.`;
                    })()}
                  </p>
                  <ul className="mt-1 space-y-0.5 text-[11px]">
                    {arcgisLayers
                      .filter((l) => layerStatuses[l.itemId]?.state === "failed")
                      .map((l) => (
                        <li key={l.itemId} className="font-mono">
                          <span className="font-semibold">{l.title}:</span>{" "}
                          <span className="text-[var(--muted)]">
                            {layerStatuses[l.itemId]?.error ?? "unknown error"}
                          </span>
                        </li>
                      ))}
                  </ul>
                  <p className="text-[10.5px] text-[var(--muted)]">
                    Common causes: expired ArcGIS token, layer permissions, or CORS.
                    Try re-saving credentials in Settings → ArcGIS.
                  </p>
                </div>
              </div>
            </calcite-notice>
          )}

        {/* ── Layers card ──────────────────────────────────────────── */}
        <calcite-card class="dash-card section-card">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className="grid h-8 w-8 place-items-center rounded-md"
                style={{
                  background: "rgb(0 122 194 / 0.14)",
                  color: "var(--primary)",
                }}
              >
                <LayersIcon className="h-4 w-4" strokeWidth={2.2} />
              </span>
              <div>
                <p className="text-[13px] font-semibold leading-tight">Map layers</p>
                <p className="mt-0.5 text-[10.5px] uppercase tracking-wider text-[var(--muted)]">
                  {arcgisLayers.length
                    ? `${arcgisLayers.length} attached`
                    : "None attached"}
                </p>
              </div>
            </div>
            {arcgisLayers.length > 0 && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide"
                style={(() => {
                  const anyFailed = arcgisLayers.some(
                    (l) => layerStatuses[l.itemId]?.state === "failed",
                  );
                  const allReady = arcgisLayers.every(
                    (l) => layerStatuses[l.itemId]?.state === "ready",
                  );
                  if (anyFailed)
                    return {
                      background: "rgb(216 48 32 / 0.14)",
                      color: "var(--error)",
                    };
                  if (allReady)
                    return {
                      background: "rgb(53 172 70 / 0.14)",
                      color: "var(--success)",
                    };
                  return {
                    background: "rgb(237 211 23 / 0.18)",
                    color: "#9c8a06",
                  };
                })()}
              >
                {(() => {
                  const anyFailed = arcgisLayers.some(
                    (l) => layerStatuses[l.itemId]?.state === "failed",
                  );
                  const allReady = arcgisLayers.every(
                    (l) => layerStatuses[l.itemId]?.state === "ready",
                  );
                  if (anyFailed) return "OFFLINE";
                  if (allReady) return "LIVE";
                  return "LOADING";
                })()}
              </span>
            )}
          </div>
          {arcgisLayers.length === 0 ? (
            <p className="text-[11.5px] text-[var(--muted)]">
              Attach a feature service in Settings → ArcGIS to render it here.
            </p>
          ) : (
            <div className="space-y-1.5">
              {arcgisLayers.map((layer) => (
                <ArcgisLayerCard
                  key={layer.itemId}
                  layer={layer}
                  visible={layerVisibility[layer.itemId] ?? true}
                  status={layerStatuses[layer.itemId]}
                  onToggle={() => toggleLayerVisibility(layer.itemId)}
                />
              ))}
            </div>
          )}
        </calcite-card>

        {/* ── Legend card ──────────────────────────────────────────── */}
        <calcite-card class="dash-card section-card">
          <div className="mb-3 flex items-center gap-2">
            <span
              className="grid h-8 w-8 place-items-center rounded-md"
              style={{
                background: "rgb(53 172 70 / 0.14)",
                color: "var(--success)",
              }}
            >
              <Icon className="text-[16px]">payments</Icon>
            </span>
            <div>
              <p className="text-[13px] font-semibold leading-tight">Payment status</p>
              <p className="mt-0.5 text-[10.5px] uppercase tracking-wider text-[var(--muted)]">
                parcel fill legend
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(HEALTH_LABELS) as RecordHealth[]).map((h) => (
              <div
                key={h}
                className="flex items-center justify-between rounded-md border border-[var(--line)] bg-[var(--soft-fill)] px-2.5 py-2 text-[11.5px]"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: HEALTH_COLORS[h] }}
                  />
                  <span className="truncate">{HEALTH_LABELS[h]}</span>
                </span>
                <span className="tabular-nums font-semibold text-[var(--on-surface)]">
                  {healthCounts[h]}
                </span>
              </div>
            ))}
          </div>
        </calcite-card>

        {/* ── Queue overview card ──────────────────────────────────── */}
        <calcite-card class="dash-card section-card">
          <div className="mb-3 flex items-center gap-2">
            <span
              className="grid h-8 w-8 place-items-center rounded-md"
              style={{
                background: "rgb(0 97 155 / 0.14)",
                color: "var(--info, var(--primary))",
              }}
            >
              <Icon className="text-[16px]">list_alt</Icon>
            </span>
            <div>
              <p className="text-[13px] font-semibold leading-tight">Queue overview</p>
              <p className="mt-0.5 text-[10.5px] uppercase tracking-wider text-[var(--muted)]">
                loaded from records
              </p>
            </div>
          </div>
          {(() => {
            const pct = records.length > 0 ? Math.round((linkedCount / records.length) * 100) : 0;
            return (
              <>
                <div className="mb-3 flex items-end justify-between">
                  <div>
                    <p className="text-[22px] font-semibold leading-none tabular-nums">
                      {records.length}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--muted)]">records loaded</p>
                  </div>
                  <div className="text-right">
                    <p
                      className="text-[15px] font-semibold leading-none tabular-nums"
                      style={{ color: "var(--success)" }}
                    >
                      {pct}%
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--muted)]">linked</p>
                  </div>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      background: "var(--success)",
                    }}
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11.5px]">
                  <div className="rounded-md border border-[var(--line)] bg-[var(--soft-fill)] px-2.5 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
                      Linked
                    </p>
                    <p className="mt-0.5 text-[14px] font-semibold tabular-nums">
                      {linkedCount}
                    </p>
                  </div>
                  <div
                    className="rounded-md border px-2.5 py-2"
                    style={{
                      borderColor: unlinkedCount > 0 ? "rgb(237 211 23 / 0.32)" : "var(--line)",
                      background: unlinkedCount > 0 ? "rgb(237 211 23 / 0.06)" : "var(--soft-fill)",
                    }}
                  >
                    <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
                      Awaiting GIS
                    </p>
                    <p
                      className="mt-0.5 text-[14px] font-semibold tabular-nums"
                      style={{ color: unlinkedCount > 0 ? "#9c8a06" : "var(--on-surface)" }}
                    >
                      {unlinkedCount}
                    </p>
                  </div>
                </div>
              </>
            );
          })()}
        </calcite-card>
      </div>
        )}
      </aside>

      {!feature && !selected && (
        <p className="text-center text-[11.5px] text-[var(--muted)] lg:col-span-2">
          Click a parcel on the map to inspect it · type in the search bar to
          jump to a specific one.
        </p>
      )}

      {prefill && (
        <AddRecordModal
          zones={zones}
          types={allRecordTypes}
          prefill={prefill}
          onClose={() => setPrefill(null)}
          onCreated={(id, feeAssigned) => {
            setPrefill(null);
            clearFeature();
            setToast(
              feeAssigned
                ? {
                    kind: "ok",
                    message: `Record #${id} created and linked to OBJECTID ${prefill.arcgisObjectId} — fee auto-assigned.`,
                  }
                : {
                    kind: "err",
                    message: `Record #${id} linked to OBJECTID ${prefill.arcgisObjectId}, but no fee schedule matched — define one under Fees before generating notices.`,
                  },
            );
            // Refresh local records so the new pin shows and the next click
            // on this parcel opens the record directly instead of re-asking.
            api.records
              .list({ limit: 200, search: query.trim() || undefined })
              .then((res) => setRecords(res.data))
              .catch(() => undefined);
            onOpenRecord(id);
          }}
          onError={(message) => setToast({ kind: "err", message })}
        />
      )}

      {linkTargetFeature && (
        <LinkExistingTaxpayerModal
          feature={linkTargetFeature}
          onClose={() => setLinkTargetFeature(null)}
          onLinked={(recordId) => {
            setLinkTargetFeature(null);
            clearFeature();
            setToast({
              kind: "ok",
              message: `Record #${recordId} now linked to OBJECTID ${linkTargetFeature.objectId}.`,
            });
            // Refresh local records so the next click on that parcel opens directly
            api.records.list({ limit: 200, search: query.trim() || undefined })
              .then((res) => setRecords(res.data))
              .catch(() => undefined);
          }}
          onError={(message) => setToast({ kind: "err", message })}
        />
      )}

      {toast && (
        <div className="lg:col-span-2">
          <calcite-notice
            open
            icon={toast.kind === "ok" ? "check-circle" : "exclamation-mark-triangle"}
            kind={toast.kind === "ok" ? "success" : "danger"}
            scale="s"
            closable
            onCalciteNoticeClose={() => setToast(null)}
          >
            <div slot="title">{toast.kind === "ok" ? "Linked" : "Failed"}</div>
            <div slot="message">{toast.message}</div>
          </calcite-notice>
        </div>
      )}

      {records.length > 0 && (
        <calcite-card class="dash-card flush-card lg:col-span-2">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h3 className="text-[13px] font-semibold">Recently updated</h3>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              Click a row to focus it on the map · click open to view full detail
            </p>
          </div>
          <div className="max-h-[260px] overflow-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="label sticky top-0 border-b border-[var(--line)] bg-[var(--panel)]">
                <tr>
                  <th className="px-4 py-2">Taxpayer</th>
                  <th className="hidden md:table-cell">Type</th>
                  <th className="hidden lg:table-cell">Zone</th>
                  <th className="text-right pr-4">Outstanding</th>
                  <th className="px-2"></th>
                </tr>
              </thead>
              <tbody>
                {records.slice(0, 30).map((r) => (
                  <tr
                    key={r.recordId}
                    className={`cursor-pointer border-b border-[var(--line)] hover:bg-[var(--soft-fill)] ${
                      selected?.recordId === r.recordId ? "bg-[var(--primary-container)]" : ""
                    }`}
                    onClick={() => setSelected(r)}
                  >
                    <td className="px-4 py-2 font-medium">{r.taxpayerName}</td>
                    <td className="hidden text-[var(--muted)] md:table-cell">{r.recordType}</td>
                    <td className="hidden text-[var(--muted)] lg:table-cell">{r.zoneName}</td>
                    <td className="pr-4 text-right tabular-nums">
                      {formatKesM(Number(r.outstandingBalance))}
                    </td>
                    <td className="px-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenRecord(r.recordId);
                        }}
                        className="icon-btn"
                        aria-label="Open record"
                      >
                        <ChevronRight className="h-4 w-4" strokeWidth={2.4} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </calcite-card>
      )}
    </section>
  );
}

/* ─── Sidebar inspector for the clicked / searched feature ──────────── */

function FeatureInspectorCard({
  feature,
  linkedRecord,
  onClose,
  onCreate,
  onLinkExisting,
  onOpenRecord,
}: {
  feature: ArcGISFeatureSelection;
  linkedRecord: TaxpayerRecord | null;
  onClose: () => void;
  onCreate: () => void;
  onLinkExisting: () => void;
  onOpenRecord: (id: number) => void;
}) {
  // Show up to ~6 readable attribute rows (skip OBJECTIDs + numeric system fields)
  const skip = new Set(["objectid", "globalid", "shape", "shape_length", "shape_area"]);
  const attrs = Object.entries(feature.attributes)
    .filter(([k, v]) => v != null && String(v).trim() !== "" && !skip.has(k.toLowerCase()))
    .slice(0, 8);

  return (
    <calcite-card class="dash-card section-card">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[var(--primary-container)] text-[var(--primary)]">
            <MapPin className="h-4 w-4" strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <p className="label">Inspector</p>
            <h2 className="truncate text-[13px] font-semibold">
              {recordTypeLabel(feature.recordType)}
            </h2>
            <p className="font-mono text-[10.5px] text-[var(--muted)]">
              OBJECTID {feature.objectId}
            </p>
          </div>
        </div>
        <button type="button" className="icon-btn h-7 w-7" onClick={onClose} aria-label="Close">
          <X className="h-3.5 w-3.5" strokeWidth={2.4} />
        </button>
      </div>

      {/* Owner / taxpayer block */}
      {linkedRecord ? (
        <div className="rounded-md border border-[var(--line)] bg-[var(--soft-fill)] p-3">
          <p className="label">Owner / taxpayer</p>
          <p className="mt-0.5 text-[13px] font-semibold">{linkedRecord.taxpayerName}</p>
          <p className="text-[11px] text-[var(--muted)]">
            {recordTypeLabel(linkedRecord.recordType)} · {linkedRecord.zoneName} · {linkedRecord.status}
          </p>
          {linkedRecord.taxpayerPhone && (
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              {linkedRecord.taxpayerPhone}
            </p>
          )}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10.5px] uppercase tracking-wider text-[var(--muted)]">
              Outstanding
            </span>
            <span
              className="text-[13px] font-semibold tabular-nums"
              style={{
                color:
                  Number(linkedRecord.outstandingBalance) > 0
                    ? "var(--error)"
                    : "var(--success)",
              }}
            >
              {formatKesM(Number(linkedRecord.outstandingBalance))}
            </span>
          </div>
          <button
            type="button"
            className="primary-control mt-2.5 w-full justify-center !h-8"
            onClick={() => onOpenRecord(linkedRecord.recordId)}
          >
            Open record <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.4} />
          </button>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-[var(--warning)] bg-[var(--soft-fill)] p-3 text-[11.5px] text-[var(--muted)]">
          <p>
            <span className="font-semibold text-[var(--on-surface)]">Unassigned</span> ·
            no taxpayer record is bound to this parcel.
          </p>
          <div className="mt-2.5 flex flex-col gap-1.5">
            <button type="button" className="primary-control !h-8 justify-center" onClick={onCreate}>
              <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
              Create new record
            </button>
            <button type="button" className="control !h-8 justify-center" onClick={onLinkExisting}>
              <Link2 className="h-3.5 w-3.5" strokeWidth={2.2} />
              Link existing taxpayer
            </button>
          </div>
        </div>
      )}

      {/* Raw ArcGIS attributes */}
      {attrs.length > 0 && (
        <div className="mt-3">
          <p className="label mb-1.5">Parcel attributes</p>
          <dl className="space-y-1 text-[11.5px]">
            {attrs.map(([k, v]) => (
              <div
                key={k}
                className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] py-1 last:border-0"
              >
                <dt className="truncate text-[var(--muted)]">{k}</dt>
                <dd className="truncate text-right">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </calcite-card>
  );
}

function ArcgisLayerCard({
  layer,
  visible,
  status,
  onToggle,
}: {
  layer: ActiveArcgisLayer;
  visible: boolean;
  status?: LayerStatus;
  onToggle: () => void;
}) {
  const color = colorForType(layer.recordType);
  // Prefer the live feature count when the layer actually loaded; fall back
  // to the DB-cached count so the sidebar isn't empty during the loading tick.
  const liveCount = status?.state === "ready" ? status.featureCount : undefined;
  const displayCount = liveCount ?? layer.featureCount ?? null;
  const isStale = status?.state === "failed";
  const isLoading = !status || status.state === "loading";

  const dot = (() => {
    if (isStale) return { bg: "var(--error)", pulse: false, title: "Layer unreachable" };
    if (isLoading) return { bg: "var(--warning, #edd317)", pulse: true, title: "Loading" };
    return { bg: "var(--success)", pulse: false, title: "Rendering live" };
  })();

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-start justify-between gap-2 rounded-lg border p-2.5 text-left text-[12.5px] transition-colors ${
        visible
          ? "border-[var(--primary)] bg-[var(--primary-container)]"
          : "border-[var(--line)] bg-[var(--soft-fill)] hover:border-[var(--outline-variant)] opacity-70"
      }`}
      title={visible ? "Hide on map" : "Show on map"}
    >
      <span className="flex items-start gap-2 min-w-0">
        <span className="relative mt-0.5 shrink-0">
          <span
            className="block h-4 w-4 rounded-sm"
            style={{ background: visible ? color : "var(--muted)" }}
          />
          <span
            className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-[var(--panel)] ${
              dot.pulse ? "animate-pulse" : ""
            }`}
            style={{ background: dot.bg }}
            title={dot.title}
          />
        </span>
        <span className="min-w-0">
          <p className="truncate font-semibold">{recordTypeLabel(layer.recordType)}</p>
          <p className="text-[10.5px] text-[var(--muted)]">
            {layer.geometryType
              ? layer.geometryType.replace(/^esriGeometry/, "").toLowerCase()
              : "feature layer"}
            {isStale ? " · cached" : ""}
          </p>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
        <span
          className={`tabular-nums text-[11px] font-semibold ${
            isStale ? "text-[var(--muted)] line-through decoration-[var(--muted)]" : "text-[var(--on-surface-secondary)]"
          }`}
        >
          {displayCount != null ? displayCount.toLocaleString() : "—"}
        </span>
        {visible ? (
          <Eye className="h-3.5 w-3.5 text-[var(--primary)]" strokeWidth={2.2} />
        ) : (
          <EyeOff className="h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.2} />
        )}
      </span>
    </button>
  );
}

/* ─── Link existing taxpayer to a clicked feature ───────────────────── */

function LinkExistingTaxpayerModal({
  feature,
  onClose,
  onLinked,
  onError,
}: {
  feature: ArcGISFeatureSelection;
  onClose: () => void;
  onLinked: (recordId: number) => void;
  onError: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<TaxpayerRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [linkingId, setLinkingId] = useState<number | null>(null);

  // Debounced lookup. Empty query lists most-recent records so the panel
  // never feels blank when first opened.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api.records
        .list({
          limit: 25,
          search: search.trim() || undefined,
          recordTypeId: feature.recordTypeId ?? undefined,
        })
        .then((res) => !cancelled && setResults(res.data))
        .catch(() => !cancelled && setResults([]))
        .finally(() => !cancelled && setLoading(false));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, feature.recordTypeId]);

  const linkTo = async (record: TaxpayerRecord) => {
    setLinkingId(record.recordId);
    try {
      await api.records.linkFeature(record.recordId, feature.objectId);
      onLinked(record.recordId);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not link record");
    } finally {
      setLinkingId(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel max-w-[520px] p-5"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">Link to existing taxpayer</h2>
            <p className="text-[12px] text-[var(--muted)]">
              {recordTypeLabel(feature.recordType)} · OBJECTID {feature.objectId}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]"
            strokeWidth={2.2}
          />
          <input
            type="text"
            className="auth-input !pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by taxpayer name…"
            autoFocus
          />
        </div>

        <div className="mt-3 max-h-[320px] overflow-auto rounded-lg border border-[var(--line)]">
          {loading && (
            <p className="px-3 py-4 text-center text-[12px] text-[var(--muted)]">
              Loading…
            </p>
          )}
          {!loading && results.length === 0 && (
            <p className="px-3 py-4 text-center text-[12px] text-[var(--muted)]">
              No matching records.
            </p>
          )}
          {!loading &&
            results.map((r) => {
              const alreadyLinked = r.arcgisObjectId != null;
              return (
                <button
                  key={r.recordId}
                  type="button"
                  onClick={() => linkTo(r)}
                  disabled={linkingId === r.recordId}
                  className="flex w-full items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2.5 text-left text-[12.5px] last:border-0 hover:bg-[var(--soft-fill)]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{r.taxpayerName}</p>
                    <p className="truncate text-[11px] text-[var(--muted)]">
                      {r.recordType} · {r.zoneName}
                      {alreadyLinked && (
                        <span className="ml-2 rounded bg-[var(--soft-fill)] px-1.5 py-0.5 font-mono text-[10px]">
                          OID {r.arcgisObjectId}
                        </span>
                      )}
                    </p>
                  </div>
                  <span className="shrink-0 text-[var(--primary)]">
                    {linkingId === r.recordId ? "Linking…" : alreadyLinked ? "Re-link" : "Link"}
                  </span>
                </button>
              );
            })}
        </div>

        <p className="mt-3 text-[11px] text-[var(--muted)]">
          Linking overwrites the record&apos;s previous OBJECTID, if any.
        </p>
      </div>
    </div>
  );
}

export { MapWorkspace };
