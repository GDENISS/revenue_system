"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  api,
  type Paged,
  type Payment,
  type PaymentsSummary,
} from "../lib/api";
import {
  Icon,
  downloadCsv,
  formatDate,
  formatKesM,
  toEpochMs,
} from "../lib/shared";

function PaymentsPage({ onOpenRecord }: { onOpenRecord: (id: number) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [dateFrom, setDateFrom] = useState(monthAgo);
  const [dateTo, setDateTo] = useState(today);
  const [method, setMethod] = useState<string>("");
  const [mpesaRef, setMpesaRef] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [summary, setSummary] = useState<PaymentsSummary | null>(null);
  const [payments, setPayments] = useState<Paged<Payment> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Correction workflow: which payment is being reversed + the written reason.
  const [reverseTarget, setReverseTarget] = useState<Payment | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reversing, setReversing] = useState(false);
  const [reverseNotice, setReverseNotice] = useState<{ kind: "ok" | "err"; message: string } | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const submitReversal = async () => {
    if (!reverseTarget || reverseReason.trim().length < 10) return;
    setReversing(true);
    try {
      const res = await api.payments.reverse(reverseTarget.paymentId, reverseReason.trim());
      setReverseNotice({ kind: "ok", message: `${res.message} — counter-entry ${res.receiptNumber} recorded.` });
      setReverseTarget(null);
      setReverseReason("");
      setRefreshTick((t) => t + 1);
    } catch (err) {
      setReverseNotice({
        kind: "err",
        message: err instanceof Error ? err.message : "Reversal failed",
      });
    } finally {
      setReversing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    Promise.all([
      api.payments.summary({ dateFrom, dateTo }),
      api.payments.list({
        dateFrom,
        dateTo,
        page,
        limit: 50,
        paymentMethod: method || undefined,
        mpesaRef: mpesaRef || undefined,
      }),
    ])
      .then(([s, p]) => {
        if (cancelled) return;
        setSummary(s);
        setPayments(p);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Could not load payments");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, method, mpesaRef, page, refreshTick]);

  const filtered = payments
    ? search.trim()
      ? payments.data.filter((p) =>
          `${p.receiptNumber} ${p.taxpayerName ?? ""} ${p.mpesaRef ?? ""} ${p.bankRef ?? ""}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
      : payments.data
    : [];

  const exportCsv = () => {
    if (!payments) return;
    const rows = [
      ["Receipt", "Date", "Taxpayer", "Method", "Reference", "Amount (KES)", "Recorded by"],
      ...filtered.map((p) => [
        p.receiptNumber,
        new Date(p.paymentDate).toISOString(),
        p.taxpayerName ?? "",
        p.paymentMethod,
        p.mpesaRef || p.bankRef || "",
        Number(p.amountPaid).toFixed(2),
        p.recordedByName ?? "",
      ]),
    ];
    const csv = rows
      .map((r) =>
        r
          .map((cell) => {
            const v = String(cell);
            return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""') }"` : v;
          })
          .join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payments-${dateFrom}_${dateTo}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const methodColors: Record<string, string> = {
    mpesa: "#35ac46",
    bank: "#007ac2",
    cash: "#edd317",
    cheque: "#00619b",
  };

  return (
    <div className="flex flex-col gap-3">
      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <calcite-card class="dash-card kpi-card">
          <p className="label">Total collected</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-[var(--success)]">
            {summary ? formatKesM(summary.totals.totalCollected) : "—"}
          </p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Window: {dateFrom} → {dateTo}
          </p>
        </calcite-card>
        <calcite-card class="dash-card kpi-card">
          <p className="label">Receipts</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums">
            {summary ? summary.totals.paymentCount.toLocaleString() : "—"}
          </p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            {summary?.totals.payerCount ?? 0} unique payers
          </p>
        </calcite-card>
        <calcite-card class="dash-card kpi-card">
          <p className="label">By method</p>
          <div className="mt-2 space-y-1.5 text-[12.5px]">
            {summary?.byMethod.length ? (
              summary.byMethod.map((m) => (
                <div key={m.method} className="flex items-center justify-between">
                  <span className="flex items-center gap-2 capitalize">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: methodColors[m.method] ?? "var(--muted)" }}
                    />
                    {m.method}
                  </span>
                  <span className="tabular-nums">
                    {formatKesM(m.total)}{" "}
                    <span className="text-[10px] text-[var(--muted)]">({m.count})</span>
                  </span>
                </div>
              ))
            ) : (
              <p className="text-[var(--muted)]">No data in window.</p>
            )}
          </div>
        </calcite-card>
      </section>

      <calcite-card class="dash-card section-card">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="auth-label">From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              className="auth-input"
            />
          </label>
          <label className="block">
            <span className="auth-label">To</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className="auth-input"
            />
          </label>
          <label className="block">
            <span className="auth-label">Method</span>
            <div className="auth-input-shell">
              <select
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value);
                  setPage(1);
                }}
                className="auth-input auth-input--bare"
              >
                <option value="">All methods</option>
                <option value="mpesa">M-Pesa</option>
                <option value="bank">Bank</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
              </select>
              <ChevronDown className="mr-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
            </div>
          </label>
          <label className="block">
            <span className="auth-label">M-Pesa ref (exact)</span>
            <input
              type="text"
              value={mpesaRef}
              onChange={(e) => {
                setMpesaRef(e.target.value);
                setPage(1);
              }}
              className="auth-input font-mono"
              placeholder="QK78HJ21"
            />
          </label>
          <label className="block flex-1 min-w-[180px]">
            <span className="auth-label">Free-text filter</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="auth-input"
              placeholder="Receipt, taxpayer, reference…"
            />
          </label>
          <button
            type="button"
            onClick={exportCsv}
            className="control h-10"
            disabled={!filtered.length}
          >
            <Icon>download</Icon> CSV
          </button>
        </div>
      </calcite-card>

      <calcite-card class="dash-card section-card zone-card">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="panel-title">Payments</h2>
          <p className="text-[11px] text-[var(--muted)]">
            {payments
              ? `${filtered.length} of ${payments.pagination.total} · page ${payments.pagination.page}/${payments.pagination.totalPages}`
              : ""}
          </p>
        </div>
        {error ? (
          <calcite-notice open icon="exclamation-mark-triangle" kind="danger" scale="s">
            <div slot="title">Could not load</div>
            <div slot="message">{error}</div>
          </calcite-notice>
        ) : loading ? (
          <div className="h-[200px] animate-pulse rounded-md bg-[var(--soft-fill)]" />
        ) : filtered.length === 0 ? (
          <p className="text-[12.5px] text-[var(--muted)]">No payments match these filters.</p>
        ) : (
          <table className="w-full text-left text-[12.5px]">
            <thead className="label border-b border-[var(--line)]">
              <tr>
                <th className="py-2.5">Receipt</th>
                <th>Date</th>
                <th>Taxpayer</th>
                <th>Method</th>
                <th>Reference</th>
                <th className="text-right">Amount</th>
                <th>Recorded by</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.paymentId}
                  className={`border-b border-[var(--line)] hover:bg-[var(--soft-fill)] ${
                    p.isReversed ? "opacity-60" : ""
                  }`}
                  title={
                    p.isReversed
                      ? `Reversed: ${p.reversalReason ?? ""}`
                      : p.reversesPaymentId
                        ? `Reversal of payment #${p.reversesPaymentId}: ${p.reversalReason ?? ""}`
                        : undefined
                  }
                >
                  <td
                    className={`py-2.5 font-mono text-[11.5px] ${
                      p.isReversed ? "line-through decoration-[var(--error)]" : ""
                    }`}
                  >
                    {p.receiptNumber}
                  </td>
                  <td className="text-[var(--muted)]">
                    {formatDate(toEpochMs(p.paymentDate)) ?? p.paymentDate}
                  </td>
                  <td className="font-medium">{p.taxpayerName ?? "—"}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1">
                      <span
                        className="status capitalize"
                        style={{
                          background: `${methodColors[p.paymentMethod] ?? "var(--muted)"}22`,
                          color: methodColors[p.paymentMethod] ?? "var(--muted)",
                        }}
                      >
                        {p.paymentMethod}
                      </span>
                      {p.paystackReference && (
                        <span
                          className="status"
                          title={`Paystack reference: ${p.paystackReference}`}
                          style={{
                            background: "rgba(0, 122, 194, 0.12)",
                            color: "var(--primary)",
                          }}
                        >
                          via Paystack
                          {p.gatewayResponse?.channel
                            ? ` · ${humanizePaystackChannel(p.gatewayResponse.channel)}`
                            : ""}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="font-mono text-[11px] text-[var(--muted)]">
                    {p.mpesaRef || p.bankRef || "—"}
                  </td>
                  <td
                    className="text-right tabular-nums font-semibold"
                    style={{ color: Number(p.amountPaid) < 0 ? "var(--error)" : undefined }}
                  >
                    KES {Number(p.amountPaid).toLocaleString()}
                  </td>
                  <td className="text-[var(--muted)]">{p.recordedByName ?? "—"}</td>
                  <td>
                    <span className="flex items-center justify-end gap-1">
                      {!p.isReversed && !p.reversesPaymentId && (
                        <button
                          type="button"
                          className="control !h-7 !text-[11px]"
                          onClick={() => {
                            setReverseTarget(p);
                            setReverseReason("");
                          }}
                          title="Reverse this payment (requires a written reason; creates a counter-entry)"
                        >
                          Reverse
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => onOpenRecord(p.recordId)}
                        aria-label="Open record"
                        title="Open record"
                      >
                        <ChevronRight className="h-4 w-4" strokeWidth={2.4} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {payments && payments.pagination.totalPages > 1 && (
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              className="control"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <button
              type="button"
              className="control"
              disabled={page >= payments.pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
      </calcite-card>

      {reverseNotice && (
        <calcite-notice
          open
          icon={reverseNotice.kind === "ok" ? "check-circle" : "exclamation-mark-triangle"}
          kind={reverseNotice.kind === "ok" ? "success" : "danger"}
          scale="s"
          closable
          onCalciteNoticeClose={() => setReverseNotice(null)}
        >
          <div slot="title">{reverseNotice.kind === "ok" ? "Payment reversed" : "Reversal failed"}</div>
          <div slot="message">{reverseNotice.message}</div>
        </calcite-notice>
      )}

      {reverseTarget && (
        <div className="modal-backdrop" onClick={() => setReverseTarget(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <p className="label">Reverse payment</p>
            <h3 className="mt-0.5 text-base font-semibold">
              {reverseTarget.receiptNumber} · KES {Number(reverseTarget.amountPaid).toLocaleString()}
            </h3>
            <p className="mt-1 text-[11.5px] text-[var(--muted)]">
              {reverseTarget.taxpayerName ?? "—"} · {reverseTarget.paymentMethod}. This creates a
              negative counter-entry — the original stays in the ledger, permanently marked as
              reversed. It cannot be undone.
            </p>
            <label className="mt-3 block">
              <span className="auth-label">Reason (required, min 10 characters)</span>
              <textarea
                className="auth-input !h-20 resize-none py-2"
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                placeholder="e.g. Captured against the wrong taxpayer record — correct payment re-entered as RCP-…"
                maxLength={1000}
                autoFocus
              />
            </label>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="control" onClick={() => setReverseTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-control"
                disabled={reversing || reverseReason.trim().length < 10}
                onClick={submitReversal}
              >
                {reversing ? "Reversing…" : "Reverse payment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/*  Officer dashboard                                                      */
/* ----------------------------------------------------------------------- */

/** Friendly label for Paystack's `channel` field. Used in the ledger chip. */
function humanizePaystackChannel(channel: string | null | undefined): string {
  const c = String(channel ?? "").toLowerCase();
  if (c.startsWith("mobile_money")) return "M-Pesa";
  if (c === "card") return "Card";
  if (c === "bank" || c === "bank_transfer") return "Bank";
  if (c === "eft") return "EFT";
  if (c === "qr") return "QR";
  return c || "Online";
}

export { PaymentsPage };
