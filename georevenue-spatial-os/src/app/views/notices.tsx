"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, Search, X } from "lucide-react";
import {
  api,
  downloadNoticePdf,
  type Notice,
  type RecordType,
  type TaxpayerRecord,
  type Zone,
} from "../lib/api";
import { downloadCsv, formatDate, formatKesM, toEpochMs } from "../lib/shared";

type NoticeStatus = Notice["noticeStatus"];
type NoticeSummaryStatus = Exclude<NoticeStatus, "pending">;

function BulkNotices({ onOpenRecord }: { onOpenRecord: (id: number) => void }) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [recordTypes, setRecordTypes] = useState<RecordType[]>([]);
  const [records, setRecords] = useState<TaxpayerRecord[]>([]);
  const [generatorMode, setGeneratorMode] = useState<"single" | "bulk">("single");
  const [bulkZoneId, setBulkZoneId] = useState<string>("");
  const [bulkRecordTypeId, setBulkRecordTypeId] = useState<string>("");
  const [bulkBillingYear, setBulkBillingYear] = useState<string>(String(new Date().getFullYear()));
  const [bulkDueDate, setBulkDueDate] = useState<string>(() =>
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
  const [singleRecordId, setSingleRecordId] = useState<string>("");
  const [singleDueDate, setSingleDueDate] = useState<string>(() =>
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
  const [notices, setNotices] = useState<Notice[]>([]);
  const [recordSearch, setRecordSearch] = useState("");
  const [noticeSearch, setNoticeSearch] = useState("");
  const [noticeStatus, setNoticeStatus] = useState<string>("");
  const [noticeZoneId, setNoticeZoneId] = useState<string>("");
  const [singleWorking, setSingleWorking] = useState(false);
  const [bulkWorking, setBulkWorking] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  // Which notice (if any) is currently being initialized through Paystack —
  // disables its row button so the user can't double-click during the redirect.
  const [payingFor, setPayingFor] = useState<number | null>(null);
  const [result, setResult] = useState<{
    kind: "ok" | "err";
    message: string;
  } | null>(null);

  // Kick off the hosted-checkout flow: ask the backend to open a Paystack
  // transaction for this notice, then redirect the browser to the URL Paystack
  // returns. Paystack later redirects back to PAYSTACK_CALLBACK_URL with
  // ?reference=... which the callback-handler effect below picks up.
  const startPaystackPayment = async (notice: Notice) => {
    setPayingFor(notice.noticeId);
    setResult(null);
    try {
      const { authorizationUrl } = await api.payments.paystackInitialize({
        noticeId: notice.noticeId,
      });
      window.location.assign(authorizationUrl);
    } catch (err) {
      setPayingFor(null);
      setResult({
        kind: "err",
        message:
          err instanceof Error
            ? `Could not start Paystack checkout: ${err.message}`
            : "Could not start Paystack checkout",
      });
    }
  };

  // Paystack redirects back with ?paystack_callback=1&reference=NOTICE-xx-... .
  // We call verify (which is idempotent — the webhook may have already
  // recorded the payment) and surface the result as a toast, then scrub the
  // query string so a page refresh doesn't re-trigger the verify call.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || params.get("trxref");
    if (!params.has("paystack_callback") && !reference) return;
    if (!reference) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.payments.paystackVerify(reference);
        if (cancelled) return;
        if (res.status === "recorded" || res.status === "already_recorded") {
          setResult({ kind: "ok", message: "Payment confirmed and recorded." });
          reloadNotices({ zoneId: noticeZoneId, status: noticeStatus });
        } else if (res.status === "pending" || res.status === "unknown") {
          setResult({
            kind: "err",
            message: "Payment is still being processed. Check back in a moment.",
          });
        } else {
          setResult({
            kind: "err",
            message: res.message || `Payment was not completed (${res.status}).`,
          });
        }
      } catch (err) {
        if (cancelled) return;
        setResult({
          kind: "err",
          message: err instanceof Error ? err.message : "Could not verify the payment",
        });
      } finally {
        // Scrub the URL so refresh doesn't re-verify.
        const url = new URL(window.location.href);
        url.searchParams.delete("reference");
        url.searchParams.delete("trxref");
        url.searchParams.delete("paystack_callback");
        window.history.replaceState({}, "", url.toString());
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reloadNotices = (filters?: { zoneId?: string; status?: string }) => {
    api.notices
      .list({
        limit: 100,
        zoneId: filters?.zoneId ? Number(filters.zoneId) : undefined,
        status: filters?.status || undefined,
      })
      .then((res) => setNotices(res.data))
      .catch(() => setNotices([]));
  };

  useEffect(() => {
    Promise.all([
      api.zones.list(),
      api.records.types(),
      api.records.list({ limit: 25, search: recordSearch.trim() || undefined }),
    ])
      .then(([zoneList, typeList, recordPage]) => {
        setZones(zoneList);
        setRecordTypes(typeList);
        setRecords(recordPage.data);
        if (recordPage.data[0] && !singleRecordId) {
          setSingleRecordId(String(recordPage.data[0].recordId));
        }
      })
      .catch(() => {
        setZones([]);
        setRecordTypes([]);
        setRecords([]);
      });
    reloadNotices();
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

  useEffect(() => {
    reloadNotices({ zoneId: noticeZoneId, status: noticeStatus });
  }, [noticeZoneId, noticeStatus]);

  const filtered = useMemo(() => {
    const term = noticeSearch.trim().toLowerCase();
    return notices.filter((n) =>
      term
        ? `${n.noticeNumber} ${n.taxpayerName ?? ""} ${n.zoneName ?? ""} ${n.taxpayerIdNo ?? ""}`
            .toLowerCase()
            .includes(term)
        : true,
    );
  }, [noticeSearch, notices]);

  const noticeSummary = useMemo(() => {
    const summary: Record<NoticeSummaryStatus | "total", number> = {
      total: notices.length,
      issued: 0,
      paid: 0,
      overdue: 0,
      cancelled: 0,
    };

    // Issued + overdue notices are both money the county is still owed —
    // sum their amount_due so the page can show one explicit Outstanding KES
    // figure alongside the per-status counts.
    let outstandingAmount = 0;
    for (const notice of notices) {
      summary[notice.noticeStatus as NoticeSummaryStatus] += 1;
      if (notice.noticeStatus === "issued" || notice.noticeStatus === "overdue") {
        outstandingAmount += Number(notice.amountDue) || 0;
      }
    }

    const outstandingCount = summary.issued + summary.overdue;
    return { ...summary, outstandingCount, outstandingAmount };
  }, [notices]);

  const clearNoticeFilters = () => {
    setNoticeZoneId("");
    setNoticeStatus("");
    setNoticeSearch("");
  };

  const handleGenerateSingle = async () => {
    if (!singleRecordId) {
      setResult({ kind: "err", message: "Pick a record first." });
      return;
    }
    setResult(null);
    setSingleWorking(true);
    try {
      const res = await api.notices.generate({
        recordId: Number(singleRecordId),
        dueDate: singleDueDate,
      });
      setResult({
        kind: "ok",
        message:
          `Notice ${res.noticeNumber} created. Amount due will be calculated by the backend.`,
      });
      closeGeneratorOnSuccess();
      reloadNotices({ zoneId: noticeZoneId, status: noticeStatus });
      await downloadNoticePdf({
        noticeId: res.noticeId,
        noticeNumber: res.noticeNumber,
        amountDue: res.amountDue,
        issuedDate: new Date().toISOString(),
        dueDate: singleDueDate,
        noticeStatus: "issued",
        recordId: Number(singleRecordId),
      });
    } catch (err) {
      setResult({
        kind: "err",
        message: err instanceof Error ? err.message : "Generation failed",
      });
    } finally {
      setSingleWorking(false);
    }
  };

  const handleGenerateBulk = async () => {
    if (!bulkZoneId) {
      setResult({ kind: "err", message: "Pick a zone first." });
      return;
    }
    setResult(null);
    setBulkWorking(true);
    try {
      const res = await api.notices.bulk({
        zoneId: Number(bulkZoneId),
        billingYear: Number(bulkBillingYear),
        dueDate: bulkDueDate,
        recordTypeId: bulkRecordTypeId ? Number(bulkRecordTypeId) : undefined,
      });
      setResult({
        kind: "ok",
        message: res.message || `${res.generated} notices generated.`,
      });
      closeGeneratorOnSuccess();
      reloadNotices({ zoneId: noticeZoneId, status: noticeStatus });
    } catch (err) {
      setResult({ kind: "err", message: err instanceof Error ? err.message : "Generation failed" });
    } finally {
      setBulkWorking(false);
    }
  };

  // Auto-close the modal after a successful run so the queue is the next focus
  const closeGeneratorOnSuccess = () => {
    setShowGenerator(false);
  };

  return (
    <section className="flex flex-col gap-3">
      {result && (
        <calcite-notice
          open
          icon={result.kind === "ok" ? "check-circle" : "exclamation-mark-triangle"}
          kind={result.kind === "ok" ? "success" : "danger"}
          scale="s"
          closable
          onCalciteNoticeClose={() => setResult(null)}
        >
          <div slot="title">{result.kind === "ok" ? "Completed" : "Action failed"}</div>
          <div slot="message">{result.message}</div>
        </calcite-notice>
      )}

      {showGenerator && (
        <div className="modal-backdrop" onClick={() => setShowGenerator(false)}>
          <div
            className="modal-panel max-w-[480px] p-5"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between">
              <div>
                <p className="label">Demand notice generation</p>
                <h2 className="text-lg font-semibold">Generate notice</h2>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShowGenerator(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" strokeWidth={2.2} />
              </button>
            </div>

        <calcite-card class="dash-card section-card">
          <p className="label">Demand notice generation</p>
          <div className="mt-2 grid grid-cols-2 rounded-lg border border-[var(--line)] bg-[var(--soft-fill)] p-1 text-[11px] font-semibold shadow-xs">
            <button
              type="button"
              onClick={() => setGeneratorMode("single")}
              className={`rounded-md px-3 py-2 transition-colors ${
                generatorMode === "single"
                  ? "bg-[var(--panel)] text-[var(--primary)] shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--on-surface)]"
              }`}
            >
              Single notice
            </button>
            <button
              type="button"
              onClick={() => setGeneratorMode("bulk")}
              className={`rounded-md px-3 py-2 transition-colors ${
                generatorMode === "bulk"
                  ? "bg-[var(--panel)] text-[var(--primary)] shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--on-surface)]"
              }`}
            >
              Bulk notice
            </button>
          </div>

          <div className="mt-4">
            {generatorMode === "single" ? (
              <div className="space-y-3">
                <div>
                  <h2 className="panel-title">Single notice</h2>
                  <p className="mt-1 text-[11px] text-[var(--muted)]">
                    Pick one record and a due date. The backend computes the amount due, notice number, and PDF.
                  </p>
                </div>
                <label className="block">
                  <span className="auth-label">Search record</span>
                  <input
                    type="text"
                    className="auth-input"
                    value={recordSearch}
                    onChange={(e) => setRecordSearch(e.target.value)}
                    placeholder="Search by taxpayer name"
                  />
                </label>
                <label className="block">
                  <span className="auth-label">Record</span>
                  <div className="auth-input-shell">
                    <select
                      className="auth-input auth-input--bare"
                      value={singleRecordId}
                      onChange={(e) => setSingleRecordId(e.target.value)}
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
                  <span className="auth-label">Due date</span>
                  <input
                    type="date"
                    value={singleDueDate}
                    onChange={(e) => setSingleDueDate(e.target.value)}
                    className="auth-input"
                  />
                </label>
                <button
                  type="button"
                  className="primary-control w-full justify-center"
                  onClick={handleGenerateSingle}
                  disabled={singleWorking || !singleRecordId}
                >
                  {singleWorking ? "Generating..." : "Generate single notice"}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <h2 className="panel-title">Zone batch</h2>
                  <p className="mt-1 text-[11px] text-[var(--muted)]">
                    Generate notices for a filtered batch. Existing active notices are skipped by the backend.
                  </p>
                </div>
                <label className="block">
                  <span className="auth-label">Zone</span>
                  <div className="auth-input-shell">
                    <select
                      value={bulkZoneId}
                      onChange={(e) => setBulkZoneId(e.target.value)}
                      className="auth-input auth-input--bare"
                    >
                      <option value="">Select zone</option>
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
                  <span className="auth-label">Record type filter</span>
                  <div className="auth-input-shell">
                    <select
                      value={bulkRecordTypeId}
                      onChange={(e) => setBulkRecordTypeId(e.target.value)}
                      className="auth-input auth-input--bare"
                    >
                      <option value="">All types</option>
                      {recordTypes.map((type) => (
                        <option key={type.recordTypeId} value={String(type.recordTypeId)}>
                          {type.typeName}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="mr-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
                  </div>
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="auth-label">Billing year</span>
                    <input
                      type="number"
                      value={bulkBillingYear}
                      onChange={(e) => setBulkBillingYear(e.target.value)}
                      className="auth-input"
                      min="2020"
                      max="2100"
                    />
                  </label>
                  <label className="block">
                    <span className="auth-label">Due date</span>
                    <input
                      type="date"
                      value={bulkDueDate}
                      onChange={(e) => setBulkDueDate(e.target.value)}
                      className="auth-input"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="primary-control w-full justify-center"
                  onClick={handleGenerateBulk}
                  disabled={bulkWorking || !bulkZoneId}
                >
                  {bulkWorking ? "Generating..." : "Generate bulk notices"}
                </button>
              </div>
            )}
          </div>
        </calcite-card>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <calcite-card class="dash-card flush-card">
          <div className="border-b border-[var(--line)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="label">Demand notice queue</p>
                <h2 className="panel-title mt-1">Billing register</h2>
                <p className="mt-1 text-[11px] text-[var(--muted)]">
                  {filtered.length} of {noticeSummary.total} notices shown
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="primary-control !h-8"
                  onClick={() => setShowGenerator(true)}
                >
                  <span>+ Generate notice</span>
                </button>
                <button
                  type="button"
                  className="control !h-8"
                  onClick={() =>
                    downloadCsv(
                      "billing-register",
                      filtered.map((n) => ({
                        noticeNumber: n.noticeNumber,
                        taxpayerName: n.taxpayerName ?? "",
                        taxpayerIdNo: n.taxpayerIdNo ?? "",
                        zone: n.zoneName ?? "",
                        amountDue: Number(n.amountDue).toFixed(2),
                        issuedDate: n.issuedDate,
                        dueDate: n.dueDate,
                        status: n.noticeStatus,
                        generatedBy: n.generatedByName ?? "",
                      })),
                    )
                  }
                  disabled={!filtered.length}
                >
                  <Download className="h-3.5 w-3.5" strokeWidth={2.2} />
                  <span>Export register</span>
                </button>
                <button
                  type="button"
                  className="control !h-8"
                  onClick={clearNoticeFilters}
                  disabled={!noticeSearch && !noticeStatus && !noticeZoneId}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2.2} />
                  <span>Clear filters</span>
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
              {/* Money chip — issued + overdue notices both represent money
                  the county is still owed. Pulled forward as the headline so
                  it answers "how much is in the unpaid bucket?" at a glance. */}
              <span
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold"
                style={{
                  borderColor: "rgb(216 48 32 / 0.32)",
                  background: "rgb(216 48 32 / 0.08)",
                  color: "var(--error)",
                }}
                title={`${noticeSummary.outstandingCount} unpaid notice${
                  noticeSummary.outstandingCount === 1 ? "" : "s"
                } (${noticeSummary.issued} issued, ${noticeSummary.overdue} overdue)`}
              >
                Outstanding {formatKesM(noticeSummary.outstandingAmount)}
                <span className="font-normal opacity-70">
                  · {noticeSummary.outstandingCount}
                </span>
              </span>
              <span className="rounded-full border border-[var(--line)] bg-[var(--soft-fill)] px-2.5 py-1 text-[var(--muted)]">
                Total {noticeSummary.total}
              </span>
              <span className="rounded-full border border-[var(--line)] bg-[var(--soft-fill)] px-2.5 py-1 text-[var(--muted)]">
                Issued {noticeSummary.issued}
              </span>
              <span className="rounded-full border border-[var(--line)] bg-[var(--soft-fill)] px-2.5 py-1 text-[var(--muted)]">
                Overdue {noticeSummary.overdue}
              </span>
              <span className="rounded-full border border-[var(--line)] bg-[var(--soft-fill)] px-2.5 py-1 text-[var(--muted)]">
                Paid {noticeSummary.paid}
              </span>
            </div>

            <div className="mt-4 grid gap-2 lg:grid-cols-[180px_180px_minmax(0,1fr)]">
              <label className="block">
                <span className="auth-label">Zone</span>
                <div className="auth-input-shell">
                  <select
                    value={noticeZoneId}
                    onChange={(e) => setNoticeZoneId(e.target.value)}
                    className="auth-input auth-input--bare"
                  >
                    <option value="">All zones</option>
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
                <span className="auth-label">Status</span>
                <div className="auth-input-shell">
                  <select
                    value={noticeStatus}
                    onChange={(e) => setNoticeStatus(e.target.value)}
                    className="auth-input auth-input--bare"
                  >
                    <option value="">All statuses</option>
                    <option value="issued">Issued</option>
                    <option value="paid">Paid</option>
                    <option value="overdue">Overdue</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                  <ChevronDown className="mr-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
                </div>
              </label>
              <label className="block">
                <span className="auth-label">Search</span>
                <div className="auth-input-shell">
                  <Search className="ml-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.2} />
                  <input
                    type="text"
                    value={noticeSearch}
                    onChange={(e) => setNoticeSearch(e.target.value)}
                    placeholder="Notice, taxpayer, zone, ID"
                    className="auth-input auth-input--bare"
                  />
                </div>
              </label>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[12.5px] [&_th]:px-3 [&_td]:px-3">
              <thead className="label border-b border-[var(--line)]">
                <tr>
                  <th className="py-2.5 min-w-[180px] text-left">Notice #</th>
                  <th className="text-left">Taxpayer</th>
                  <th className="text-left">ID number</th>
                  <th className="text-left">Zone</th>
                  <th className="text-right">Amount</th>
                  <th className="text-left">Due</th>
                  <th className="text-left">Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((n) => (
                  <tr key={n.noticeId} className="border-b border-[var(--line)] hover:bg-[var(--soft-fill)]">
                    <td className="py-2.5 font-mono text-[11.5px] whitespace-nowrap">{n.noticeNumber}</td>
                    <td className="font-medium">{n.taxpayerName ?? "-"}</td>
                    <td className="font-mono text-[11px] text-[var(--muted)]">{n.taxpayerIdNo ?? "-"}</td>
                    <td className="text-[var(--muted)]">{n.zoneName ?? "-"}</td>
                    <td className="text-right tabular-nums font-semibold text-[var(--tertiary)]">
                      KES {Number(n.amountDue).toLocaleString()}
                    </td>
                    <td className="text-[var(--muted)] whitespace-nowrap">{formatDate(toEpochMs(n.dueDate)) ?? n.dueDate}</td>
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
                    <td className="flex items-center justify-end gap-1.5">
                      {n.noticeStatus !== "paid" && n.noticeStatus !== "cancelled" && (
                        <button
                          type="button"
                          className="primary-control !h-7 !text-[11px]"
                          onClick={() => startPaystackPayment(n)}
                          disabled={payingFor === n.noticeId}
                          title="Pay online via Paystack (M-Pesa, card, or bank)"
                        >
                          {payingFor === n.noticeId ? "Opening…" : "Pay with Paystack"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="control !h-7 !text-[11px]"
                        onClick={() => onOpenRecord(n.recordId)}
                        title="Record a manual M-Pesa / cash / cheque payment against this record"
                      >
                        Manual
                      </button>
                      <button
                        type="button"
                        className="control !h-7 !text-[11px]"
                        onClick={() => downloadNoticePdf(n).catch(() => {})}
                        title="Download PDF"
                      >
                        PDF
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-[var(--muted)]">
                      No notices match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </calcite-card>
      </div>
    </section>
  );
}

export { BulkNotices };
