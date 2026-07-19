"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Download, Plus, Search, X } from "lucide-react";
import { ArcGISMap } from "../components/ArcGISMap";
import {
  api,
  ApiError,
  downloadNoticePdf,
  type ManualRecordCreatePayload,
  type Notice,
  type Paged,
  type RecordType,
  type RecordDetail as RecordDetailPayload,
  type TaxpayerRecord,
  type Zone,
} from "../lib/api";
import {
  Icon,
  type View,
  downloadCsv,
  formatDate,
  formatKesM,
  toEpochMs,
} from "../lib/shared";
import { SettingsReports } from "./reports";

type RecordTab = "summary" | "map" | "ledger" | "notices" | "fees";

function RecordDetail({
  recordId,
  onNavigate,
  onOpenRecord,
  onCloseRecord,
  onStartParcelLink,
}: {
  recordId: number | null;
  onNavigate: (v: View) => void;
  onOpenRecord: (id: number) => void;
  onCloseRecord: () => void;
  onStartParcelLink: (recordId: number, recordName: string) => void;
}) {
  const [tab, setTab] = useState<RecordTab>("summary");
  const [record, setRecord] = useState<RecordDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  const reload = () => {
    if (!recordId) return;
    setLoading(true);
    api.records
      .get(recordId)
      .then((r) => {
        setRecord(r);
        setError(null);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load record"),
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!recordId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRecord(null);
      setLoading(false);
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  if (!recordId) {
    return (
      <RecordsList
        onOpenRecord={onOpenRecord}
        onNavigate={onNavigate}
        onStartParcelLink={onStartParcelLink}
      />
    );
  }

  if (loading && !record) {
    return <calcite-card class="dash-card" style={{ height: 480 }} loading />;
  }

  if (error && !record) {
    // 404 = the record was deleted or never existed; treat as a normal "empty"
    // state with a back button, not a scary danger banner.
    const isMissing = /not\s*found/i.test(error);
    return (
      <calcite-card class="dash-card section-card">
        <div className="flex flex-col items-center gap-3 px-2 py-6 text-center">
        <p className="text-[13px] font-semibold">
          {isMissing ? `Record #${recordId} is no longer available` : "Could not load record"}
        </p>
        <p className="max-w-[420px] text-[12px] text-[var(--muted)]">
          {isMissing
            ? "It may have been deleted or you don't have access to it. Go back to the list to pick another record."
            : error}
        </p>
        <button type="button" className="primary-control" onClick={onCloseRecord}>
          <ChevronRight className="h-3.5 w-3.5 rotate-180" strokeWidth={2.4} />
          Back to records
        </button>
        </div>
      </calcite-card>
    );
  }

  if (!record) return null;

  const sections: { id: RecordTab; label: string; icon: string }[] = [
    { id: "summary", label: "Summary", icon: "dashboard" },
    { id: "map", label: "On the map", icon: "map" },
    { id: "fees", label: "Fee assignments", icon: "payments" },
    { id: "ledger", label: "Payments", icon: "receipt_long" },
    { id: "notices", label: "Notices", icon: "fact_check" },
  ];

  // Geometry now lives in ArcGIS — when this record is linked, the
  // attached layer's polygon represents it. The inline map below zooms to
  // that layer's extent automatically; if there's no link, we show a CTA
  // instead of an empty map.
  const isLinkedToParcel = record.arcgisObjectId != null;
  // Guard against a missing/NaN value so the UI never prints "KES NaN".
  const outstanding = Number(record.outstandingBalance) || 0;

  return (
    <section className="grid gap-3 lg:grid-cols-[240px_1fr]">
      <calcite-card class="dash-card section-card record-aside">
        <button
          type="button"
          onClick={onCloseRecord}
          className="control mb-2.5 w-full justify-center !h-8 !text-[11.5px]"
          title="Back to all records"
        >
          <ChevronRight className="h-3.5 w-3.5 rotate-180" strokeWidth={2.4} />
          Back to records
        </button>
        <p className="label mb-2 px-2.5">Record #{record.recordId}</p>
        {record.arcgisObjectId == null ? (
          <button
            type="button"
            className="primary-control mb-2.5 w-full justify-center !h-8"
            onClick={() => onStartParcelLink(record.recordId, record.taxpayerName)}
            title="Pick a parcel on the map and link it to this record"
          >
            Link to parcel
          </button>
        ) : (
          <div className="mb-2.5 rounded-md border border-[var(--line)] bg-[var(--soft-fill)] px-2.5 py-1.5 text-[11px] text-[var(--muted)]">
            Linked OBJECTID{" "}
            <span className="font-mono text-[var(--on-surface)]">
              {record.arcgisObjectId}
            </span>
          </div>
        )}
        <div className="space-y-0.5">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => setTab(section.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg p-2.5 text-left text-[12.5px] transition-colors ${
                tab === section.id
                  ? "bg-[var(--primary-container)] text-[var(--primary)] font-semibold"
                  : "hover:bg-[var(--soft-fill)]"
              }`}
            >
              <Icon>{section.icon}</Icon>
              <span className="flex-1">{section.label}</span>
              {tab === section.id && (
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.4} />
              )}
            </button>
          ))}
        </div>
        <div className="mt-3 border-t border-[var(--line)] pt-3 px-1">
          <button
            className="control w-full justify-start"
            type="button"
            onClick={() => onNavigate("map")}
          >
            <Icon>map</Icon> Back to map
          </button>
        </div>
      </calcite-card>

      <div className="space-y-3">
        <calcite-card class="dash-card section-card">
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
            <div>
              <p className="label">{record.recordType}</p>
              <h2 className="mt-1 flex items-center gap-1.5 text-xl font-semibold">
                {record.taxpayerName}
                {record.arcgisObjectId != null && (
                  <Icon className="text-[var(--primary)]" >verified</Icon>
                )}
              </h2>
              <p className="mt-1 text-[12.5px] text-[var(--muted)]">
                {record.zoneName} · status {record.status}
                {record.taxpayerIdNo ? ` · ID ${record.taxpayerIdNo}` : ""}
              </p>
              {(record.taxpayerPhone || record.taxpayerEmail) && (
                <p className="mt-0.5 text-[12px] text-[var(--muted)]">
                  {record.taxpayerPhone && <span>{record.taxpayerPhone}</span>}
                  {record.taxpayerPhone && record.taxpayerEmail && " · "}
                  {record.taxpayerEmail && (
                    <a className="hover:underline" href={`mailto:${record.taxpayerEmail}`}>
                      {record.taxpayerEmail}
                    </a>
                  )}
                </p>
              )}
            </div>
            <div className="sm:text-right">
              <p className="label">Outstanding balance</p>
              <p
                className="mt-1 text-xl font-semibold tabular-nums"
                style={{
                  color: outstanding > 0 ? "var(--error)" : "var(--success)",
                }}
              >
                KES {outstanding.toLocaleString()}
              </p>
              <button
                className="primary-control mt-2"
                type="button"
                onClick={() => setShowPaymentModal(true)}
                disabled={outstanding <= 0}
              >
                <Icon>payments</Icon> Record payment
              </button>
            </div>
          </div>
        </calcite-card>

        {tab === "summary" && (
          <div className="grid gap-3 xl:grid-cols-[1fr_340px]">
            <calcite-card class="dash-card flush-card" style={{ minHeight: 320 }}>
              {isLinkedToParcel ? (
                <ArcGISMap
                  zoom={13}
                  recordsByObjectId={{
                    [record.arcgisObjectId as number]: "outstanding",
                  }}
                />
              ) : (
                <div className="grid h-full place-items-center px-6 py-10 text-center text-[12.5px] text-[var(--muted)]">
                  <div>
                    <p className="font-semibold text-[var(--on-surface)]">
                      No parcel linked yet
                    </p>
                    <p className="mt-1">
                      Geometry lives in ArcGIS. Link this record to a parcel to
                      see it on the map.
                    </p>
                    <button
                      type="button"
                      className="primary-control mx-auto mt-3"
                      onClick={() => onStartParcelLink(record.recordId, record.taxpayerName)}
                    >
                      Link to parcel
                    </button>
                  </div>
                </div>
              )}
            </calcite-card>
            <calcite-card class="dash-card section-card">
              <h3 className="panel-title mb-3">Attributes</h3>
              {record.attributes.length === 0 ? (
                <p className="text-[12.5px] text-[var(--muted)]">No extra attributes.</p>
              ) : (
                <dl className="space-y-1.5 text-[12.5px]">
                  {record.attributes.map((a) => (
                    <div key={a.attributeKey} className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] py-1.5 last:border-0">
                      <dt className="text-[var(--muted)]">{a.attributeKey}</dt>
                      <dd className="text-right">{a.attributeVal}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="mt-3 border-t border-[var(--line)] pt-3 text-[11px] text-[var(--muted)]">
                Submitted {formatDate(toEpochMs(record.submissionDate)) ?? "—"}
                {record.submittedByName ? ` by ${record.submittedByName}` : ""}
              </div>
            </calcite-card>
          </div>
        )}

        {tab === "map" && (
          <calcite-card class="dash-card flush-card" style={{ minHeight: 460 }}>
            {isLinkedToParcel ? (
              <ArcGISMap
                zoom={14}
                recordsByObjectId={{
                  [record.arcgisObjectId as number]: "outstanding",
                }}
              />
            ) : (
              <div className="grid h-full place-items-center px-6 text-center text-[12.5px] text-[var(--muted)]">
                <div>
                  <p className="font-semibold text-[var(--on-surface)]">No parcel linked</p>
                  <p className="mt-1">Link this record to a parcel to see it on the map.</p>
                  <button
                    type="button"
                    className="primary-control mx-auto mt-3"
                    onClick={() => onStartParcelLink(record.recordId, record.taxpayerName)}
                  >
                    Link to parcel
                  </button>
                </div>
              </div>
            )}
          </calcite-card>
        )}

        {tab === "fees" && <FeeAssignments fees={record.fees} />}
        {tab === "ledger" && <PaymentLedger payments={record.payments} />}
        {tab === "notices" && <NoticesForRecord notices={record.notices} />}
      </div>

      {showPaymentModal && (
        <RecordPaymentModal
          record={record}
          onClose={() => setShowPaymentModal(false)}
          onRecorded={() => {
            setShowPaymentModal(false);
            reload();
          }}
        />
      )}
    </section>
  );
}

function FeeAssignments({ fees }: { fees: RecordDetailPayload["fees"] }) {
  return (
    <calcite-card class="dash-card section-card zone-card">
      <h3 className="panel-title mb-3">Fee assignments</h3>
      {fees.length === 0 ? (
        <p className="text-[12.5px] text-[var(--muted)]">No fees assigned to this record.</p>
      ) : (
        <table className="w-full text-left text-[12.5px]">
          <thead className="label border-b border-[var(--line)]">
            <tr>
              <th className="py-2.5">Schedule</th>
              <th>Period</th>
              <th>Year</th>
              <th className="text-right">Amount due</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {fees.map((f) => (
              <tr key={f.assignmentId} className="border-b border-[var(--line)] hover:bg-[var(--soft-fill)]">
                <td className="py-2.5 font-medium">{f.scheduleName}</td>
                <td className="text-[var(--muted)] capitalize">{f.billingPeriod}</td>
                <td className="text-[var(--muted)] tabular-nums">{f.billingYear}</td>
                <td className="text-right tabular-nums">
                  KES {Number(f.amountDue).toLocaleString()}
                </td>
                <td>
                  <span className={`status ${f.isWaived ? "status-warn" : "status-success"}`}>
                    {f.isWaived ? "Waived" : "Active"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </calcite-card>
  );
}

function PaymentLedger({ payments }: { payments: RecordDetailPayload["payments"] }) {
  return (
    <calcite-card class="dash-card section-card zone-card">
      <h3 className="panel-title mb-3">Payments</h3>
      {payments.length === 0 ? (
        <p className="text-[12.5px] text-[var(--muted)]">No payments recorded yet.</p>
      ) : (
        <table className="w-full text-left text-[12.5px]">
          <thead className="label border-b border-[var(--line)]">
            <tr>
              <th className="py-2.5">Date</th>
              <th>Method</th>
              <th>Reference</th>
              <th className="text-right">Amount</th>
              <th>Receipt</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.paymentId} className="border-b border-[var(--line)] hover:bg-[var(--soft-fill)]">
                <td className="py-2.5 tabular-nums text-[var(--muted)]">
                  {formatDate(toEpochMs(p.paymentDate)) ?? p.paymentDate}
                </td>
                <td className="capitalize font-medium">{p.paymentMethod}</td>
                <td className="font-mono text-[11.5px] text-[var(--muted)]">
                  {p.mpesaRef || p.bankRef || "—"}
                </td>
                <td className="text-right tabular-nums font-semibold">
                  KES {Number(p.amountPaid).toLocaleString()}
                </td>
                <td className="font-mono text-[11px]">{p.receiptNumber}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </calcite-card>
  );
}

function NoticesForRecord({ notices }: { notices: RecordDetailPayload["notices"] }) {
  return (
    <calcite-card class="dash-card section-card zone-card">
      <h3 className="panel-title mb-3">Notices</h3>
      {notices.length === 0 ? (
        <p className="text-[12.5px] text-[var(--muted)]">No demand notices for this record yet.</p>
      ) : (
        <table className="w-full text-left text-[12.5px]">
          <thead className="label border-b border-[var(--line)]">
            <tr>
              <th className="py-2.5">Notice #</th>
              <th>Issued</th>
              <th>Due</th>
              <th className="text-right">Amount</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {notices.map((n) => (
              <tr key={n.noticeId} className="border-b border-[var(--line)] hover:bg-[var(--soft-fill)]">
                <td className="py-2.5 font-mono text-[11.5px]">{n.noticeNumber}</td>
                <td className="text-[var(--muted)]">
                  {formatDate(toEpochMs(n.issuedDate)) ?? n.issuedDate}
                </td>
                <td className="text-[var(--muted)]">
                  {formatDate(toEpochMs(n.dueDate)) ?? n.dueDate}
                </td>
                <td className="text-right tabular-nums">
                  KES {Number(n.amountDue).toLocaleString()}
                </td>
                <td>
                  <span
                    className={`status ${
                      n.noticeStatus === "paid"
                        ? "status-success"
                        : n.noticeStatus === "overdue"
                          ? "status-error"
                          : n.noticeStatus === "cancelled"
                            ? "status-warn"
                            : ""
                    }`}
                  >
                    {n.noticeStatus}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => downloadNoticePdf(n).catch(() => {})}
                    aria-label="Download PDF"
                    title="Download PDF"
                  >
                    <Icon>download</Icon>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </calcite-card>
  );
}

function RecordPaymentModal({
  record,
  onClose,
  onRecorded,
}: {
  record: RecordDetailPayload;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const [amount, setAmount] = useState<string>(String(Number(record.outstandingBalance) || 0));
  const [method, setMethod] = useState<"mpesa" | "bank" | "cash" | "cheque">("mpesa");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: Parameters<typeof api.payments.record>[0] = {
        recordId: record.recordId,
        amountPaid: Number(amount),
        paymentMethod: method,
        paymentDate: new Date().toISOString(),
        notes: notes || undefined,
      };
      if (method === "mpesa" && reference) payload.mpesaRef = reference;
      if (method === "bank" && reference) payload.bankRef = reference;
      await api.payments.record(payload);
      onRecorded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record payment");
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="label">Record payment</p>
            <h3 className="mt-0.5 text-base font-semibold">{record.taxpayerName}</h3>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Close">
            <X className="h-4 w-4" strokeWidth={2.4} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="auth-label">Amount (KES)</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              className="auth-input"
            />
          </label>
          <label className="block">
            <span className="auth-label">Method</span>
            <div className="auth-input-shell">
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as typeof method)}
                className="auth-input auth-input--bare"
              >
                <option value="mpesa">M-Pesa</option>
                <option value="bank">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
              </select>
              <ChevronDown className="mr-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
            </div>
          </label>
          {(method === "mpesa" || method === "bank") && (
            <label className="block">
              <span className="auth-label">
                {method === "mpesa" ? "M-Pesa reference" : "Bank reference"}
              </span>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="auth-input"
                placeholder={method === "mpesa" ? "QK78HJ21" : "Bank slip number"}
              />
            </label>
          )}
          <label className="block">
            <span className="auth-label">Notes (optional)</span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="auth-input"
            />
          </label>
          {error && (
            <calcite-notice open icon="exclamation-mark-triangle" kind="danger" scale="s">
              <div slot="title">Could not record</div>
              <div slot="message">{error}</div>
            </calcite-notice>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="control" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="primary-control" disabled={submitting}>
              {submitting ? "Saving…" : "Record payment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/*  Bulk notices                                                           */
/* ----------------------------------------------------------------------- */

/* ─────────────────────────────────────────────────────────────────
   Records list (shown when no record is selected)
   ───────────────────────────────────────────────────────────────── */

function RecordsList({
  onOpenRecord,
  onNavigate,
  onStartParcelLink,
}: {
  onOpenRecord: (id: number) => void;
  onNavigate: (v: View) => void;
  onStartParcelLink: (recordId: number, recordName: string) => void;
}) {
  const [tab, setTab] = useState<"records" | "reports">("records");
  const [page, setPage] = useState<Paged<TaxpayerRecord> | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [types, setTypes] = useState<RecordType[]>([]);
  const [search, setSearch] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [recordTypeId, setRecordTypeId] = useState("");
  const [unmappedOnly, setUnmappedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; message: string } | null>(null);

  useEffect(() => {
    Promise.all([api.zones.list(), api.records.types()])
      .then(([z, t]) => {
        setZones(z);
        setTypes(t);
      })
      .catch(() => undefined);
  }, []);

  const fetchPage = (silent = false) => {
    if (!silent) setLoading(true);
    return api.records
      .list({
        limit: 50,
        search: search.trim() || undefined,
        zoneId: zoneId ? Number(zoneId) : undefined,
        recordTypeId: recordTypeId ? Number(recordTypeId) : undefined,
        unmapped: unmappedOnly ? true : undefined,
      })
      .then((res) => {
        setPage(res);
        setFetchError(null);
      })
      .catch((err) => {
        setPage(null);
        setFetchError(
          err instanceof ApiError && err.status === 0
            ? `Cannot reach the API (${api.baseUrl}). Is the backend running?`
            : err instanceof Error
              ? err.message
              : "Could not load records.",
        );
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const id = setTimeout(() => fetchPage(false), 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, zoneId, recordTypeId, unmappedOnly]);

  const rows = page?.data ?? [];

  const exportCsv = () => {
    if (!rows.length) return;
    downloadCsv("taxpayer-records", rows.map((r) => ({
      recordId: r.recordId,
      taxpayerName: r.taxpayerName,
      phone: r.taxpayerPhone ?? "",
      idNumber: r.taxpayerIdNo ?? "",
      recordType: r.recordType,
      zone: r.zoneName,
      status: r.status,
      outstanding: Number(r.outstandingBalance).toFixed(2),
      submittedBy: r.submittedByName ?? "",
      submittedOn: r.submissionDate,
    })));
  };

  return (
    <section className="flex flex-col gap-3">
      {/* Records / Reports tab toggle */}
      <nav className="inline-flex self-start rounded-lg border border-[var(--line)] bg-[var(--soft-fill)] p-1">
        {(["records", "reports"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
              tab === id
                ? "bg-[var(--surface)] text-[var(--primary)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--on-surface)]"
            }`}
          >
            {id === "records" ? "Records" : "Reports"}
          </button>
        ))}
      </nav>

      {tab === "reports" && <SettingsReports />}
      {tab === "records" && (
      <>
      {fetchError && (
        <calcite-notice open icon="exclamation-mark-triangle" kind="danger" scale="s" closable onCalciteNoticeClose={() => setFetchError(null)}>
          <div slot="title">Could not load records</div>
          <div slot="message">{fetchError}</div>
          <calcite-action slot="actions-end" icon="refresh" text="Retry" onClick={() => fetchPage(false)} />
        </calcite-notice>
      )}
      <calcite-card class="dash-card section-card">
        <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-[320px]">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]"
            strokeWidth={2.2}
          />
          <input
            type="text"
            className="auth-input !h-8 !pl-8 !text-[12px]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search taxpayer name…"
          />
        </div>
        <div className="auth-input-shell !h-8 w-[160px]">
          <select
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
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
        <div className="auth-input-shell !h-8 w-[160px]">
          <select
            value={recordTypeId}
            onChange={(e) => setRecordTypeId(e.target.value)}
            className="auth-input auth-input--bare !text-[12px]"
            aria-label="Record type"
          >
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t.recordTypeId} value={String(t.recordTypeId)}>
                {t.typeName}
              </option>
            ))}
          </select>
          <ChevronDown className="mr-2 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
        </div>
        <button
          type="button"
          onClick={() => setUnmappedOnly((v) => !v)}
          className={`control !h-8 ${unmappedOnly ? "border-[var(--primary)] text-[var(--primary)]" : ""}`}
          title="Show only records that don't have a parcel linked yet"
        >
          {unmappedOnly ? "● " : ""}Unmapped only
        </button>
        <span className="ml-auto flex items-center gap-1.5">
          <button type="button" className="control !h-8" onClick={exportCsv} disabled={!rows.length}>
            <Download className="h-3.5 w-3.5" strokeWidth={2.2} />
            <span className="hidden sm:inline">Export</span>
          </button>
          <button type="button" className="primary-control !h-8" onClick={() => setShowAdd(true)}>
            <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
            <span>Add record</span>
          </button>
        </span>
        </div>
      </calcite-card>

      <calcite-card class="dash-card flush-card zone-card">
        <table className="w-full min-w-[820px] text-[12.5px]">
          <thead className="label border-b border-[var(--line)]">
            <tr className="[&_th]:px-3 [&_th]:py-2.5">
              <th className="text-left">Taxpayer</th>
              <th className="text-left">Type</th>
              <th className="text-left">Zone</th>
              <th className="text-left">Status</th>
              <th className="text-right">Outstanding</th>
              <th className="text-right">Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && !page && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-[var(--muted)]">
                  Loading records…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-[var(--muted)]">
                  No records match these filters.
                  <button
                    type="button"
                    className="control mx-auto mt-3 flex !h-8"
                    onClick={() => onNavigate("map")}
                  >
                    Browse on map
                  </button>
                </td>
              </tr>
            )}
            {rows.map((r) => (
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
                  <div className="flex flex-wrap items-center gap-1">
                    <span
                      className={`status ${
                        r.status === "active"
                          ? "status-success"
                          : r.status === "pending"
                            ? ""
                            : "status-warn"
                      }`}
                    >
                      {r.status}
                    </span>
                    {r.arcgisObjectId == null && (
                      <span className="status status-warn" title="No ArcGIS parcel linked">
                        unmapped
                      </span>
                    )}
                  </div>
                </td>
                <td className="text-right tabular-nums font-semibold">
                  {formatKesM(Number(r.outstandingBalance))}
                </td>
                <td className="text-right text-[11px] text-[var(--muted)]">
                  {formatDate(toEpochMs(r.updatedAt)) ?? "—"}
                </td>
                <td className="flex items-center justify-end gap-1">
                  {r.arcgisObjectId == null && (
                    <button
                      type="button"
                      className="control !h-7 !text-[11px]"
                      onClick={(e) => {
                        e.stopPropagation();
                        onStartParcelLink(r.recordId, r.taxpayerName);
                      }}
                      title="Pick a parcel on the map to link to this record"
                    >
                      Link parcel
                    </button>
                  )}
                  <ChevronRight className="h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {page && (
          <div className="flex items-center justify-between border-t border-[var(--line)] px-3 py-2 text-[11px] text-[var(--muted)]">
            <span>
              Showing {rows.length} of {page.pagination.total} records
            </span>
          </div>
        )}
      </calcite-card>

      {showAdd && (
        <AddRecordModal
          zones={zones}
          types={types}
          onClose={() => setShowAdd(false)}
          onCreated={(id, feeAssigned) => {
            setShowAdd(false);
            setToast(
              feeAssigned
                ? { kind: "ok", message: `Record #${id} created — annual fee auto-assigned.` }
                : {
                    kind: "err",
                    message: `Record #${id} created, but NO fee schedule matched its type/zone. Define one under Fees, then assign it — notices can't be generated until then.`,
                  },
            );
            fetchPage(true);
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
          <div slot="title">{toast.kind === "ok" ? "Created" : "Failed"}</div>
          <div slot="message">{toast.message}</div>
        </calcite-notice>
      )}
      </>
      )}
    </section>
  );
}

/* ─── Add Record modal ─────────────────────────────────────────────── */

export interface AddRecordPrefill {
  taxpayerName?: string;
  taxpayerPhone?: string;
  taxpayerIdNo?: string;
  zoneId?: number;
  recordTypeId?: number;
  arcgisObjectId?: number;
  /** Free-form ArcGIS attributes shown read-only & saved as custom attributes. */
  attributes?: Record<string, unknown>;
  /** "From parcel #123 on Parcels layer" caption shown above the form. */
  sourceLabel?: string;
}

function AddRecordModal({
  zones,
  types,
  prefill,
  onClose,
  onCreated,
  onError,
}: {
  zones: Zone[];
  types: RecordType[];
  prefill?: AddRecordPrefill;
  onClose: () => void;
  /** feeAssigned tells the caller whether a fee schedule matched at creation. */
  onCreated: (id: number, feeAssigned: boolean) => void;
  onError: (message: string) => void;
}) {
  // Lat/lng are NOT user-editable here. GIS officers capture geometry in
  // ArcGIS; when this modal is opened from a map click, the parcel's
  // coordinates ride along in the prefill and are submitted invisibly.
  const [form, setForm] = useState<{
    taxpayerName: string;
    taxpayerPhone: string;
    taxpayerEmail: string;
    taxpayerIdNo: string;
    zoneId: string;
    recordTypeId: string;
  }>(() => ({
    taxpayerName: prefill?.taxpayerName ?? "",
    taxpayerPhone: prefill?.taxpayerPhone ?? "",
    taxpayerEmail: "",
    taxpayerIdNo: prefill?.taxpayerIdNo ?? "",
    zoneId: prefill?.zoneId
      ? String(prefill.zoneId)
      : zones[0]
        ? String(zones[0].zoneId)
        : "",
    recordTypeId: prefill?.recordTypeId
      ? String(prefill.recordTypeId)
      : types[0]
        ? String(types[0].recordTypeId)
        : "",
  }));
  const [attrs, setAttrs] = useState<{ key: string; value: string }[]>(() => {
    if (!prefill?.attributes) return [];
    return Object.entries(prefill.attributes)
      .filter(([, v]) => v != null && String(v).trim() !== "")
      .slice(0, 10)
      .map(([key, value]) => ({ key, value: String(value) }));
  });
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof typeof form>(k: K, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const canSave =
    form.taxpayerName.trim().length >= 2 && form.zoneId && form.recordTypeId;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload: ManualRecordCreatePayload = {
        taxpayerName: form.taxpayerName.trim(),
        taxpayerPhone: form.taxpayerPhone.trim() || undefined,
        taxpayerEmail: form.taxpayerEmail.trim() || undefined,
        taxpayerIdNo: form.taxpayerIdNo.trim() || undefined,
        zoneId: Number(form.zoneId),
        recordTypeId: Number(form.recordTypeId),
        // Geometry stays in ArcGIS — we only pass the OBJECTID link
        arcgisObjectId: prefill?.arcgisObjectId,
        attributes: attrs.filter((a) => a.key.trim() && a.value.trim()),
      };
      const res = await api.records.create(payload);
      onCreated(res.recordId, res.autoAssignmentId != null);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not create record");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel max-w-[560px] p-5"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Add taxpayer record</h2>
            <p className="text-[12px] text-[var(--muted)]">
              Manually capture a new parcel, business, or market stall.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>

        {prefill?.sourceLabel && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-[var(--primary)] bg-[var(--primary-container)] px-3 py-2 text-[12px] text-[var(--primary)]">
            <span className="font-semibold">Linked:</span>
            <span>{prefill.sourceLabel}</span>
            {prefill.arcgisObjectId != null && (
              <span className="ml-auto rounded bg-[var(--surface)] px-2 py-0.5 font-mono text-[10.5px]">
                OBJECTID {prefill.arcgisObjectId}
              </span>
            )}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block md:col-span-2">
            <span className="auth-label">Taxpayer name *</span>
            <input
              className="auth-input"
              value={form.taxpayerName}
              onChange={(e) => update("taxpayerName", e.target.value)}
              placeholder="e.g. Jane Wanjiku"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="auth-label">Phone</span>
            <input
              className="auth-input"
              value={form.taxpayerPhone}
              onChange={(e) => update("taxpayerPhone", e.target.value)}
              placeholder="+254…"
            />
          </label>
          <label className="block">
            <span className="auth-label">National ID</span>
            <input
              className="auth-input"
              value={form.taxpayerIdNo}
              onChange={(e) => update("taxpayerIdNo", e.target.value)}
            />
          </label>
          <label className="block md:col-span-2">
            <span className="auth-label">Email</span>
            <input
              type="email"
              className="auth-input"
              value={form.taxpayerEmail}
              onChange={(e) => update("taxpayerEmail", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="auth-label">Record type *</span>
            <div className="auth-input-shell">
              <select
                value={form.recordTypeId}
                onChange={(e) => update("recordTypeId", e.target.value)}
                className="auth-input auth-input--bare"
              >
                {types.map((t) => (
                  <option key={t.recordTypeId} value={String(t.recordTypeId)}>
                    {t.typeName}
                  </option>
                ))}
              </select>
              <ChevronDown className="mr-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
            </div>
          </label>
          <label className="block">
            <span className="auth-label">Zone *</span>
            <div className="auth-input-shell">
              <select
                value={form.zoneId}
                onChange={(e) => update("zoneId", e.target.value)}
                className="auth-input auth-input--bare"
              >
                {zones.map((z) => (
                  <option key={z.zoneId} value={String(z.zoneId)}>
                    {z.zoneName}
                  </option>
                ))}
              </select>
              <ChevronDown className="mr-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
            </div>
          </label>
        </div>

        {!prefill?.arcgisObjectId && (
          <p className="mt-3 rounded-md border border-dashed border-[var(--line)] bg-[var(--soft-fill)] px-3 py-2 text-[11.5px] text-[var(--muted)]">
            Location is captured separately in ArcGIS. After the GIS officer
            draws the geometry, open Map and link this taxpayer to the new
            parcel.
          </p>
        )}

        <div className="mt-4">
          <p className="label mb-1.5">Custom attributes</p>
          <div className="space-y-1.5">
            {attrs.map((a, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="auth-input !h-8 flex-1 !text-[12px]"
                  placeholder="Key"
                  value={a.key}
                  onChange={(e) =>
                    setAttrs((cur) => cur.map((c, j) => (j === i ? { ...c, key: e.target.value } : c)))
                  }
                />
                <input
                  className="auth-input !h-8 flex-1 !text-[12px]"
                  placeholder="Value"
                  value={a.value}
                  onChange={(e) =>
                    setAttrs((cur) => cur.map((c, j) => (j === i ? { ...c, value: e.target.value } : c)))
                  }
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setAttrs((cur) => cur.filter((_, j) => j !== i))}
                  aria-label="Remove attribute"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2.4} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="control !h-8 !text-[11px]"
              onClick={() => setAttrs((cur) => [...cur, { key: "", value: "" }])}
            >
              <Plus className="h-3 w-3" strokeWidth={2.4} />
              Add attribute
            </button>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="control" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-control"
            onClick={submit}
            disabled={!canSave || saving}
          >
            {saving ? "Saving…" : "Create record"}
          </button>
        </div>
      </div>
    </div>
  );
}

export { RecordDetail, AddRecordModal };
