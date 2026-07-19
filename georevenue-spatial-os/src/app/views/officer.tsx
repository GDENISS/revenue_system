"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ClipboardList, ExternalLink, Plus, RefreshCw, Search, X } from "lucide-react";
import {
  api,
  ApiError,
  type FieldTask,
  type Role,
  type RecordType,
  type TaxpayerRecord,
  type Zone,
} from "../lib/api";
import {
  type View,
  formatDate,
  formatKesM,
  formatRelative,
  toEpochMs,
} from "../lib/shared";
import { AddRecordModal } from "./record";

/**
 * Officer workspace: a focused queue of taxpayer records that still need
 * geometry captured in ArcGIS. Officers create taxpayer records here
 * (attribute-only — no lat/lng). Once the GIS team draws the parcel in
 * ArcGIS, the operator opens Map → clicks the new parcel → "Link existing
 * taxpayer" to bind the record.
 */
function OfficerDashboard({
  onNavigate,
  onOpenRecord,
  role,
}: {
  onNavigate: (v: View) => void;
  onOpenRecord: (id: number) => void;
  role: Role;
}) {
  // GIS officers and admins assign capture tasks; field officers work them.
  const isAssigner = role === "admin" || role === "gis_officer";
  const [zones, setZones] = useState<Zone[]>([]);
  const [recordTypes, setRecordTypes] = useState<RecordType[]>([]);
  const [unmapped, setUnmapped] = useState<TaxpayerRecord[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [zoneFilter, setZoneFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; message: string } | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Field-capture tasks: officers see their own; assigners see all active.
  const [tasks, setTasks] = useState<FieldTask[]>([]);
  const [assignTarget, setAssignTarget] = useState<TaxpayerRecord | null>(null);

  const loadTasks = () => {
    api.tasks
      .list(isAssigner ? {} : { mine: true })
      .then((res) =>
        setTasks(res.data.filter((t) => t.status === "open" || t.status === "in_progress")),
      )
      .catch(() => setTasks([]));
  };

  useEffect(() => {
    loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateTaskStatus = (task: FieldTask, status: FieldTask["status"]) => {
    api.tasks
      .setStatus(task.taskId, status)
      .then(() => {
        setToast({
          kind: "ok",
          message:
            status === "done"
              ? `Task for ${task.taxpayerName ?? "record"} marked done.`
              : status === "cancelled"
                ? "Task cancelled."
                : "Task started.",
        });
        loadTasks();
      })
      .catch((err) =>
        setToast({
          kind: "err",
          message: err instanceof Error ? err.message : "Could not update task",
        }),
      );
  };

  useEffect(() => {
    Promise.all([api.zones.list(), api.records.types()])
      .then(([z, t]) => {
        setZones(z);
        setRecordTypes(t);
      })
      .catch(() => undefined);
  }, []);

  const fetchUnmapped = (silent = false) => {
    if (!silent) setLoading(true);
    return api.records
      .list({
        limit: 200,
        unmapped: true,
        search: search.trim() || undefined,
        zoneId: zoneFilter ? Number(zoneFilter) : undefined,
        recordTypeId: typeFilter ? Number(typeFilter) : undefined,
      })
      .then((res) => {
        setUnmapped(res.data);
        setTotal(res.pagination.total);
        setFetchError(null);
      })
      .catch((err) => {
        setUnmapped([]);
        setTotal(0);
        setFetchError(
          err instanceof ApiError && err.status === 0
            ? `Cannot reach the API (${api.baseUrl}). Is the backend running?`
            : err instanceof Error
              ? err.message
              : "Could not load the unmapped queue.",
        );
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const id = setTimeout(() => fetchUnmapped(false), 200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, zoneFilter, typeFilter]);

  // Derive the three KPI numbers from the current queue so the tiles stay in
  // sync with the table beneath them whenever filters change.
  const stats = useMemo(() => {
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    let thisWeek = 0;
    let oldestEpoch: number | null = null;
    for (const r of unmapped) {
      const epoch = toEpochMs(r.submissionDate);
      if (epoch == null) continue;
      if (now - epoch <= weekMs) thisWeek += 1;
      if (oldestEpoch == null || epoch < oldestEpoch) oldestEpoch = epoch;
    }
    return { thisWeek, oldestEpoch };
  }, [unmapped]);

  const resetFilters = () => {
    setSearch("");
    setZoneFilter("");
    setTypeFilter("");
  };
  const filtersActive = Boolean(search || zoneFilter || typeFilter);

  return (
    <section className="flex flex-col gap-3">
      {/* ── KPI row — three balanced tiles, same pattern as the dashboard. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <calcite-card class="dash-card kpi-card">
          <p className="label">Awaiting GIS link</p>
          <p className="mt-2 text-[22px] font-semibold tabular-nums leading-tight">
            {total ?? 0}
          </p>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            {total === 1 ? "record" : "records"} in queue
          </p>
        </calcite-card>

        <calcite-card class="dash-card kpi-card">
          <p className="label">Captured this week</p>
          <p
            className="mt-2 text-[22px] font-semibold tabular-nums leading-tight"
            style={{ color: "var(--success)" }}
          >
            {stats.thisWeek}
          </p>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            added in the last 7 days
          </p>
        </calcite-card>

        <calcite-card class="dash-card kpi-card">
          <p className="label">Oldest in queue</p>
          <p
            className="mt-2 text-[15px] font-semibold leading-tight"
            style={{ color: stats.oldestEpoch == null ? "var(--muted)" : "#9c8a06" }}
          >
            {stats.oldestEpoch == null
              ? "queue empty"
              : (formatRelative(stats.oldestEpoch) ?? "just now")}
          </p>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            {stats.oldestEpoch == null
              ? "no records waiting"
              : "needs GIS attention"}
          </p>
        </calcite-card>
      </div>

      {fetchError && (
        <calcite-notice open icon="exclamation-mark-triangle" kind="danger" scale="s" closable onCalciteNoticeClose={() => setFetchError(null)}>
          <div slot="title">Could not load the queue</div>
          <div slot="message">{fetchError}</div>
          <calcite-action slot="actions-end" icon="refresh" text="Retry" onClick={() => fetchUnmapped(false)} />
        </calcite-notice>
      )}

      {/* ── Toolbar — search + zone + type + actions on one symmetric row. */}
      <calcite-card class="dash-card section-card">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] max-w-[360px] flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]"
              strokeWidth={2.2}
            />
            <input
              type="text"
              className="auth-input !h-8 !pl-8 !text-[12px]"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by taxpayer name…"
            />
          </div>
          <div className="auth-input-shell !h-8 w-[150px]">
            <select
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value)}
              className="auth-input auth-input--bare !text-[12px]"
              aria-label="Zone"
            >
              <option value="">All zones</option>
              {zones.map((z) => (
                <option key={z.zoneId} value={String(z.zoneId)}>
                  {z.zoneName}
                </option>
              ))}
            </select>
            <ChevronDown className="mr-2 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
          </div>
          <div className="auth-input-shell !h-8 w-[150px]">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="auth-input auth-input--bare !text-[12px]"
              aria-label="Record type"
            >
              <option value="">All types</option>
              {recordTypes.map((t) => (
                <option key={t.recordTypeId} value={String(t.recordTypeId)}>
                  {t.typeName}
                </option>
              ))}
            </select>
            <ChevronDown className="mr-2 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
          </div>
          {filtersActive && (
            <button
              type="button"
              className="control !h-8 !text-[11px]"
              onClick={resetFilters}
              title="Clear filters"
            >
              Clear
            </button>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            <span className="hidden text-[11px] text-[var(--muted)] sm:inline">
              {unmapped.length} shown
            </span>
            <button
              type="button"
              className="control !h-8"
              onClick={() => fetchUnmapped(true)}
              title="Refresh queue"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} strokeWidth={2.2} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              type="button"
              className="primary-control !h-8"
              onClick={() => setShowAdd(true)}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
              <span>New taxpayer</span>
            </button>
          </span>
        </div>
      </calcite-card>

      {/* ── Field tasks — capture assignments in flight. Officers see their
          own; GIS officers/admins see everyone's. */}
      {tasks.length > 0 && (
        <calcite-card class="dash-card section-card">
          <div className="mb-3 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-[var(--primary)]" strokeWidth={2.2} />
            <p className="text-[13px] font-semibold leading-tight">
              Field tasks
              <span className="ml-2 font-normal text-[var(--muted)]">
                {tasks.length} active
              </span>
            </p>
          </div>
          <div className="space-y-1.5">
            {tasks.map((t) => (
              <div
                key={t.taskId}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--soft-fill)] px-3 py-2 text-[12px]"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background:
                      t.priority === "high"
                        ? "var(--error)"
                        : t.priority === "normal"
                          ? "var(--primary)"
                          : "var(--muted)",
                  }}
                  title={`${t.priority} priority`}
                />
                <button
                  type="button"
                  className="font-semibold hover:underline"
                  onClick={() => onOpenRecord(t.recordId)}
                >
                  {t.taxpayerName ?? `Record #${t.recordId}`}
                </button>
                <span className="text-[var(--muted)]">
                  {t.recordType} · {t.zoneName}
                  {t.dueDate ? ` · due ${formatDate(toEpochMs(t.dueDate)) ?? t.dueDate}` : ""}
                </span>
                {isAssigner && (
                  <span className="text-[11px] text-[var(--muted)]">
                    → {t.assignedToName}
                  </span>
                )}
                <span
                  className={`status ${t.status === "in_progress" ? "status-success" : ""}`}
                >
                  {t.status === "in_progress" ? "in progress" : t.status}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  {t.links?.survey123 && (
                    <a
                      href={t.links.survey123}
                      target="_blank"
                      rel="noreferrer"
                      className="control !h-7 !text-[11px]"
                      title="Open prefilled Survey123 form"
                    >
                      <ExternalLink className="h-3 w-3" strokeWidth={2.2} />
                      Survey123
                    </a>
                  )}
                  {t.links?.fieldMaps && (
                    <a
                      href={t.links.fieldMaps}
                      target="_blank"
                      rel="noreferrer"
                      className="control !h-7 !text-[11px]"
                      title="Open in Field Maps"
                    >
                      <ExternalLink className="h-3 w-3" strokeWidth={2.2} />
                      Field Maps
                    </a>
                  )}
                  {t.status === "open" && (
                    <button
                      type="button"
                      className="control !h-7 !text-[11px]"
                      onClick={() => updateTaskStatus(t, "in_progress")}
                    >
                      Start
                    </button>
                  )}
                  {isAssigner && (
                    <button
                      type="button"
                      className="icon-btn !h-7 !w-7"
                      onClick={() => updateTaskStatus(t, "cancelled")}
                      title="Cancel task"
                      aria-label="Cancel task"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2.2} />
                    </button>
                  )}
                </span>
                {t.instructions && (
                  <p className="w-full pl-4 text-[11px] text-[var(--muted)]">
                    {t.instructions}
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10.5px] text-[var(--muted)]">
            Tasks complete automatically when the record is linked to a parcel —
            via Map, or when a Survey123 / Field Maps capture syncs in.
          </p>
        </calcite-card>
      )}

      {/* Queue table */}
      <calcite-card class="dash-card flush-card zone-card">
        <table className="w-full min-w-[680px] text-[12.5px]">
          <thead className="label border-b border-[var(--line)]">
            <tr className="[&_th]:px-3 [&_th]:py-2.5">
              <th className="text-left">Taxpayer</th>
              <th className="text-left">Type</th>
              <th className="text-left">Zone</th>
              <th className="text-left">Status</th>
              <th className="text-right">Captured</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && unmapped.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-[var(--muted)]">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && unmapped.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center">
                  <div className="mx-auto flex max-w-[420px] flex-col items-center gap-2">
                    <p className="text-[13px] font-semibold text-[var(--on-surface)]">
                      {filtersActive
                        ? "No records match these filters."
                        : "Queue clear. GIS is caught up."}
                    </p>
                    <p className="text-[11.5px] text-[var(--muted)]">
                      {filtersActive
                        ? "Try clearing the search, zone, or type filter."
                        : "Every taxpayer record has a parcel link. Capture a new one to start the next round."}
                    </p>
                    {filtersActive ? (
                      <button
                        type="button"
                        className="control mt-1 !h-8 !text-[11px]"
                        onClick={resetFilters}
                      >
                        Clear filters
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="primary-control mt-1 !h-8"
                        onClick={() => setShowAdd(true)}
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
                        Capture a new taxpayer
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}
            {unmapped.map((r) => (
              <tr
                key={r.recordId}
                className="cursor-pointer border-b border-[var(--line)] hover:bg-[var(--soft-fill)] [&_td]:px-3 [&_td]:py-2.5"
                onClick={() => onOpenRecord(r.recordId)}
              >
                <td>
                  <p className="font-semibold">{r.taxpayerName}</p>
                  {r.taxpayerPhone && (
                    <p className="text-[11px] text-[var(--muted)]">{r.taxpayerPhone}</p>
                  )}
                </td>
                <td className="text-[var(--muted)]">{r.recordType}</td>
                <td className="text-[var(--muted)]">{r.zoneName}</td>
                <td>
                  <span className="status">awaiting GIS</span>
                </td>
                <td className="text-right text-[11px] text-[var(--muted)]">
                  {formatDate(toEpochMs(r.submissionDate)) ?? "—"}
                  {Number(r.outstandingBalance) > 0 && (
                    <p className="mt-0.5 tabular-nums text-[var(--tertiary)]">
                      {formatKesM(Number(r.outstandingBalance))} outstanding
                    </p>
                  )}
                </td>
                <td className="text-right">
                  <span className="flex items-center justify-end gap-1.5">
                    {isAssigner && (
                      <button
                        type="button"
                        className="control !h-7 !text-[11px]"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAssignTarget(r);
                        }}
                        title="Assign a field officer to capture this record's spatial data"
                      >
                        {tasks.some(
                          (t) => t.recordId === r.recordId && t.status !== "done" && t.status !== "cancelled",
                        )
                          ? "Reassign"
                          : "Assign"}
                      </button>
                    )}
                    <ChevronRight className="h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </calcite-card>

      {assignTarget && (
        <AssignTaskModal
          record={assignTarget}
          onClose={() => setAssignTarget(null)}
          onAssigned={(message) => {
            setAssignTarget(null);
            setToast({ kind: "ok", message });
            loadTasks();
          }}
          onError={(message) => setToast({ kind: "err", message })}
        />
      )}

      <p className="text-center text-[11px] text-[var(--muted)]">
        Tip: open <button className="underline" onClick={() => onNavigate("map")}>Map</button>{" "}
        after the GIS team publishes the new parcel, click it, then choose
        “Link existing taxpayer”.
      </p>

      {showAdd && (
        <AddRecordModal
          zones={zones}
          types={recordTypes}
          onClose={() => setShowAdd(false)}
          onCreated={(id, feeAssigned) => {
            setShowAdd(false);
            setToast(
              feeAssigned
                ? {
                    kind: "ok",
                    message: `Record #${id} added to the GIS-link queue — fee auto-assigned.`,
                  }
                : {
                    kind: "err",
                    message: `Record #${id} added, but no fee schedule matched its type/zone — ask a finance manager to define one before billing.`,
                  },
            );
            fetchUnmapped(true);
          }}
          onError={(message) => setToast({ kind: "err", message })}
        />
      )}

      {toast && (
        <calcite-notice
          open
          icon={toast.kind === "ok" ? "check-circle" : "exclamation-mark-triangle"}
          kind={toast.kind === "ok" ? "success" : "danger"}
          scale="s"
          closable
          onCalciteNoticeClose={() => setToast(null)}
        >
          <div slot="title">{toast.kind === "ok" ? "Done" : "Action failed"}</div>
          <div slot="message">{toast.message}</div>
        </calcite-notice>
      )}
    </section>
  );
}

/* ── Assign-task modal — GIS officer picks a field officer + details ── */

function AssignTaskModal({
  record,
  onClose,
  onAssigned,
  onError,
}: {
  record: TaxpayerRecord;
  onClose: () => void;
  onAssigned: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [assignees, setAssignees] = useState<
    { userId: number; name: string; roleName: string; zoneName?: string | null }[]
  >([]);
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal");
  const [dueDate, setDueDate] = useState<string>(() =>
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
  const [instructions, setInstructions] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.tasks
      .assignees()
      .then((res) => {
        setAssignees(res.data);
        if (res.data[0]) setAssignedTo(String(res.data[0].userId));
      })
      .catch(() => setAssignees([]));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignedTo) return;
    setSubmitting(true);
    try {
      const res = await api.tasks.create({
        recordId: record.recordId,
        assignedTo: Number(assignedTo),
        priority,
        dueDate,
        instructions: instructions.trim() || undefined,
      });
      onAssigned(res.message);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not assign task");
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="label">Field data collection</p>
            <h3 className="mt-0.5 text-base font-semibold">{record.taxpayerName}</h3>
            <p className="text-[11px] text-[var(--muted)]">
              {record.recordType} · {record.zoneName} · no spatial data yet
            </p>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Close">
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="auth-label">Assign to</span>
            <div className="auth-input-shell">
              <select
                className="auth-input auth-input--bare"
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                required
              >
                {assignees.length === 0 && <option value="">No field officers found</option>}
                {assignees.map((a) => (
                  <option key={a.userId} value={String(a.userId)}>
                    {a.name}
                    {a.zoneName ? ` · ${a.zoneName}` : ""}
                  </option>
                ))}
              </select>
              <ChevronDown className="mr-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
            </div>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="auth-label">Priority</span>
              <div className="auth-input-shell">
                <select
                  className="auth-input auth-input--bare"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as typeof priority)}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
                <ChevronDown className="mr-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
              </div>
            </label>
            <label className="block">
              <span className="auth-label">Due date</span>
              <input
                type="date"
                className="auth-input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </label>
          </div>

          <label className="block">
            <span className="auth-label">Instructions (optional)</span>
            <textarea
              className="auth-input !h-20 resize-none py-2"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Landmark, plot access notes, who to call on site…"
              maxLength={2000}
            />
          </label>

          <button
            type="submit"
            className="primary-control w-full justify-center"
            disabled={submitting || !assignedTo}
          >
            {submitting ? "Assigning…" : "Assign capture task"}
          </button>
        </form>
      </div>
    </div>
  );
}

export { OfficerDashboard };
