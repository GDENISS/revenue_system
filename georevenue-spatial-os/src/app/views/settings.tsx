"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Search, Settings, User } from "lucide-react";
import {
  api,
  type AdminUser,
  type ArcgisConfig as ArcgisConfigPayload,
  type ArcgisLayerInspect,
  type ArcgisLayerSearchItem,
  type AuditEntry,
  type BackendUser,
  type FeeSchedule,
  type RecordType,
  type Role,
  type SyncStatus,
  type TaxpayerRecord,
  type Zone,
} from "../lib/api";
import {
  DetailRow,
  Icon,
  MiniStat,
  formatDate,
  formatRelative,
  initialsOf,
  roleLabelOf,
  toEpochMs,
} from "../lib/shared";

type SettingsTab =
  | "profile"
  | "security"
  | "arcgis"
  | "users"
  | "audit"
  | "fees";

function ArcgisConfig({ user }: { user: BackendUser }) {
  const [tab, setTab] = useState<SettingsTab>("profile");
  const isAdmin = user.role === "admin";
  const isFinance = user.role === "finance_manager";

  const tabs: { id: SettingsTab; label: string; icon: string; visible: boolean }[] = [
    { id: "profile", label: "Profile", icon: "person", visible: true },
    { id: "security", label: "Security", icon: "shield", visible: true },
    { id: "arcgis", label: "ArcGIS", icon: "map", visible: isAdmin },
    { id: "fees", label: "Fee schedules", icon: "payments", visible: isAdmin || isFinance },
    { id: "users", label: "Users", icon: "person", visible: isAdmin },
    { id: "audit", label: "Audit log", icon: "schedule", visible: isAdmin || isFinance },
  ];
  const visibleTabs = tabs.filter((t) => t.visible);

  return (
    <section className="grid gap-3 lg:grid-cols-[240px_1fr]">
      <calcite-card class="dash-card section-card settings-aside">
        <p className="label mb-2 px-2.5">Settings</p>
        <div className="space-y-0.5">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg p-2.5 text-left text-[12.5px] transition-colors ${
                tab === t.id
                  ? "bg-[var(--primary-container)] text-[var(--primary)] font-semibold"
                  : "hover:bg-[var(--soft-fill)]"
              }`}
            >
              <Icon>{t.icon}</Icon>
              <span className="flex-1">{t.label}</span>
              {tab === t.id && <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.4} />}
            </button>
          ))}
        </div>
      </calcite-card>

      <div className="space-y-3">
        {tab === "profile" && <SettingsProfile user={user} />}
        {tab === "security" && <SettingsSecurity user={user} />}
        {tab === "arcgis" && isAdmin && <SettingsArcGIS />}
        {tab === "fees" && (isAdmin || isFinance) && <SettingsFees />}
        {tab === "users" && isAdmin && <SettingsUsers />}
        {tab === "audit" && (isAdmin || isFinance) && <SettingsAudit />}
      </div>
    </section>
  );
}

function SettingsArcGIS() {
  const [config, setConfig] = useState<ArcgisConfigPayload | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [recordTypes, setRecordTypes] = useState<RecordType[]>([]);
  const [draft, setDraft] = useState({
    baseUrl: "",
    clientId: "",
    clientSecret: "",
    parcelLayerId: "",
    businessLayerId: "",
    marketStallLayerId: "",
    syncIntervalMinutes: 15,
    isActive: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    Promise.all([
      api.admin.arcgisConfig().catch(() => null),
      api.dashboard.syncStatus().catch(() => null),
      api.records.types().catch(() => [] as RecordType[]),
    ])
      .then(([cfg, syncRes, types]) => {
        if (cfg) {
          setConfig(cfg);
          setDraft({
            baseUrl: cfg.baseUrl ?? "",
            clientId: cfg.clientId ?? "",
            clientSecret: "",
            parcelLayerId: cfg.parcelLayerId ?? "",
            businessLayerId: cfg.businessLayerId ?? "",
            marketStallLayerId: cfg.marketStallLayerId ?? "",
            syncIntervalMinutes: cfg.syncIntervalMinutes ?? 15,
            isActive: cfg.isActive ?? true,
          });
        }
        if (syncRes) setSync(syncRes);
        setRecordTypes(types);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      await api.admin.saveArcgisConfig({
        baseUrl: draft.baseUrl,
        clientId: draft.clientId,
        ...(draft.clientSecret ? { clientSecret: draft.clientSecret } : {}),
        parcelLayerId: draft.parcelLayerId || undefined,
        businessLayerId: draft.businessLayerId || undefined,
        marketStallLayerId: draft.marketStallLayerId || undefined,
        syncIntervalMinutes: Number(draft.syncIntervalMinutes),
        isActive: draft.isActive,
      });
      setMessage({ kind: "ok", text: "Configuration saved." });
    } catch (err) {
      setMessage({
        kind: "err",
        text: err instanceof Error ? err.message : "Save failed",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <calcite-card class="dash-card" style={{ minHeight: 280 }} loading />;

  return (
    <div className="space-y-3">
      <calcite-card class="dash-card section-card">
        <h2 className="text-lg font-semibold">ArcGIS configuration</h2>
        <p className="mt-1.5 max-w-3xl text-[12.5px] text-[var(--muted)]">
          Save the portal connection once, then discover, inspect, and attach layers separately.
          The backend owns sync mapping and ingestion.
        </p>
      </calcite-card>

      {sync && (
        <div className="grid gap-3 md:grid-cols-3">
          <MiniStat
            icon="cloud_done"
            label="Sync engine"
            value={sync.isActive ? "Active" : "Disabled"}
            caption={
              sync.lastSyncAt
                ? `Last run ${formatRelative(toEpochMs(sync.lastSyncAt)) ?? "—"}`
                : "Never run"
            }
            tone={sync.isActive ? "success" : "warning"}
          />
          <MiniStat
            icon="timer"
            label="Sync interval"
            value={`${sync.syncIntervalMinutes} min`}
            caption="Background scheduler"
            tone="primary"
          />
          <MiniStat
            icon="layers"
            label="Records imported"
            value={sync.arcgisSyncedRecords.toLocaleString()}
            caption={`${sync.manualRecords.toLocaleString()} added manually`}
            tone="success"
          />
        </div>
      )}

      <calcite-card class="dash-card section-card">
      <form onSubmit={handleSave} className="space-y-3">
        <h3 className="panel-title">Connection</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="auth-label">Portal base URL</span>
            <input
              type="text"
              className="auth-input"
              value={draft.baseUrl}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
              placeholder="https://www.arcgis.com or https://your-portal.example.com"
              required
            />
          </label>
          <label className="block">
            <span className="auth-label">OAuth Client ID</span>
            <input
              type="text"
              className="auth-input"
              value={draft.clientId}
              onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}
              required
            />
          </label>
          <label className="block md:col-span-2">
            <span className="auth-label">OAuth Client Secret</span>
            <input
              type="password"
              className="auth-input"
              value={draft.clientSecret}
              onChange={(e) => setDraft({ ...draft, clientSecret: e.target.value })}
              placeholder={config?.configId ? "Leave blank to keep current" : "Required"}
              required={!config?.configId}
            />
          </label>
        </div>

        <h3 className="panel-title pt-2">Survey123 / feature layer IDs</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block">
            <span className="auth-label">Parcels layer</span>
            <input
              type="text"
              className="auth-input font-mono text-[12px]"
              value={draft.parcelLayerId}
              onChange={(e) => setDraft({ ...draft, parcelLayerId: e.target.value })}
              placeholder="hosted feature service ID"
            />
          </label>
          <label className="block">
            <span className="auth-label">Business permits layer</span>
            <input
              type="text"
              className="auth-input font-mono text-[12px]"
              value={draft.businessLayerId}
              onChange={(e) => setDraft({ ...draft, businessLayerId: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="auth-label">Market stalls layer</span>
            <input
              type="text"
              className="auth-input font-mono text-[12px]"
              value={draft.marketStallLayerId}
              onChange={(e) => setDraft({ ...draft, marketStallLayerId: e.target.value })}
            />
          </label>
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-[var(--soft-fill)] p-3 text-[12px] text-[var(--muted)]">
          The source layer must expose at least OBJECTID, taxpayer_name, zone_id, and geometry.
          Keep those field names available in the feature service you attach.
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <label className="flex items-center gap-2 text-[12.5px]">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
            />
            <span>Enable scheduled sync</span>
          </label>
          <label className="flex items-center gap-2 text-[12.5px]">
            <span>Interval (min)</span>
            <input
              type="number"
              min={5}
              max={1440}
              value={draft.syncIntervalMinutes}
              onChange={(e) =>
                setDraft({ ...draft, syncIntervalMinutes: Number(e.target.value) })
              }
              className="auth-input w-24"
            />
          </label>
        </div>

        {message && (
          <calcite-notice
            open
            icon={message.kind === "ok" ? "check-circle" : "exclamation-mark-triangle"}
            kind={message.kind === "ok" ? "success" : "danger"}
            scale="s"
          >
            <div slot="title">{message.kind === "ok" ? "Saved" : "Save failed"}</div>
            <div slot="message">{message.text}</div>
          </calcite-notice>
        )}

        <div className="flex justify-end pt-2">
          <button type="submit" className="primary-control" disabled={saving}>
            {saving ? "Saving…" : "Save configuration"}
          </button>
        </div>
      </form>
      </calcite-card>

      <ArcGISLayerDiscoveryPanel recordTypes={recordTypes} />
    </div>
  );
}

function ArcGISLayerDiscoveryPanel({ recordTypes }: { recordTypes: RecordType[] }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [inspectUrl, setInspectUrl] = useState("");
  const [inspectItemId, setInspectItemId] = useState("");
  const [searchResults, setSearchResults] = useState<ArcgisLayerSearchItem[]>([]);
  const [selectedLayer, setSelectedLayer] = useState<ArcgisLayerInspect | null>(null);
  const [attachRecordTypeId, setAttachRecordTypeId] = useState("");
  const [attachSyncNow, setAttachSyncNow] = useState(true);
  const [result, setResult] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [searching, setSearching] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [attaching, setAttaching] = useState(false);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setResult(null);
    setSearching(true);
    try {
      const res = await api.admin.arcgisLayerSearch({ q: searchQuery, mineOnly: false });
      setSearchResults(res.items || []);
    } catch (err) {
      setResult({ kind: "err", text: err instanceof Error ? err.message : "Layer search failed" });
    } finally {
      setSearching(false);
    }
  };

  const handleInspect = async (params: { itemId?: string; url?: string }) => {
    if (!params.itemId && !params.url) {
      setResult({ kind: "err", text: "Enter an item ID or service URL first." });
      return;
    }
    setResult(null);
    setInspecting(true);
    try {
      const layer = await api.admin.arcgisLayerInspect(params);
      setSelectedLayer(layer);
      setAttachRecordTypeId((current) => current || String(recordTypes[0]?.recordTypeId ?? ""));
      setResult({ kind: "ok", text: "Layer inspected. Review the schema before attaching." });
    } catch (err) {
      setResult({ kind: "err", text: err instanceof Error ? err.message : "Layer inspection failed" });
    } finally {
      setInspecting(false);
    }
  };

  const handleAttach = async () => {
    if (!selectedLayer?.item?.itemId) {
      setResult({ kind: "err", text: "Inspect a layer before attaching it." });
      return;
    }
    if (!attachRecordTypeId) {
      setResult({ kind: "err", text: "Choose a record type to attach the layer to." });
      return;
    }
    setResult(null);
    setAttaching(true);
    try {
      const res = await api.admin.arcgisLayerAttach({
        itemId: selectedLayer.item.itemId,
        recordTypeId: Number(attachRecordTypeId),
        syncNow: attachSyncNow,
      });
      setSelectedLayer(null);
      setSearchResults([]);
      setSearchQuery("");
      setInspectUrl("");
      setResult({
        kind: "ok",
        text: `${res.message} ${res.sync ? `Inserted ${res.sync.totalInserted}, updated ${res.sync.totalUpdated}.` : ""}`.trim(),
      });
    } catch (err) {
      setResult({ kind: "err", text: err instanceof Error ? err.message : "Layer attach failed" });
    } finally {
      setAttaching(false);
    }
  };

  return (
    <calcite-card class="dash-card section-card">
      <div className="space-y-4">
      <div>
        <h3 className="panel-title">Layer discovery and attachment</h3>
        <p className="mt-1 text-[12px] text-[var(--muted)]">
          Search layers, inspect the schema, then attach only after confirming the layer exposes OBJECTID, taxpayer_name, zone_id, and geometry.
        </p>
      </div>

      {result && (
        <calcite-notice
          open
          icon={result.kind === "ok" ? "check-circle" : "exclamation-mark-triangle"}
          kind={result.kind === "ok" ? "success" : "danger"}
          scale="s"
        >
          <div slot="title">{result.kind === "ok" ? "Completed" : "Action failed"}</div>
          <div slot="message">{result.text}</div>
        </calcite-notice>
      )}

      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="auth-label">Search layers</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="auth-input"
            placeholder="Search ArcGIS by title, tag, or owner"
          />
        </label>
        <button type="button" onClick={handleSearch} disabled={searching} className="control self-end">
          {searching ? "Searching…" : "Search"}
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <label className="block">
          <span className="auth-label">Inspect by item ID</span>
          <div className="flex gap-2">
            <input
              type="text"
              className="auth-input flex-1"
              value={inspectItemId}
              onChange={(e) => setInspectItemId(e.target.value)}
              placeholder="Paste item ID here"
            />
            <button
              type="button"
              className="control"
              onClick={() => handleInspect({ itemId: inspectItemId.trim() || undefined })}
              disabled={inspecting || !inspectItemId.trim()}
            >
              {inspecting ? "Inspecting…" : "Inspect"}
            </button>
          </div>
        </label>
        <label className="block">
          <span className="auth-label">Inspect by service URL</span>
          <div className="flex gap-2">
            <input
              type="text"
              className="auth-input flex-1"
              value={inspectUrl}
              onChange={(e) => setInspectUrl(e.target.value)}
              placeholder="https://services.arcgis.com/.../FeatureServer/0"
            />
            <button
              type="button"
              className="control"
              onClick={() => handleInspect({ url: inspectUrl.trim() || undefined })}
              disabled={inspecting || !inspectUrl.trim()}
            >
              {inspecting ? "Inspecting…" : "Inspect URL"}
            </button>
          </div>
        </label>
      </div>

      {searchResults.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Search results</p>
          <div className="grid gap-2 lg:grid-cols-2">
            {searchResults.map((item) => (
              <div key={item.itemId} className="rounded-lg border border-[var(--line)] p-3">
                <p className="text-[12.5px] font-semibold">{item.title}</p>
                <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                  {item.owner} · {item.type}
                </p>
                <div className="mt-3 flex gap-2">
                  <button type="button" className="control" onClick={() => handleInspect({ itemId: item.itemId })}>
                    Inspect
                  </button>
                  <button type="button" className="control" onClick={() => setInspectUrl(item.url)}>
                    Use URL
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedLayer && (
        <div className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--soft-fill)] p-3">
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="label">Layer name</p>
              <p className="text-[12.5px] font-semibold">{selectedLayer.name}</p>
            </div>
            <div>
              <p className="label">Geometry type</p>
              <p className="text-[12.5px] font-semibold">{selectedLayer.geometryType}</p>
            </div>
            <div>
              <p className="label">Object ID field</p>
              <p className="text-[12.5px] font-semibold">{selectedLayer.objectIdField}</p>
            </div>
            <div>
              <p className="label">Capabilities</p>
              <p className="text-[12.5px]">{selectedLayer.capabilities}</p>
            </div>
            <div>
              <p className="label">Feature count</p>
              <p className="text-[12.5px] font-semibold">
                {selectedLayer.featureCount == null ? "Unknown" : selectedLayer.featureCount.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="label">Service URL</p>
              <p className="break-all text-[12px] font-mono">{selectedLayer.serviceUrl}</p>
            </div>
          </div>

          <div>
            <p className="label mb-2">Fields</p>
            <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)]">
              <table className="w-full text-left text-[12px]">
                <thead className="border-b border-[var(--line)] text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Alias</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Length</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedLayer.fields.map((field) => (
                    <tr key={field.name} className="border-b border-[var(--line)] last:border-0">
                      <td className="px-3 py-2 font-mono text-[11.5px]">{field.name}</td>
                      <td className="px-3 py-2">{field.alias}</td>
                      <td className="px-3 py-2 text-[var(--muted)]">{field.type}</td>
                      <td className="px-3 py-2 text-[var(--muted)]">{field.length ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <p className="label mb-2">Sample attributes</p>
            <pre className="max-h-44 overflow-auto rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3 text-[11px] leading-5">
              {JSON.stringify(selectedLayer.sample, null, 2)}
            </pre>
          </div>

          <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3 text-[12px] text-[var(--muted)]">
            Confirm the layer has OBJECTID, taxpayer_name, zone_id, and geometry before attaching.
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_180px_auto] md:items-end">
            <label className="block">
              <span className="auth-label">Attach to record type</span>
              <div className="auth-input-shell">
                <select
                  className="auth-input auth-input--bare"
                  value={attachRecordTypeId}
                  onChange={(e) => setAttachRecordTypeId(e.target.value)}
                >
                  <option value="">Choose record type</option>
                  {recordTypes.map((type) => (
                    <option key={type.recordTypeId} value={String(type.recordTypeId)}>
                      {type.typeName}
                    </option>
                  ))}
                </select>
                <ChevronDown className="mr-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
              </div>
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-[var(--muted)]">
              <input
                type="checkbox"
                checked={attachSyncNow}
                onChange={(e) => setAttachSyncNow(e.target.checked)}
              />
              Sync immediately
            </label>
            <button
              type="button"
              onClick={handleAttach}
              disabled={attaching}
              className="primary-control"
            >
              {attaching ? "Attaching…" : "Attach layer"}
            </button>
          </div>
        </div>
      )}
      </div>
    </calcite-card>
  );
}


function SettingsUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{ role: Role; zoneId: string | "" }>({ role: "officer", zoneId: "" });
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [form, setForm] = useState({ fullName: "", email: "", password: "", role: "officer" as Role, zoneId: "" });

  const loadUsers = () => {
    api.admin
      .users()
      .then(setUsers)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load users"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadUsers();
    api.zones.list().then(setZones).catch(() => setZones([]));
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName || !form.email || !form.password) {
      setMessage({ kind: "err", text: "Fill all fields" });
      return;
    }
    try {
      await api.admin.createUser({
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        roleName: form.role,
        zoneId: form.zoneId ? Number(form.zoneId) : undefined,
      });
      setMessage({ kind: "ok", text: "User created. They can now sign in with ArcGIS." });
      setForm({ fullName: "", email: "", password: "", role: "officer", zoneId: "" });
      setShowForm(false);
      loadUsers();
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Create failed" });
    }
  };

  const handleUpdate = async (userId: number, role: Role, zoneId?: number) => {
    try {
      await api.admin.updateUser(userId, { roleName: role, zoneId });
      setMessage({ kind: "ok", text: "User updated." });
      loadUsers();
      setEditingId(null);
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Update failed" });
    }
  };

  if (loading) return <calcite-card class="dash-card" style={{ minHeight: 280 }} loading />;

  return (
    <div className="space-y-3">
      <calcite-card class="dash-card section-card">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Users & Roles</h2>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              {users.length} accounts · all authenticated via ArcGIS
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            className="primary-control"
          >
            <Plus className="h-4 w-4" />
            <span>Add user</span>
          </button>
        </div>

        {message && (
          <calcite-notice
            open
            icon={message.kind === "ok" ? "check-circle" : "exclamation-mark-triangle"}
            kind={message.kind === "ok" ? "success" : "danger"}
            scale="s"
            className="mb-3"
          >
            <div slot="message">{message.text}</div>
          </calcite-notice>
        )}

        {showForm && (
          <form onSubmit={handleCreate} className="mb-4 space-y-3 rounded-lg bg-[var(--soft-fill)] p-3">
            <p className="text-[12px] font-semibold">Create new user</p>
            <p className="text-[11px] text-[var(--muted)]">
              User will receive instructions to link their ArcGIS account on first sign-in.
            </p>
            <label className="block">
              <span className="auth-label">Full name</span>
              <input
                type="text"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                className="auth-input"
                placeholder="John Doe"
              />
            </label>
            <label className="block">
              <span className="auth-label">Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="auth-input"
                placeholder="john@example.com"
              />
            </label>
            <label className="block">
              <span className="auth-label">Temp password</span>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="auth-input"
                placeholder="Initial password (user should change after first login)"
              />
            </label>
            <label className="block">
              <span className="auth-label">Role</span>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                className="auth-input"
              >
                <option value="admin">Administrator</option>
                <option value="finance_manager">Finance Manager</option>
                <option value="officer">Field Officer</option>
                <option value="gis_officer">GIS Officer</option>
              </select>
            </label>
            <label className="block">
              <span className="auth-label">Zone (optional)</span>
              <select
                value={form.zoneId}
                onChange={(e) => setForm({ ...form, zoneId: e.target.value })}
                className="auth-input"
              >
                <option value="">No zone assigned</option>
                {zones.map((z) => (
                  <option key={z.zoneId} value={String(z.zoneId)}>
                    {z.zoneName}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <button type="submit" className="primary-control">
                Create
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="control">
                Cancel
              </button>
            </div>
          </form>
        )}

        {error ? (
          <calcite-notice open icon="exclamation-mark-triangle" kind="danger" scale="s">
            <div slot="title">Could not load users</div>
            <div slot="message">{error}</div>
          </calcite-notice>
        ) : users.length === 0 ? (
          <p className="text-[12.5px] text-[var(--muted)]">No users yet. Create one to get started.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="label border-b border-[var(--line)]">
                <tr>
                  <th className="py-2.5">Name</th>
                  <th className="hidden md:table-cell">Email</th>
                  <th>Role</th>
                  <th className="hidden md:table-cell">Zone</th>
                  <th className="hidden lg:table-cell">Last login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.userId} className="border-b border-[var(--line)] hover:bg-[var(--soft-fill)]">
                    <td className="py-2.5 font-medium">{u.name}</td>
                    <td className="hidden text-[var(--muted)] md:table-cell">{u.email}</td>
                    <td>
                      {editingId === u.userId ? (
                        <div className="flex items-center gap-2">
                          <select
                            className="auth-input text-[11px]"
                            value={editDraft.role}
                            onChange={(e) => setEditDraft({ ...editDraft, role: e.target.value as Role })}
                          >
                            <option value="admin">Admin</option>
                            <option value="finance_manager">Finance</option>
                            <option value="officer">Officer</option>
                            <option value="gis_officer">GIS</option>
                          </select>
                        </div>
                      ) : (
                        <span className="status">{roleLabelOf(u.role)}</span>
                      )}
                    </td>
                    <td className="hidden text-[var(--muted)] md:table-cell">
                      {editingId === u.userId ? (
                        <select
                          className="auth-input text-[11px] w-full"
                          value={editDraft.zoneId}
                          onChange={(e) => setEditDraft({ ...editDraft, zoneId: e.target.value })}
                        >
                          <option value="">No zone assigned</option>
                          {zones.map((z) => (
                            <option key={z.zoneId} value={String(z.zoneId)}>
                              {z.zoneName}
                            </option>
                          ))}
                        </select>
                      ) : (
                        u.zoneName ?? "—"
                      )}
                    </td>
                    <td className="hidden text-[var(--muted)] lg:table-cell">
                      {u.lastLoginAt ? formatRelative(toEpochMs(u.lastLoginAt)) ?? u.lastLoginAt : "Never"}
                    </td>
                    <td>
                      {editingId === u.userId ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              const zoneId = editDraft.zoneId ? Number(editDraft.zoneId) : undefined;
                              await handleUpdate(u.userId, editDraft.role, zoneId);
                            }}
                            className="text-[11px] text-[var(--primary)] hover:underline"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                            }}
                            className="text-[11px] text-[var(--muted)] hover:underline"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(u.userId);
                            const currentZone = zones.find((zone) => zone.zoneName === u.zoneName);
                            setEditDraft({ role: u.role, zoneId: currentZone ? String(currentZone.zoneId) : "" });
                          }}
                          className="text-[11px] text-[var(--primary)] hover:underline"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </calcite-card>

      <calcite-card class="dash-card section-card">
        <h3 className="text-sm font-semibold">ArcGIS Authentication</h3>
        <p className="mt-2 text-[12px] text-[var(--muted)]">
          Every user authenticates via their ArcGIS Online or Enterprise account on first sign-in. On first login:
        </p>
        <ul className="mt-2 space-y-1.5 text-[12px]">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-[var(--success)]">✓</span>
            <span>If no users exist yet, they're auto-promoted to <strong>Admin</strong></span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-[var(--success)]">✓</span>
            <span>Otherwise, they're created as <strong>Field Officer</strong> (admin can change roles)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-[var(--success)]">✓</span>
            <span>ArcGIS username is linked automatically to prevent duplicates</span>
          </li>
        </ul>
      </calcite-card>
    </div>
  );
}

function SettingsAudit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.admin
      .auditLog({ limit: 100 })
      .then((res) => setEntries(res.data))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load audit log"),
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <calcite-card class="dash-card" style={{ minHeight: 280 }} loading />;

  return (
    <calcite-card class="dash-card section-card zone-card">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Audit log</h2>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            Latest {entries.length} events · system-wide
          </p>
        </div>
      </div>
      {error ? (
        <calcite-notice open icon="exclamation-mark-triangle" kind="danger" scale="s">
          <div slot="title">Could not load audit log</div>
          <div slot="message">{error}</div>
        </calcite-notice>
      ) : entries.length === 0 ? (
        <p className="text-[12.5px] text-[var(--muted)]">No audit events yet.</p>
      ) : (
        <table className="w-full text-left text-[12.5px]">
          <thead className="label border-b border-[var(--line)]">
            <tr>
              <th className="py-2.5">When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Target</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.logId} className="border-b border-[var(--line)] hover:bg-[var(--soft-fill)]">
                <td className="py-2.5 text-[var(--muted)] tabular-nums">
                  {formatRelative(toEpochMs(e.createdAt)) ?? e.createdAt}
                </td>
                <td className="font-medium">{e.userName ?? "system"}</td>
                <td>
                  <span className="font-mono text-[11.5px]">{e.action}</span>
                </td>
                <td className="text-[var(--muted)]">
                  {e.tableName ? `${e.tableName}` : "—"}
                  {e.recordId ? ` · #${e.recordId}` : ""}
                </td>
                <td className="font-mono text-[11px] text-[var(--muted)]">
                  {e.ipAddress ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </calcite-card>
  );
}

function SettingsFees() {
  const [schedules, setSchedules] = useState<FeeSchedule[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [recordTypes, setRecordTypes] = useState<RecordType[]>([]);
  const [records, setRecords] = useState<TaxpayerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [recordSearch, setRecordSearch] = useState("");
  const [scheduleMessage, setScheduleMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState({
    scheduleName: "",
    recordTypeId: "",
    zoneId: "",
    amount: "",
    billingPeriod: "annual",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: "",
    isActive: true,
  });
  const [assignmentDraft, setAssignmentDraft] = useState({
    recordId: "",
    scheduleId: "",
    billingYear: String(new Date().getFullYear()),
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  });
  const [bulkDraft, setBulkDraft] = useState({
    zoneId: "",
    scheduleId: "",
    recordTypeId: "",
    billingYear: String(new Date().getFullYear()),
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  });
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [savingBulk, setSavingBulk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feeTab, setFeeTab] = useState<"create" | "assign" | "bulk">("create");

  const loadSchedules = () =>
    api.fees
      .schedules({ activeOnly: false })
      .then(setSchedules)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load schedules"),
      );

  useEffect(() => {
    Promise.all([
      api.fees.schedules({ activeOnly: false }),
      api.zones.list(),
      api.records.types(),
      api.records.list({ limit: 25, search: recordSearch.trim() || undefined }),
    ])
      .then(([scheduleList, zoneList, typeList, recordPage]) => {
        setSchedules(scheduleList);
        setZones(zoneList);
        setRecordTypes(typeList);
        setRecords(recordPage.data);
        if (!assignmentDraft.recordId && recordPage.data[0]) {
          setAssignmentDraft((current) => ({ ...current, recordId: String(recordPage.data[0].recordId) }));
        }
        if (!assignmentDraft.scheduleId && scheduleList[0]) {
          setAssignmentDraft((current) => ({ ...current, scheduleId: String(scheduleList[0].scheduleId) }));
        }
        if (!bulkDraft.scheduleId && scheduleList[0]) {
          setBulkDraft((current) => ({ ...current, scheduleId: String(scheduleList[0].scheduleId) }));
        }
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load fee tools"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      api.records
        .list({ limit: 25, search: recordSearch.trim() || undefined })
        .then((page) => setRecords(page.data))
        .catch(() => setRecords([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [recordSearch]);

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setScheduleMessage(null);
    setSavingSchedule(true);
    try {
      await api.fees.createSchedule({
        scheduleName: scheduleDraft.scheduleName.trim(),
        recordTypeId: Number(scheduleDraft.recordTypeId),
        zoneId: scheduleDraft.zoneId ? Number(scheduleDraft.zoneId) : null,
        amount: Number(scheduleDraft.amount),
        billingPeriod: scheduleDraft.billingPeriod,
        effectiveFrom: scheduleDraft.effectiveFrom,
        effectiveTo: scheduleDraft.effectiveTo || null,
        isActive: scheduleDraft.isActive,
      });
      setScheduleMessage({ kind: "ok", text: "Fee schedule created." });
      setScheduleDraft((current) => ({
        ...current,
        scheduleName: "",
        amount: "",
        effectiveTo: "",
      }));
      await loadSchedules();
    } catch (err) {
      setScheduleMessage({ kind: "err", text: err instanceof Error ? err.message : "Could not create schedule" });
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleAssignFee = async (e: React.FormEvent) => {
    e.preventDefault();
    setScheduleMessage(null);
    setSavingAssignment(true);
    try {
      await api.fees.assign({
        recordId: Number(assignmentDraft.recordId),
        scheduleId: Number(assignmentDraft.scheduleId),
        billingYear: Number(assignmentDraft.billingYear),
        dueDate: assignmentDraft.dueDate,
      });
      setScheduleMessage({ kind: "ok", text: "Fee assigned to record." });
    } catch (err) {
      setScheduleMessage({ kind: "err", text: err instanceof Error ? err.message : "Could not assign fee" });
    } finally {
      setSavingAssignment(false);
    }
  };

  const handleBulkAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    setScheduleMessage(null);
    setSavingBulk(true);
    try {
      await api.fees.assignBulk({
        zoneId: Number(bulkDraft.zoneId),
        scheduleId: Number(bulkDraft.scheduleId),
        billingYear: Number(bulkDraft.billingYear),
        dueDate: bulkDraft.dueDate,
        recordTypeId: bulkDraft.recordTypeId ? Number(bulkDraft.recordTypeId) : undefined,
      });
      setScheduleMessage({ kind: "ok", text: "Bulk fee assignment submitted." });
    } catch (err) {
      setScheduleMessage({ kind: "err", text: err instanceof Error ? err.message : "Could not bulk assign fees" });
    } finally {
      setSavingBulk(false);
    }
  };

  if (loading) return <calcite-card class="dash-card" style={{ minHeight: 280 }} loading />;

  const activeCount = schedules.filter((s) => s.isActive).length;
  const totalAmount = schedules
    .filter((s) => s.isActive)
    .reduce((sum, s) => sum + Number(s.amount || 0), 0);

  return (
    <div className="flex flex-col gap-3">
      {/* ── Header strip: title + lightweight stats ─────────────────── */}
      <calcite-card class="dash-card section-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold leading-tight">Fees</h2>
          <p className="mt-0.5 text-[11.5px] text-[var(--muted)]">
            Define how much each record type owes, then assign rules to records.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-[var(--line)] bg-[var(--soft-fill)] px-2.5 py-1 text-[11px]">
            <span className="text-[var(--muted)]">Schedules </span>
            <span className="font-semibold">{schedules.length}</span>
          </span>
          <span className="rounded-md border border-[var(--line)] bg-[var(--soft-fill)] px-2.5 py-1 text-[11px]">
            <span className="text-[var(--muted)]">Active </span>
            <span className="font-semibold text-[var(--success)]">{activeCount}</span>
          </span>
          <span className="rounded-md border border-[var(--line)] bg-[var(--soft-fill)] px-2.5 py-1 text-[11px]">
            <span className="text-[var(--muted)]">Active sum </span>
            <span className="font-semibold">KES {totalAmount.toLocaleString()}</span>
          </span>
        </div>
        </div>
      </calcite-card>

      {scheduleMessage && (
        <calcite-notice
          open
          icon={scheduleMessage.kind === "ok" ? "check-circle" : "exclamation-mark-triangle"}
          kind={scheduleMessage.kind === "ok" ? "success" : "danger"}
          scale="s"
          closable
          onCalciteNoticeClose={() => setScheduleMessage(null)}
        >
          <div slot="title">{scheduleMessage.kind === "ok" ? "Done" : "Action failed"}</div>
          <div slot="message">{scheduleMessage.text}</div>
        </calcite-notice>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">

      {/* ── Tabbed form panel: one card, one task at a time ────────── */}
      <calcite-card class="dash-card section-card xl:sticky xl:top-3 xl:self-start">
        <nav
          className="mb-4 inline-flex rounded-lg border border-[var(--line)] bg-[var(--soft-fill)] p-1 text-[12px] font-medium"
          role="tablist"
          aria-label="Fee actions"
        >
          {(["create", "assign", "bulk"] as const).map((id) => {
            const labels = {
              create: "Create schedule",
              assign: "Assign fee",
              bulk: "Bulk assign",
            } as const;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={feeTab === id}
                onClick={() => setFeeTab(id)}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  feeTab === id
                    ? "bg-[var(--surface)] text-[var(--primary)] shadow-sm"
                    : "text-[var(--muted)] hover:text-[var(--on-surface)]"
                }`}
              >
                {labels[id]}
              </button>
            );
          })}
        </nav>

        {feeTab === "create" && (
          <form onSubmit={handleCreateSchedule} className="space-y-3">
            <label className="block">
              <span className="auth-label">Schedule name</span>
              <input
                className="auth-input"
                value={scheduleDraft.scheduleName}
                onChange={(e) => setScheduleDraft({ ...scheduleDraft, scheduleName: e.target.value })}
                placeholder="e.g. Annual Land Rates FY 2026/27"
                required
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="auth-label">Record type</span>
                <div className="auth-input-shell">
                  <select
                    className="auth-input auth-input--bare"
                    value={scheduleDraft.recordTypeId}
                    onChange={(e) => setScheduleDraft({ ...scheduleDraft, recordTypeId: e.target.value })}
                    required
                  >
                    <option value="">Choose type</option>
                    {recordTypes.map((type) => (
                      <option key={type.recordTypeId} value={String(type.recordTypeId)}>
                        {type.typeName}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="mr-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
                </div>
              </label>
              <label className="block">
                <span className="auth-label">Zone</span>
                <div className="auth-input-shell">
                  <select
                    className="auth-input auth-input--bare"
                    value={scheduleDraft.zoneId}
                    onChange={(e) => setScheduleDraft({ ...scheduleDraft, zoneId: e.target.value })}
                  >
                    <option value="">All zones (default rule)</option>
                    {zones.map((zone) => (
                      <option key={zone.zoneId} value={String(zone.zoneId)}>
                        {zone.zoneName}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="mr-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
                </div>
              </label>
              <label className="block">
                <span className="auth-label">Amount (KES)</span>
                <input
                  type="number"
                  className="auth-input"
                  value={scheduleDraft.amount}
                  onChange={(e) => setScheduleDraft({ ...scheduleDraft, amount: e.target.value })}
                  required
                  min="0"
                  step="0.01"
                />
              </label>
              <label className="block">
                <span className="auth-label">Billing period</span>
                <div className="auth-input-shell">
                  <select
                    className="auth-input auth-input--bare"
                    value={scheduleDraft.billingPeriod}
                    onChange={(e) => setScheduleDraft({ ...scheduleDraft, billingPeriod: e.target.value })}
                  >
                    <option value="annual">Annual</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="monthly">Monthly</option>
                    <option value="one-time">One-time</option>
                  </select>
                  <ChevronDown className="mr-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
                </div>
              </label>
              <label className="block">
                <span className="auth-label">Effective from</span>
                <input
                  type="date"
                  className="auth-input"
                  value={scheduleDraft.effectiveFrom}
                  onChange={(e) => setScheduleDraft({ ...scheduleDraft, effectiveFrom: e.target.value })}
                  required
                />
              </label>
              <label className="block">
                <span className="auth-label">Effective to (optional)</span>
                <input
                  type="date"
                  className="auth-input"
                  value={scheduleDraft.effectiveTo}
                  onChange={(e) => setScheduleDraft({ ...scheduleDraft, effectiveTo: e.target.value })}
                />
              </label>
            </div>
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={scheduleDraft.isActive}
                  onChange={(e) => setScheduleDraft({ ...scheduleDraft, isActive: e.target.checked })}
                />
                Active schedule
              </label>
              <button type="submit" className="primary-control" disabled={savingSchedule}>
                {savingSchedule ? "Saving…" : "Create schedule"}
              </button>
            </div>
          </form>
        )}

        {feeTab === "assign" && (
          <form onSubmit={handleAssignFee} className="space-y-3">
            <label className="block">
              <span className="auth-label">Search record</span>
              <input
                className="auth-input"
                value={recordSearch}
                onChange={(e) => setRecordSearch(e.target.value)}
                placeholder="Type a taxpayer name…"
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="auth-label">Record</span>
                <div className="auth-input-shell">
                  <select
                    className="auth-input auth-input--bare"
                    value={assignmentDraft.recordId}
                    onChange={(e) => setAssignmentDraft({ ...assignmentDraft, recordId: e.target.value })}
                    required
                  >
                    <option value="">Choose record</option>
                    {records.map((record) => (
                      <option key={record.recordId} value={String(record.recordId)}>
                        {record.taxpayerName} · {record.zoneName}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="mr-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
                </div>
              </label>
              <label className="block">
                <span className="auth-label">Fee schedule</span>
                <div className="auth-input-shell">
                  <select
                    className="auth-input auth-input--bare"
                    value={assignmentDraft.scheduleId}
                    onChange={(e) => setAssignmentDraft({ ...assignmentDraft, scheduleId: e.target.value })}
                    required
                  >
                    <option value="">Choose schedule</option>
                    {schedules.map((schedule) => (
                      <option key={schedule.scheduleId} value={String(schedule.scheduleId)}>
                        {schedule.scheduleName}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="mr-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
                </div>
              </label>
              <label className="block">
                <span className="auth-label">Billing year</span>
                <input
                  className="auth-input"
                  type="number"
                  min="2020"
                  max="2100"
                  value={assignmentDraft.billingYear}
                  onChange={(e) => setAssignmentDraft({ ...assignmentDraft, billingYear: e.target.value })}
                  required
                />
              </label>
              <label className="block">
                <span className="auth-label">Due date</span>
                <input
                  className="auth-input"
                  type="date"
                  value={assignmentDraft.dueDate}
                  onChange={(e) => setAssignmentDraft({ ...assignmentDraft, dueDate: e.target.value })}
                  required
                />
              </label>
            </div>
            <div className="flex justify-end">
              <button type="submit" className="primary-control" disabled={savingAssignment}>
                {savingAssignment ? "Assigning…" : "Assign fee"}
              </button>
            </div>
          </form>
        )}

        {feeTab === "bulk" && (
          <form onSubmit={handleBulkAssign} className="space-y-3">
            <p className="rounded-md border border-dashed border-[var(--line)] bg-[var(--soft-fill)] px-3 py-2 text-[11.5px] text-[var(--muted)]">
              Applies one fee schedule to every active record in a zone (filtered
              optionally by record type) for a billing year. Records that already
              have this schedule for the year are skipped.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="auth-label">Zone</span>
                <div className="auth-input-shell">
                  <select
                    className="auth-input auth-input--bare"
                    value={bulkDraft.zoneId}
                    onChange={(e) => setBulkDraft({ ...bulkDraft, zoneId: e.target.value })}
                    required
                  >
                    <option value="">Choose zone</option>
                    {zones.map((zone) => (
                      <option key={zone.zoneId} value={String(zone.zoneId)}>
                        {zone.zoneName}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="mr-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
                </div>
              </label>
              <label className="block">
                <span className="auth-label">Schedule</span>
                <div className="auth-input-shell">
                  <select
                    className="auth-input auth-input--bare"
                    value={bulkDraft.scheduleId}
                    onChange={(e) => setBulkDraft({ ...bulkDraft, scheduleId: e.target.value })}
                    required
                  >
                    <option value="">Choose schedule</option>
                    {schedules.map((schedule) => (
                      <option key={schedule.scheduleId} value={String(schedule.scheduleId)}>
                        {schedule.scheduleName}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="mr-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
                </div>
              </label>
              <label className="block">
                <span className="auth-label">Record type filter</span>
                <div className="auth-input-shell">
                  <select
                    className="auth-input auth-input--bare"
                    value={bulkDraft.recordTypeId}
                    onChange={(e) => setBulkDraft({ ...bulkDraft, recordTypeId: e.target.value })}
                  >
                    <option value="">All record types</option>
                    {recordTypes.map((type) => (
                      <option key={type.recordTypeId} value={String(type.recordTypeId)}>
                        {type.typeName}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="mr-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
                </div>
              </label>
              <label className="block">
                <span className="auth-label">Billing year</span>
                <input
                  className="auth-input"
                  type="number"
                  min="2020"
                  max="2100"
                  value={bulkDraft.billingYear}
                  onChange={(e) => setBulkDraft({ ...bulkDraft, billingYear: e.target.value })}
                  required
                />
              </label>
              <label className="block md:col-span-2">
                <span className="auth-label">Due date</span>
                <input
                  className="auth-input"
                  type="date"
                  value={bulkDraft.dueDate}
                  onChange={(e) => setBulkDraft({ ...bulkDraft, dueDate: e.target.value })}
                  required
                />
              </label>
            </div>
            <div className="flex justify-end">
              <button type="submit" className="primary-control" disabled={savingBulk}>
                {savingBulk ? "Submitting…" : "Assign to zone"}
              </button>
            </div>
          </form>
        )}
      </calcite-card>

      {/* ── Configured schedules table ──────────────────────────────── */}
      <calcite-card class="dash-card flush-card">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <div>
            <h3 className="panel-title">Configured schedules</h3>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              {schedules.length} total · {activeCount} active
            </p>
          </div>
        </div>
        {error ? (
          <div className="p-4">
            <calcite-notice open icon="exclamation-mark-triangle" kind="danger" scale="s">
              <div slot="title">Could not load fee schedules</div>
              <div slot="message">{error}</div>
            </calcite-notice>
          </div>
        ) : schedules.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12.5px] text-[var(--muted)]">
            No fee schedules yet — create one with the form above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[12.5px] [&_th]:px-4 [&_td]:px-4">
              <thead className="label border-b border-[var(--line)]">
                <tr>
                  <th className="py-2.5">Schedule</th>
                  <th>Type</th>
                  <th>Zone</th>
                  <th>Period</th>
                  <th className="text-right">Amount</th>
                  <th>Effective</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.scheduleId} className="border-b border-[var(--line)] hover:bg-[var(--soft-fill)]">
                    <td className="py-2.5 font-medium">{s.scheduleName}</td>
                    <td className="text-[var(--muted)]">{s.recordTypeName}</td>
                    <td className="text-[var(--muted)]">{s.zoneName ?? "All zones"}</td>
                    <td className="capitalize text-[var(--muted)]">{s.billingPeriod}</td>
                    <td className="text-right tabular-nums font-semibold">
                      KES {Number(s.amount).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap text-[var(--muted)]">
                      {formatDate(toEpochMs(s.effectiveFrom)) ?? s.effectiveFrom}
                      {s.effectiveTo ? ` → ${formatDate(toEpochMs(s.effectiveTo)) ?? ""}` : ""}
                    </td>
                    <td>
                      <span className={`status ${s.isActive ? "status-success" : "status-warn"}`}>
                        {s.isActive ? "Active" : "Retired"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </calcite-card>

      </div>{/* /xl:grid */}
    </div>
  );
}

function SettingsProfile({ user }: { user: BackendUser }) {
  return (
    <div className="space-y-3">
      <calcite-card class="dash-card section-card">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="profile-avatar">{initialsOf(user)}</div>
            <div>
              <h2 className="text-xl font-semibold leading-tight">{user.name}</h2>
              <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">
                <a className="hover:underline" href={`mailto:${user.email}`}>
                  {user.email}
                </a>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="status status-success">{roleLabelOf(user.role)}</span>
                {user.zoneName && <span className="status">{user.zoneName}</span>}
              </div>
            </div>
          </div>
        </div>
      </calcite-card>

      <div className="grid gap-3 md:grid-cols-2">
        <calcite-card class="dash-card section-card">
          <h3 className="panel-title mb-3">Identity</h3>
          <DetailRow label="Name" value={user.name} />
          <DetailRow label="Email" value={user.email} />
          <DetailRow label="Role" value={roleLabelOf(user.role)} />
          <DetailRow label="Zone" value={user.zoneName ?? "—"} />
          <DetailRow label="User ID" value={String(user.userId)} mono />
        </calcite-card>

        <calcite-card class="dash-card section-card">
          <h3 className="panel-title mb-3">Activity</h3>
          <DetailRow label="Last login" value={formatRelative(toEpochMs(user.lastLoginAt))} />
        </calcite-card>
      </div>
    </div>
  );
}
function SettingsSecurity({ user }: { user: BackendUser }) {
  return (
    <calcite-card class="dash-card section-card">
      <div className="space-y-2.5">
      <h2 className="text-lg font-semibold">Security</h2>
      <div className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--soft-fill)] p-3">
        <div>
          <p className="text-[13px] font-semibold">Sign-in method</p>
          <p className="text-[11px] text-[var(--muted)]">
            Email + password · JWT bearer token
          </p>
        </div>
        <span className="status status-success">Active</span>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--soft-fill)] p-3">
        <div>
          <p className="text-[13px] font-semibold">Session token</p>
          <p className="text-[11px] text-[var(--muted)]">
            8-hour rolling · re-auth required after expiry
          </p>
        </div>
        <span className="status status-success">Encrypted</span>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--soft-fill)] p-3">
        <div>
          <p className="text-[13px] font-semibold">Account</p>
          <p className="text-[11px] text-[var(--muted)]">
            #{user.userId} · {user.email}
          </p>
        </div>
        <span className="status">{roleLabelOf(user.role)}</span>
      </div>
      </div>
    </calcite-card>
  );
}
/* ─────────────────────────────────────────────────────────────────────
   Zones — administrative hierarchy management (admin only)
   ───────────────────────────────────────────────────────────────────── */

const ZONE_TYPES = ["county", "subcounty", "ward", "village"] as const;

function SettingsZones() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [draft, setDraft] = useState<{
    zoneName: string;
    zoneCode: string;
    zoneType: (typeof ZONE_TYPES)[number];
    parentZoneId: string;
  }>({
    zoneName: "",
    zoneCode: "",
    zoneType: "ward",
    parentZoneId: "",
  });

  const loadZones = () =>
    api.zones
      .list()
      .then((z) => {
        setZones(z);
        setError(null);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load zones"),
      )
      .finally(() => setLoading(false));

  useEffect(() => {
    loadZones();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const res = await api.zones.create({
        zoneName: draft.zoneName.trim(),
        zoneCode: draft.zoneCode.trim(),
        zoneType: draft.zoneType,
        parentZoneId: draft.parentZoneId ? Number(draft.parentZoneId) : undefined,
      });
      setMessage({ kind: "ok", text: `Zone created (#${res.zoneId}).` });
      setDraft({ zoneName: "", zoneCode: "", zoneType: "ward", parentZoneId: "" });
      await loadZones();
    } catch (err) {
      setMessage({
        kind: "err",
        text: err instanceof Error ? err.message : "Could not create zone",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <calcite-card class="dash-card" style={{ minHeight: 280 }} loading />;

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      {/* Create form */}
      <calcite-card class="dash-card section-card xl:sticky xl:top-3 xl:self-start">
      <form
        onSubmit={handleCreate}
        className="space-y-3"
      >
        <div>
          <h3 className="panel-title">Add a zone</h3>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            Sub-counties, wards and villages drive fee-schedule lookup.
          </p>
        </div>

        {message && (
          <calcite-notice
            open
            icon={message.kind === "ok" ? "check-circle" : "exclamation-mark-triangle"}
            kind={message.kind === "ok" ? "success" : "danger"}
            scale="s"
            closable
            onCalciteNoticeClose={() => setMessage(null)}
          >
            <div slot="title">{message.kind === "ok" ? "Done" : "Failed"}</div>
            <div slot="message">{message.text}</div>
          </calcite-notice>
        )}

        <label className="block">
          <span className="auth-label">Zone name</span>
          <input
            className="auth-input"
            value={draft.zoneName}
            onChange={(e) => setDraft({ ...draft, zoneName: e.target.value })}
            placeholder="e.g. Westlands Ward"
            required
          />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="auth-label">Zone code</span>
            <input
              className="auth-input"
              value={draft.zoneCode}
              onChange={(e) => setDraft({ ...draft, zoneCode: e.target.value })}
              placeholder="e.g. WL-WARD"
              required
            />
          </label>
          <label className="block">
            <span className="auth-label">Zone type</span>
            <div className="auth-input-shell">
              <select
                className="auth-input auth-input--bare"
                value={draft.zoneType}
                onChange={(e) =>
                  setDraft({ ...draft, zoneType: e.target.value as (typeof ZONE_TYPES)[number] })
                }
              >
                {ZONE_TYPES.map((t) => (
                  <option key={t} value={t} className="capitalize">
                    {t}
                  </option>
                ))}
              </select>
              <ChevronDown className="mr-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
            </div>
          </label>
        </div>
        <label className="block">
          <span className="auth-label">Parent zone (optional)</span>
          <div className="auth-input-shell">
            <select
              className="auth-input auth-input--bare"
              value={draft.parentZoneId}
              onChange={(e) => setDraft({ ...draft, parentZoneId: e.target.value })}
            >
              <option value="">None (top level)</option>
              {zones.map((z) => (
                <option key={z.zoneId} value={String(z.zoneId)}>
                  {z.zoneName} ({z.zoneType})
                </option>
              ))}
            </select>
            <ChevronDown className="mr-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
          </div>
        </label>
        <div className="flex justify-end pt-1">
          <button type="submit" className="primary-control" disabled={saving}>
            <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
            {saving ? "Creating…" : "Create zone"}
          </button>
        </div>
      </form>
      </calcite-card>

      {/* Existing zones */}
      <calcite-card class="dash-card flush-card">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <div>
            <h3 className="panel-title">Zones</h3>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              {zones.length} configured
            </p>
          </div>
        </div>
        {error ? (
          <div className="p-4">
            <calcite-notice open icon="exclamation-mark-triangle" kind="danger" scale="s">
              <div slot="title">Could not load zones</div>
              <div slot="message">{error}</div>
            </calcite-notice>
          </div>
        ) : zones.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12.5px] text-[var(--muted)]">
            No zones yet — add one with the form.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[12.5px] [&_th]:px-4 [&_td]:px-4">
              <thead className="label border-b border-[var(--line)]">
                <tr>
                  <th className="py-2.5">Zone</th>
                  <th>Code</th>
                  <th>Type</th>
                  <th>Parent</th>
                  <th className="text-right">Records</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr
                    key={z.zoneId}
                    className="border-b border-[var(--line)] hover:bg-[var(--soft-fill)]"
                  >
                    <td className="py-2.5 font-medium">{z.zoneName}</td>
                    <td className="font-mono text-[11px] text-[var(--muted)]">{z.zoneCode}</td>
                    <td className="capitalize text-[var(--muted)]">{z.zoneType}</td>
                    <td className="text-[var(--muted)]">{z.parentZoneName ?? "—"}</td>
                    <td className="text-right tabular-nums">{z.recordCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </calcite-card>
    </div>
  );
}

export { ArcgisConfig, SettingsArcGIS, SettingsUsers, SettingsAudit, SettingsFees, SettingsZones, SettingsProfile, SettingsSecurity };
