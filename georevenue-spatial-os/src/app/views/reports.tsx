"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Download, FileText } from "lucide-react";
import {
  api,
  type DashboardPayload,
  type Notice,
  type Payment,
  type Zone,
} from "../lib/api";
import { downloadCsv, formatKesM } from "../lib/shared";

type ReportKind =
  | "revenue-summary"
  | "billing-register"
  | "collections"
  | "zones"
  | "outstanding";

const reports: { id: ReportKind; title: string; description: string }[] = [
  {
    id: "revenue-summary",
    title: "Revenue summary",
    description: "Year-to-date billed vs. collected with collection rate.",
  },
  {
    id: "billing-register",
    title: "Billing register",
    description: "All demand notices issued in the current billing year.",
  },
  {
    id: "collections",
    title: "Collections register",
    description: "All payments recorded by method, date, and receipt number.",
  },
  {
    id: "zones",
    title: "Revenue by zone",
    description: "Per-zone billed and collected totals.",
  },
  {
    id: "outstanding",
    title: "Outstanding balances",
    description: "Issued notices not yet paid.",
  },
];

function SettingsReports() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [zoneId, setZoneId] = useState<string>("");
  const [billingYear, setBillingYear] = useState<string>(String(new Date().getFullYear()));
  const [busy, setBusy] = useState<ReportKind | null>(null);
  const [result, setResult] = useState<{ kind: "ok" | "err"; message: string } | null>(null);

  useEffect(() => {
    api.zones.list().then(setZones).catch(() => setZones([]));
  }, []);

  const handleRun = async (kind: ReportKind) => {
    setBusy(kind);
    setResult(null);
    try {
      const zone = zoneId ? Number(zoneId) : undefined;
      const year = Number(billingYear) || new Date().getFullYear();

      if (kind === "revenue-summary") {
        const data = await api.dashboard.get({ zoneId: zone, billingYear: year });
        downloadCsv(`revenue-summary-${year}`, summaryRows(data));
      } else if (kind === "zones") {
        const data = await api.dashboard.get({ zoneId: zone, billingYear: year });
        downloadCsv(`zones-${year}`, data.byZone.map((z) => ({
          zone: z.zoneName,
          records: z.recordCount,
          billed: Number(z.billed).toFixed(2),
          collected: Number(z.collected).toFixed(2),
          collectionRate:
            Number(z.billed) > 0
              ? ((Number(z.collected) / Number(z.billed)) * 100).toFixed(2) + "%"
              : "0%",
        })));
      } else if (kind === "billing-register") {
        const all = await fetchAllNotices({ zoneId: zone });
        downloadCsv(`billing-register-${year}`, all.map(noticeRow));
      } else if (kind === "outstanding") {
        const all = await fetchAllNotices({ zoneId: zone, status: "issued" });
        downloadCsv(`outstanding-${year}`, all.map(noticeRow));
      } else if (kind === "collections") {
        const all = await fetchAllPayments({});
        downloadCsv(`collections-${year}`, all.map((p) => ({
          receiptNumber: p.receiptNumber,
          paymentDate: p.paymentDate,
          taxpayer: p.taxpayerName ?? "",
          method: p.paymentMethod,
          reference: p.mpesaRef ?? p.bankRef ?? "",
          amount: Number(p.amountPaid).toFixed(2),
          recordedBy: p.recordedByName ?? "",
        })));
      }
      setResult({ kind: "ok", message: "Report downloaded." });
    } catch (err) {
      setResult({
        kind: "err",
        message: err instanceof Error ? err.message : "Failed to build report",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <calcite-card class="dash-card section-card">
        <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-[var(--primary)]" strokeWidth={2.2} />
          <div>
            <h2 className="text-[15px] font-semibold leading-tight">Reports</h2>
            <p className="text-[11.5px] text-[var(--muted)]">
              Generate CSV exports for finance & audit.
            </p>
          </div>
        </div>
        <label className="block ml-auto">
          <span className="auth-label">Zone</span>
          <div className="auth-input-shell">
            <select
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              className="auth-input auth-input--bare"
            >
              <option value="">All zones</option>
              {zones.map((z) => (
                <option key={z.zoneId} value={String(z.zoneId)}>
                  {z.zoneName}
                </option>
              ))}
            </select>
            <ChevronDown className="mr-3 h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
          </div>
        </label>
        <label className="block">
          <span className="auth-label">Billing year</span>
          <input
            type="number"
            className="auth-input w-[130px]"
            value={billingYear}
            min="2020"
            max="2100"
            onChange={(e) => setBillingYear(e.target.value)}
          />
        </label>
        </div>
      </calcite-card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {reports.map((r) => (
          <calcite-card key={r.id} class="dash-card section-card">
            <h3 className="text-[14px] font-semibold leading-tight">{r.title}</h3>
            <p className="mt-1 text-[11.5px] text-[var(--muted)]">{r.description}</p>
            <button
              type="button"
              className="primary-control mt-3 w-full justify-center"
              onClick={() => handleRun(r.id)}
              disabled={busy === r.id}
            >
              <Download className="h-3.5 w-3.5" strokeWidth={2.4} />
              <span>{busy === r.id ? "Building…" : "Download CSV"}</span>
            </button>
          </calcite-card>
        ))}
      </div>

      {result && (
        <calcite-notice
          open
          icon={result.kind === "ok" ? "check-circle" : "exclamation-mark-triangle"}
          kind={result.kind === "ok" ? "success" : "danger"}
          scale="s"
          closable
          onCalciteNoticeClose={() => setResult(null)}
        >
          <div slot="title">{result.kind === "ok" ? "Ready" : "Failed"}</div>
          <div slot="message">{result.message}</div>
        </calcite-notice>
      )}
    </div>
  );
}

function summaryRows(data: DashboardPayload) {
  const s = data.summary;
  return [
    { metric: "Total records", value: s.totalRecords },
    { metric: "Active records", value: s.activeRecords },
    { metric: "Pending records", value: s.pendingRecords },
    { metric: "Total billed (KES)", value: Number(s.totalBilled).toFixed(2) },
    { metric: "Total collected (KES)", value: Number(s.totalCollected).toFixed(2) },
    { metric: "Outstanding (KES)", value: Number(s.totalOutstanding).toFixed(2) },
    { metric: "Collection rate", value: `${s.collectionRate}%` },
    { metric: "Notices issued", value: s.noticeCount },
    { metric: "Paid notices", value: s.paidNotices },
    { metric: "Billing year", value: data.billingYear },
    { metric: "Total collected (short)", value: formatKesM(s.totalCollected) },
  ];
}

async function fetchAllNotices(filter: { zoneId?: number; status?: string }): Promise<Notice[]> {
  return paginate((page) =>
    api.notices.list({ ...filter, page, limit: 200 }).then((r) => ({
      data: r.data,
      totalPages: r.pagination.totalPages,
    })),
  );
}

async function fetchAllPayments(filter: { dateFrom?: string; dateTo?: string }): Promise<Payment[]> {
  return paginate((page) =>
    api.payments.list({ ...filter, page, limit: 200 }).then((r) => ({
      data: r.data,
      totalPages: r.pagination.totalPages,
    })),
  );
}

async function paginate<T>(
  fetcher: (page: number) => Promise<{ data: T[]; totalPages: number }>,
): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await fetcher(page);
    out.push(...res.data);
    totalPages = res.totalPages;
    page += 1;
  } while (page <= totalPages && page <= 20); // hard ceiling
  return out;
}

function noticeRow(n: Notice) {
  return {
    noticeNumber: n.noticeNumber,
    taxpayerName: n.taxpayerName ?? "",
    taxpayerIdNo: n.taxpayerIdNo ?? "",
    zone: n.zoneName ?? "",
    amountDue: Number(n.amountDue).toFixed(2),
    issuedDate: n.issuedDate,
    dueDate: n.dueDate,
    status: n.noticeStatus,
    generatedBy: n.generatedByName ?? "",
  };
}

export { SettingsReports };
