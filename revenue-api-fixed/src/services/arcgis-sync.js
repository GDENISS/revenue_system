// src/services/arcgis-sync.js
import { getDb } from "../db.js";

let syncInterval = null;
let isSyncing = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decryptSecret(encryptedSecret) {
  return encryptedSecret;
}

export function resolveCredentials(config) {
  const clientId =
    process.env.ARCGIS_CLIENT_ID?.trim() || config.clientId?.trim();

  const clientSecret =
    process.env.ARCGIS_CLIENT_SECRET?.trim() ||
    decryptSecret(config.clientSecretEnc?.trim());

  const baseUrl = (
    process.env.ARCGIS_BASE_URL?.trim() ||
    config.baseUrl?.trim() ||
    "https://www.arcgis.com"
  ).replace(/\/+$/, "");

  if (!clientId)
    throw new Error("ArcGIS clientId missing — set ARCGIS_CLIENT_ID in .env");
  if (!clientSecret)
    throw new Error("ArcGIS clientSecret missing — set ARCGIS_CLIENT_SECRET in .env");

  return { clientId, clientSecret, baseUrl };
}

// ---------------------------------------------------------------------------
// ArcGIS OAuth
// ---------------------------------------------------------------------------

export async function getArcGISToken(baseUrl, clientId, clientSecret) {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    f: "json",
  });

  const response = await fetch(`${baseUrl}/sharing/rest/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`ArcGIS OAuth HTTP error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`ArcGIS OAuth error: ${data.error.message} (code ${data.error.code})`);
  }

  if (!data.access_token) {
    throw new Error("ArcGIS OAuth response contained no access_token");
  }

  return data.access_token;
}

// ---------------------------------------------------------------------------
// Feature layer query
// ---------------------------------------------------------------------------

/**
 * Resolve an ArcGIS item ID (or a raw layer/service URL) to a specific
 * FeatureServer layer URL. If the caller already passed a full URL we short-
 * circuit; otherwise we hit the portal's item endpoint to read `item.url`,
 * which is the actual service host (e.g. services.arcgis.com/{org}/...) —
 * the sharing/rest portal endpoint does NOT serve FeatureServer queries.
 */
async function resolveLayerUrl(baseUrl, itemIdOrUrl, token) {
  const raw = String(itemIdOrUrl ?? "").replace(/\/+$/, "");
  // Already a full URL (http/https) → use as-is, appending /0 if the caller
  // pointed at the service root rather than a specific layer.
  if (/^https?:\/\//i.test(raw)) {
    return /\/\d+$/.test(raw) ? raw : `${raw}/0`;
  }
  // Otherwise assume it's a portal item ID and resolve it.
  const itemRes = await fetch(
    `${baseUrl}/sharing/rest/content/items/${encodeURIComponent(raw)}?f=json&token=${token}`,
  );
  if (!itemRes.ok) {
    throw new Error(`Item lookup HTTP ${itemRes.status} ${itemRes.statusText}`);
  }
  const item = await itemRes.json();
  if (item.error) {
    throw new Error(`Item lookup: ${item.error.message} (code ${item.error.code})`);
  }
  if (!item.url) {
    throw new Error(`Item ${raw} has no service URL (type=${item.type ?? "?"})`);
  }
  const serviceUrl = String(item.url).replace(/\/+$/, "");
  return /\/\d+$/.test(serviceUrl) ? serviceUrl : `${serviceUrl}/0`;
}

/**
 * Fetch the layer's own field list so we can request only the columns that
 * actually exist. Some published layers rename OBJECTID → FID or drop the
 * taxpayer_name/zone_id fields we expect — asking for absent fields returns
 * a 500 from the ArcGIS server.
 */
async function fetchLayerFields(layerUrl, token) {
  try {
    const res = await fetch(`${layerUrl}?f=json&token=${token}`);
    if (!res.ok) return null;
    const meta = await res.json();
    if (meta?.error) return null;
    return {
      objectIdField: meta.objectIdField || "OBJECTID",
      fieldNames: (meta.fields ?? []).map((f) => f.name),
      hasEditDate: (meta.fields ?? []).some((f) => f.name === "EditDate"),
    };
  } catch {
    return null;
  }
}

async function fetchFeatureLayer(baseUrl, layerId, token, lastSyncAt) {
  // Resolve the itemId to the actual FeatureServer layer URL. Previously we
  // constructed `${baseUrl}/sharing/rest/services/{itemId}/FeatureServer/0`
  // which is wrong — the portal's sharing/rest endpoint does not host services,
  // and ArcGIS returned "No proxy information found (code 400)" for every query.
  const layerUrl = await resolveLayerUrl(baseUrl, layerId, token);

  // Probe field metadata so we only ask for columns that exist. This turns
  // most 500s ("Unable to complete operation") into a clean skip instead.
  const layerMeta = await fetchLayerFields(layerUrl, token);
  const availableFields = new Set(layerMeta?.fieldNames ?? []);
  const oidField = layerMeta?.objectIdField ?? "OBJECTID";

  // Only include fields that actually exist on the layer.
  const wantedFields = [oidField, "taxpayer_name", "zone_id"].filter((f) =>
    availableFields.size === 0 ? true : availableFields.has(f),
  );
  const outFields = wantedFields.length ? wantedFields.join(",") : "*";

  // EditDate incremental filter only makes sense if the layer actually
  // exposes that field — otherwise fall back to a full query.
  const whereClause =
    lastSyncAt && (layerMeta?.hasEditDate ?? true)
      ? `EditDate > TIMESTAMP '${new Date(lastSyncAt)
          .toISOString()
          .replace("T", " ")
          .split(".")[0]}'`
      : "1=1";

  // Page through the layer with resultOffset. A single query is capped by
  // the service's maxRecordCount (often 1000–2000); without paging, layers
  // bigger than one page silently truncated — a county with 100k parcels
  // would sync only the first 2,000 and nobody would know.
  const PAGE_SIZE = 2000;
  const MAX_FEATURES = 500_000; // hard stop against runaway loops
  const all = [];
  let offset = 0;

  for (;;) {
    const url = new URL(`${layerUrl}/query`);
    url.searchParams.set("where", whereClause);
    url.searchParams.set("outFields", outFields);
    // We no longer cache geometry locally — only attributes + the OBJECTID link.
    url.searchParams.set("returnGeometry", "false");
    url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
    url.searchParams.set("resultOffset", String(offset));
    url.searchParams.set("orderByFields", oidField); // stable paging order
    url.searchParams.set("f", "json");
    url.searchParams.set("token", token);

    const response = await fetch(url.toString());

    if (!response.ok) {
      // Capture the response body — ArcGIS often returns a JSON error even on
      // HTTP 500, and stringifying it is the difference between a diagnosable
      // failure and an opaque one.
      const bodyText = await response.text().catch(() => "");
      const detail = bodyText.slice(0, 400);
      throw new Error(
        `Feature layer query failed: ${response.status} ${response.statusText}` +
          (detail ? ` — ${detail}` : ""),
      );
    }

    const data = await response.json();

    if (data.error) {
      const details = Array.isArray(data.error.details)
        ? data.error.details.join("; ")
        : "";
      throw new Error(
        `Feature layer error: ${data.error.message} (code ${data.error.code})` +
          (details ? ` — ${details}` : ""),
      );
    }

    const page = data.features || [];
    all.push(...page);

    // Stop when the server says there's nothing more. Some older servers
    // omit exceededTransferLimit — a short page is the fallback signal.
    const more = data.exceededTransferLimit === true && page.length > 0;
    if (!more || page.length < PAGE_SIZE) break;
    offset += page.length;
    if (all.length >= MAX_FEATURES) {
      throw new Error(`Layer returned more than ${MAX_FEATURES} features — aborting as a safety measure`);
    }
  }

  return all;
}

// ---------------------------------------------------------------------------
// Data mapping — only ArcGIS-owned fields, billing stays in Postgres
// ---------------------------------------------------------------------------

function mapFeatureToRecord(feature, recordTypeId) {
  const a = feature.attributes ?? {};
  // Geometry intentionally NOT extracted — Postgres no longer stores it.
  // ArcGIS is the single source of truth for spatial data.
  return {
    arcgisObjectId: a.OBJECTID ?? a.objectid ?? null,
    recordTypeId,
    taxpayerName:   a.taxpayer_name ?? a.TaxpayerName ?? a.name ?? "Unknown",
    zoneId:         a.zone_id ?? null,
  };
}

// ---------------------------------------------------------------------------
// DB upsert — attributes + arcgis_object_id only
// ---------------------------------------------------------------------------

/**
 * Attach the obligation (fee_assignment) for a freshly-created record by
 * matching the best active fee schedule: zone-specific first, then a
 * default (zone_id IS NULL) rule, most recent effective_from wins.
 * No-op when no schedule matches — the record simply has no obligation
 * until an admin defines a fee for its type/zone.
 */
async function autoAssignFee(sql, recordId, recordTypeId, zoneId, systemUserId) {
  if (!systemUserId) return null;
  const billingYear = new Date().getFullYear();
  const [schedule] = await sql`
    SELECT schedule_id, amount
    FROM fee_schedule
    WHERE record_type_id = ${recordTypeId}
      AND is_active = TRUE
      AND (zone_id IS NULL OR zone_id = ${zoneId ?? null})
      AND effective_from <= CURRENT_DATE
      AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
    ORDER BY (zone_id IS NOT NULL) DESC, effective_from DESC
    LIMIT 1
  `;
  if (!schedule) return null;

  const dueDate = new Date(billingYear, 5, 30).toISOString().split("T")[0]; // 30 Jun
  const [assignment] = await sql`
    INSERT INTO fee_assignment
      (record_id, schedule_id, assigned_by, billing_year, amount_due, due_date)
    VALUES
      (${recordId}, ${schedule.scheduleId}, ${systemUserId},
       ${billingYear}, ${schedule.amount}, ${dueDate})
    ON CONFLICT DO NOTHING
    RETURNING assignment_id
  `;
  return assignment?.assignmentId ?? null;
}

async function upsertRecords(sql, records, batchId, systemUserId) {
  let inserted = 0;
  let updated  = 0;
  let obligations = 0;

  for (const r of records) {
    if (!r.arcgisObjectId) continue;

    const existing = await sql`
      SELECT record_id FROM taxpayer_record
      WHERE  arcgis_object_id = ${r.arcgisObjectId}
      LIMIT  1
    `;

    if (existing.length > 0) {
      await sql`
        UPDATE taxpayer_record SET
          taxpayer_name   = ${r.taxpayerName},
          zone_id         = COALESCE(${r.zoneId}, zone_id),
          sync_batch_id   = ${batchId},
          submission_date = NOW()
        WHERE arcgis_object_id = ${r.arcgisObjectId}
      `;
      updated++;
    } else {
      const [created] = await sql`
        INSERT INTO taxpayer_record (
          arcgis_object_id,
          record_type_id,
          taxpayer_name,
          zone_id,
          status_id,
          sync_batch_id,
          submission_date
        ) VALUES (
          ${r.arcgisObjectId},
          ${r.recordTypeId},
          ${r.taxpayerName},
          ${r.zoneId},
          1,
          ${batchId},
          NOW()
        )
        RETURNING record_id
      `;
      inserted++;

      // Every new record gets its obligation immediately — it shows as
      // outstanding until a payment clears it.
      const assignmentId = await autoAssignFee(
        sql, created.recordId, r.recordTypeId, r.zoneId, systemUserId
      );
      if (assignmentId) obligations++;
    }
  }

  return { inserted, updated, obligations };
}

// ---------------------------------------------------------------------------
// Main sync
// ---------------------------------------------------------------------------

export async function syncArcGIS(logger) {
  if (isSyncing) {
    logger?.info("ArcGIS sync already in progress, skipping");
    return;
  }

  // Mock mode — set ARCGIS_MOCK_MODE=true in .env to skip real sync
  if (process.env.ARCGIS_MOCK_MODE === "true") {
    logger?.info("ArcGIS sync skipped — ARCGIS_MOCK_MODE=true");
    return { totalInserted: 0, totalUpdated: 0 };
  }

  const sql     = getDb();
  isSyncing     = true;
  const batchId = `sync-${Date.now()}`;

  try {
    const [config] = await sql`
      SELECT
        config_id,
        base_url,
        client_id,
        client_secret_enc,
        parcel_layer_id,
        business_layer_id,
        market_stall_layer_id,
        sync_interval_minutes,
        last_sync_at
      FROM arcgis_config
      LIMIT 1
    `;

    if (!config) {
      logger?.warn("No arcgis_config row found — skipping sync");
      return;
    }

    const { clientId, clientSecret, baseUrl } = resolveCredentials(config);

    logger?.info("Fetching ArcGIS token...");
    const token = await getArcGISToken(baseUrl, clientId, clientSecret);
    logger?.info("ArcGIS token obtained successfully");

    const layers = [
      {
        layerId:      process.env.ARCGIS_PARCEL_LAYER_ID       || config.parcelLayerId,
        recordTypeId: 1,
        name:         "Parcel",
      },
      {
        layerId:      process.env.ARCGIS_BUSINESS_LAYER_ID     || config.businessLayerId,
        recordTypeId: 2,
        name:         "Business",
      },
      {
        layerId:      process.env.ARCGIS_MARKET_STALL_LAYER_ID || config.marketStallLayerId,
        recordTypeId: 3,
        name:         "Market Stall",
      },
    ].filter((l) => l.layerId);

    if (layers.length === 0) {
      logger?.warn("No layer IDs configured — run POST /api/admin/arcgis/create-layers first");
      return;
    }

    let totalInserted = 0;
    let totalUpdated  = 0;
    let totalObligations = 0;

    // System actor for sync-created fee assignments (no JWT during sync).
    // Prefer the seeded admin, fall back to the lowest user id.
    const [sysUser] = await sql`
      SELECT user_id FROM users
      ORDER BY (email = 'admin@revenue.local') DESC, user_id ASC
      LIMIT 1
    `;
    const systemUserId = sysUser?.userId ?? null;

    for (const layer of layers) {
      logger?.info(`Syncing ${layer.name} layer (${layer.layerId})...`);
      try {
        const features = await fetchFeatureLayer(
          baseUrl, layer.layerId, token, config.lastSyncAt
        );
        logger?.info(`${layer.name}: ${features.length} features fetched`);

        if (features.length > 0) {
          const records = features.map((f) => mapFeatureToRecord(f, layer.recordTypeId));
          const { inserted, updated, obligations } = await upsertRecords(
            sql, records, batchId, systemUserId
          );
          totalInserted += inserted;
          totalUpdated  += updated;
          totalObligations += obligations;
          logger?.info(`${layer.name}: ${inserted} inserted, ${updated} updated, ${obligations} obligations`);
        }
      } catch (layerErr) {
        logger?.error({ err: layerErr }, `${layer.name} sync failed — continuing`);
      }
    }

    // Field-task sweep: any record that now has spatial data closes its open
    // capture task. Covers Survey123/Field Maps captures that arrived via
    // this sync as well as manual links made while the sync was running.
    try {
      const closed = await sql`
        UPDATE field_task ft
        SET status = 'done', completed_at = NOW(), updated_at = NOW()
        FROM taxpayer_record tr
        WHERE tr.record_id = ft.record_id
          AND tr.arcgis_object_id IS NOT NULL
          AND ft.task_type = 'spatial_capture'
          AND ft.status IN ('open', 'in_progress')
        RETURNING ft.task_id
      `
      if (closed.length) {
        logger?.info(`Auto-completed ${closed.length} field task(s) after sync`)
      }
    } catch {
      /* table may not exist yet on older DBs — non-fatal */
    }

    await sql`
      UPDATE arcgis_config
      SET last_sync_at = NOW(),
          last_sync_error = NULL
      WHERE config_id = ${config.configId}
    `;

    logger?.info(`✅ Sync complete — inserted: ${totalInserted}, updated: ${totalUpdated}, obligations: ${totalObligations}`);
    return { totalInserted, totalUpdated, totalObligations };

  } catch (err) {
    logger?.error({ err }, "ArcGIS sync failed");
    // Surface the failure to the admin UI via dashboard/sync-status.
    try {
      await sql`
        UPDATE arcgis_config
        SET last_sync_error = ${err?.message ?? String(err)}
        WHERE config_id IN (SELECT config_id FROM arcgis_config LIMIT 1)
      `;
    } catch {
      /* don't mask the original error if logging itself fails */
    }
    throw err;
  } finally {
    isSyncing = false;
  }
}

// ---------------------------------------------------------------------------
// Auto-create ArcGIS feature layers
// ---------------------------------------------------------------------------

export async function createArcGISLayers(logger) {
  const sql = getDb();
  const [config] = await sql`SELECT * FROM arcgis_config LIMIT 1`;
  if (!config) throw new Error("No arcgis_config row found");

  const { clientId, clientSecret, baseUrl } = resolveCredentials(config);
  const token = await getArcGISToken(baseUrl, clientId, clientSecret);

  const selfRes  = await fetch(`${baseUrl}/sharing/rest/community/self?f=json&token=${token}`);
  const selfData = await selfRes.json();
  const username = selfData.username;
  if (!username) throw new Error(`Could not resolve ArcGIS username: ${JSON.stringify(selfData)}`);

  logger?.info(`Creating layers for ArcGIS user: ${username}`);

  const sharedFields = [
    { name: "taxpayer_name", type: "esriFieldTypeString",  alias: "Taxpayer Name", length: 200, nullable: false, editable: true },
    { name: "zone_id",       type: "esriFieldTypeInteger", alias: "Zone ID",        nullable: true,  editable: true },
  ];

  const layerDefs = [
    { name: "Revenue_Parcels",      geometryType: "esriGeometryPolygon", envKey: "ARCGIS_PARCEL_LAYER_ID",       dbColumn: "parcel_layer_id"       },
    { name: "Revenue_Businesses",   geometryType: "esriGeometryPoint",   envKey: "ARCGIS_BUSINESS_LAYER_ID",     dbColumn: "business_layer_id"     },
    { name: "Revenue_MarketStalls", geometryType: "esriGeometryPoint",   envKey: "ARCGIS_MARKET_STALL_LAYER_ID", dbColumn: "market_stall_layer_id" },
  ];

  const results = [];

  for (const def of layerDefs) {
    logger?.info(`Creating ${def.name}...`);

    const createParams = {
      name: def.name,
      serviceDescription: `Revenue system ${def.name} layer`,
      hasStaticData: false,
      maxRecordCount: 10000,
      supportedQueryFormats: "JSON",
      capabilities: "Query,Create,Update,Delete,Sync,Extract",
      spatialReference: { wkid: 4326 },
      initialExtent: { xmin: 33.9, ymin: -4.7, xmax: 41.9, ymax: 5.0, spatialReference: { wkid: 4326 } },
      layers: [{
        id: 0,
        name: def.name,
        type: "Feature Layer",
        geometryType: def.geometryType,
        objectIdField: "OBJECTID",
        displayField: "taxpayer_name",
        fields: sharedFields,
      }],
    };

    const body = new URLSearchParams({
      f: "json",
      token,
      outputType: "featureService",
      createParameters: JSON.stringify(createParams),
    });

    try {
      const res  = await fetch(`${baseUrl}/sharing/rest/content/users/${username}/createService`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      const data = await res.json();

      if (data.error) {
        logger?.error(`Failed to create ${def.name}: ${data.error.message}`);
        results.push({ name: def.name, success: false, error: data.error.message });
        continue;
      }

      const itemId = data.itemId ?? data.serviceItemId;
      logger?.info(`✅ ${def.name} created — Item ID: ${itemId}`);
      logger?.info(`   Add to .env: ${def.envKey}=${itemId}`);

      await sql`
        UPDATE arcgis_config
        SET    ${sql(def.dbColumn)} = ${itemId}
        WHERE  config_id = ${config.configId}
      `;
      logger?.info(`   Saved to arcgis_config.${def.dbColumn} ✅`);
      results.push({ name: def.name, success: true, itemId, envKey: def.envKey });

    } catch (err) {
      logger?.error(`Network error creating ${def.name}: ${err.message}`);
      results.push({ name: def.name, success: false, error: err.message });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export function startSyncScheduler(app) {
  const minutes = parseInt(process.env.ARCGIS_SYNC_INTERVAL_MINUTES || "15", 10);
  const ms      = minutes * 60 * 1000;

  setTimeout(() => syncArcGIS(app.log).catch(() => {}), 10_000);
  syncInterval = setInterval(() => syncArcGIS(app.log).catch(() => {}), ms);

  app.log.info(`✅ ArcGIS sync scheduler started — interval: ${minutes} minutes`);

  app.addHook("onClose", () => {
    if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
  });
}

export function stopSyncScheduler() {
  if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
}