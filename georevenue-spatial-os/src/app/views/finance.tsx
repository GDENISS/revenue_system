"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, RefreshCw } from "lucide-react";
import { api, type DashboardPayload } from "../lib/api";
import {
  Kpi,
  Legend,
  type View,
  type DateRange,
  dateRangeLabels,
  formatKesM,
  formatRelative,
  percentagesOf100,
  toEpochMs,
} from "../lib/shared";

function FinanceDashboard({
  firstName,
  onNavigate,
}: {
  firstName: string;
  onNavigate: (v: View) => void;
}) {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Date filter now lives next to the dashboard's own Refresh / Generate-notices
  // controls instead of polluting the global TopBar. Resets per visit, which is
  // fine because the dashboard is the only view that uses it.
  const [dateRange, setDateRange] = useState<DateRange>("30d");

  // Resolve the dateRange (today / 7d / 30d / quarter / ytd) into a concrete
  // window the backend can use to scope the trend chart.
  const windowFor = (r: DateRange): { dateFrom: string; dateTo: string } => {
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const dateTo = iso(today);
    if (r === "today") return { dateFrom: dateTo, dateTo };
    if (r === "7d") {
      const d = new Date(today);
      d.setDate(d.getDate() - 6);
      return { dateFrom: iso(d), dateTo };
    }
    if (r === "30d") {
      const d = new Date(today);
      d.setDate(d.getDate() - 29);
      return { dateFrom: iso(d), dateTo };
    }
    if (r === "quarter") {
      const d = new Date(today);
      d.setMonth(d.getMonth() - 3);
      return { dateFrom: iso(d), dateTo };
    }
    // ytd
    return { dateFrom: `${today.getFullYear()}-01-01`, dateTo };
  };

  const fetchDashboard = (silent: boolean) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    return api.dashboard
      .get(windowFor(dateRange))
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Could not load dashboard data");
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.dashboard
      .get(windowFor(dateRange))
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Could not load dashboard data");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange]);

  if (loading && !data) return <DashboardSkeleton />;
  if (error && !data) {
    return (
      <calcite-notice open icon="exclamation-mark-triangle" kind="danger" scale="m">
        <div slot="title">Could not load dashboard</div>
        <div slot="message">{error}</div>
      </calcite-notice>
    );
  }
  if (!data) return null;

  const s = data.summary;
  const ratePct = Number(s.collectionRate || 0);
  // Outstanding is now anchored to the realistic expected revenue. When the
  // backend hasn't shipped the new field yet, fall back to legacy totalBilled.
  const target = s.expectedRevenue ?? s.totalBilled;
  const outstandingPct = target > 0
    ? Math.round((s.totalOutstanding / target) * 100)
    : 0;
  const billableRecords = s.billableRecords ?? 0;
  const unbilledRecords = s.unbilledRecords ?? 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Tiny toolbar: refresh + last-updated indicator */}
      <div className="flex items-center justify-between">
        <p className="text-[11.5px] text-[var(--muted)]">
          Billing year{" "}
          <span className="font-semibold text-[var(--on-surface)]">{data.billingYear}</span>{" "}
          · {s.totalRecords.toLocaleString()} records ·{" "}
          {s.noticeCount.toLocaleString()} notices issued
        </p>
        <div className="flex items-center gap-1.5">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
          <button
            type="button"
            className="control !h-8"
            onClick={() => onNavigate("bulk")}
            title="Open the notices page to generate a batch"
          >
            <span>Generate notices</span>
            <ArrowUpRight className="h-3 w-3" strokeWidth={2.4} />
          </button>
          <button
            type="button"
            className="control !h-8"
            onClick={() => fetchDashboard(true)}
            disabled={refreshing}
            title="Reload dashboard"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} strokeWidth={2.2} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Hero band: big collection rate + 3 compact KPIs in one panel */}
      <section className="grid gap-3 lg:grid-cols-[1.1fr_2fr]">
        <HeroCollectionCard
          pct={ratePct}
          target={target}
          collected={s.totalCollected}
          billableRecords={billableRecords}
          billingYear={data.billingYear}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Kpi
            label="Expected revenue"
            value={formatKesM(target)}
            delta={`${billableRecords.toLocaleString()} records`}
            deltaCaption="× fee schedule"
            tone="primary"
          />
          <Kpi
            label="Collected"
            value={formatKesM(s.totalCollected)}
            delta={`${ratePct.toFixed(1)}%`}
            deltaCaption="of expected"
            tone="success"
          />
          <Kpi
            label="Outstanding"
            value={formatKesM(s.totalOutstanding)}
            delta={`${outstandingPct}%`}
            deltaCaption="of expected"
            tone="error"
          />
          <Kpi
            label="Notices issued"
            value={s.noticeCount.toLocaleString()}
            delta={`${s.paidNotices}`}
            deltaCaption="paid"
            tone="tertiary"
          />
          <Kpi
            label="Active records"
            value={s.activeRecords.toLocaleString()}
            delta={s.totalRecords.toLocaleString()}
            deltaCaption="total"
            tone="success"
          />
          <Kpi
            label="Unbilled records"
            value={unbilledRecords.toLocaleString()}
            delta={s.pendingRecords ? `${s.pendingRecords} pending` : "no fee match"}
            deltaCaption="needs a schedule"
            tone="warning"
          />
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <RevenueChartLive trend={data.monthlyTrend} range={dateRange} />
        <RevenueSourcesLive byType={data.byRecordType} />
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <ZoneTableLive byZone={data.byZone} onOpenMap={() => onNavigate("map")} />
        <ActivityFeedLive entries={data.recentActivity} />
      </section>

      <p className="text-center text-[11px] text-[var(--muted)]">
        Hi {firstName} — {s.totalRecords.toLocaleString()} records ·{" "}
        {s.activeRecords.toLocaleString()} active · {s.noticeCount.toLocaleString()} notices issued.
      </p>
    </div>
  );
}

function HeroCollectionCard({
  pct,
  target,
  collected,
  billableRecords,
  billingYear,
}: {
  pct: number;
  target: number;
  collected: number;
  billableRecords: number;
  billingYear: number;
}) {
  // Clamp the donut to 0–100% so the ring stays sensible even when prior-year
  // arrears push collected past current-year billings.
  const safe = Math.min(100, Math.max(0, pct));
  const overCollected = pct > 100;
  const onTarget = pct >= 90;
  const r = 52;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - safe / 100);
  // Format the headline number so it always fits the donut:
  //   < 100 → one decimal (97.3%)
  //   100–999 → whole number (133%)
  //   ≥ 1000 → "999%+" overflow indicator
  const display =
    pct < 100
      ? pct.toFixed(1)
      : pct >= 1000
        ? "999"
        : Math.round(pct).toString();
  const ringColor = overCollected
    ? "var(--success)"
    : onTarget
      ? "var(--success)"
      : "var(--primary)";
  return (
    <calcite-card class="dash-card hero-card">
      <div className="flex h-full items-center gap-4">
        <div className="relative grid h-[140px] w-[140px] shrink-0 place-items-center">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
            <circle cx="60" cy="60" r={r} stroke="var(--surface-secondary)" strokeWidth="10" fill="none" />
            <circle
              cx="60"
              cy="60"
              r={r}
              stroke={ringColor}
              strokeWidth="10"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 700ms ease" }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-[24px] font-semibold tabular-nums leading-none">
                {display}
                {pct >= 1000 ? "+" : ""}
                <span className="text-[14px] text-[var(--muted)]">%</span>
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                {overCollected ? "Over target" : "Collected"}
              </p>
            </div>
          </div>
        </div>
        <div className="flex-1">
          <p className="label">Collection rate</p>
          <p className="mt-1 text-[18px] font-semibold tabular-nums">
            {formatKesM(collected)}{" "}
            <span className="text-[11px] font-normal text-[var(--muted)]">
              of {formatKesM(target)}
            </span>
          </p>
          <p className="text-[11px] text-[var(--muted)]">
            {billableRecords.toLocaleString()} billable record
            {billableRecords === 1 ? "" : "s"} · {billingYear} cycle
            {overCollected && (
              <>
                {" "}· includes prior-year arrears
              </>
            )}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px]">
            <span className="rounded-md bg-[var(--soft-fill)] px-2 py-1">
              <span className="block text-[10px] uppercase tracking-wide text-[var(--muted)]">
                Target
              </span>
              <span className="font-semibold">90%</span>
            </span>
            <span className="rounded-md bg-[var(--soft-fill)] px-2 py-1">
              <span className="block text-[10px] uppercase tracking-wide text-[var(--muted)]">
                {overCollected ? "Over by" : "Gap"}
              </span>
              <span
                className="font-semibold"
                style={{
                  color: overCollected
                    ? "var(--success)"
                    : onTarget
                      ? "var(--success)"
                      : "var(--warning)",
                }}
              >
                {overCollected
                  ? `+${Math.round(pct - 90)}%`
                  : `${Math.max(0, 90 - pct).toFixed(1)}%`}
              </span>
            </span>
          </div>
        </div>
      </div>
    </calcite-card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <calcite-card key={i} class="dash-card kpi-card" loading />
        ))}
      </section>
      <section className="grid grid-cols-1 gap-3 xl:grid-cols-[1.4fr_1fr]">
        <calcite-card class="dash-card" style={{ minHeight: 280 }} loading />
        <calcite-card class="dash-card" style={{ minHeight: 280 }} loading />
      </section>
    </div>
  );
}

function RevenueChartLive({
  trend,
  range,
}: {
  trend: DashboardPayload["monthlyTrend"];
  range: DateRange;
}) {
  const points = trend.length > 0 ? trend : [];
  const max = Math.max(1, ...points.map((p) => Number(p.collected) || 0));
  const labels = points.map((p) => p.month.slice(5));
  const polyPoints = points.length
    ? points
        .map((p, i) => {
          const x = points.length === 1 ? 50 : (i / (points.length - 1)) * 100;
          const y = 100 - ((Number(p.collected) || 0) / max) * 92;
          return `${x},${y}`;
        })
        .join(" ")
    : "";
  const polygonPoints = points.length ? `0,100 ${polyPoints} 100,100` : "";

  return (
    <calcite-card class="dash-card section-card">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="panel-title">Revenue trend</h2>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            {dateRangeLabels[range]} · monthly collections
          </p>
        </div>
      </div>
      <div className="relative h-[220px]">
        <div className="absolute inset-y-2 left-0 flex flex-col justify-between pr-3 text-[10px] text-[var(--muted)]">
          <span>{formatKesM(max)}</span>
          <span>{formatKesM(max * 0.75)}</span>
          <span>{formatKesM(max * 0.5)}</span>
          <span>{formatKesM(max * 0.25)}</span>
          <span>0</span>
        </div>
        <div className="absolute inset-y-0 left-14 right-0">
          <div className="grid h-full grid-rows-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="border-t border-[var(--line)]" />
            ))}
          </div>
          {points.length > 0 ? (
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="chartFillLive" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity=".22" />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon points={polygonPoints} fill="url(#chartFillLive)" />
              <polyline
                points={polyPoints}
                fill="none"
                stroke="var(--primary)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <div className="absolute inset-0 grid place-items-center text-[12.5px] text-[var(--muted)]">
              No payments recorded yet.
            </div>
          )}
        </div>
        <div className="absolute bottom-0 left-14 right-0 flex justify-between border-t border-[var(--line)] pt-1.5 text-[10px] text-[var(--muted)]">
          {labels.length === 0 ? (
            <>
              <span>—</span>
              <span>—</span>
              <span>—</span>
            </>
          ) : (
            labels.map((l, i) => <span key={`${l}-${i}`}>{l}</span>)
          )}
        </div>
      </div>
    </calcite-card>
  );
}

function RevenueSourcesLive({
  byType,
}: {
  byType: DashboardPayload["byRecordType"];
}) {
  const rows = byType.filter((r) => Number(r.collected) > 0 || Number(r.billed) > 0);
  const total = rows.reduce((s, r) => s + Number(r.collected || 0), 0);
  const palette = ["#007ac2", "#00619b", "#35ac46", "#edd317", "#d83020"];
  // Integer percentages that sum to exactly 100 — largest-remainder method.
  const sharePcts = percentagesOf100(rows.map((r) => Number(r.collected) || 0));
  const stops: string[] = [];
  let cum = 0;
  sharePcts.forEach((pct, i) => {
    const next = cum + pct;
    stops.push(`${palette[i % palette.length]} ${cum}% ${next}%`);
    cum = next;
  });

  return (
    <calcite-card class="dash-card section-card">
      <h2 className="panel-title mb-3">Revenue sources</h2>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-[var(--muted)]">
          No revenue collected yet.
        </p>
      ) : (
        <div className="flex items-center gap-4">
          <div
            className="relative grid h-28 w-28 shrink-0 place-items-center rounded-full"
            style={{
              background: `conic-gradient(${stops.length ? stops.join(", ") : "var(--surface-secondary)"})`,
            }}
          >
            <div className="donut-core grid h-[72px] w-[72px] place-items-center rounded-full">
              <div className="text-center leading-none">
                <p className="text-base font-semibold tabular-nums">
                  {formatKesM(total).replace("KES ", "")}
                </p>
                <p className="mt-0.5 text-[9px] uppercase tracking-wider text-[var(--muted)]">
                  Total KES
                </p>
              </div>
            </div>
          </div>
          <div className="flex-1 space-y-2 text-[12px]">
            {rows.map((r, i) => (
              <Legend
                key={r.typeName}
                color={palette[i % palette.length]}
                label={r.typeName}
                value={formatKesM(Number(r.collected)).replace("KES ", "")}
                share={`${sharePcts[i]}%`}
              />
            ))}
          </div>
        </div>
      )}
    </calcite-card>
  );
}

function ZoneTableLive({
  byZone,
  onOpenMap,
}: {
  byZone: DashboardPayload["byZone"];
  onOpenMap?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? byZone : byZone.slice(0, 3);
  return (
    <calcite-card class="dash-card section-card zone-card">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="panel-title">Top zones by revenue</h2>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            {byZone.length} zone{byZone.length === 1 ? "" : "s"} · ranked by collected
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {onOpenMap && (
            <button className="control" type="button" onClick={onOpenMap}>
              <span>View on map</span>
            </button>
          )}
          {byZone.length > 3 && (
            <button
              className="text-[11px] font-bold uppercase tracking-wider text-[var(--primary)] hover:underline"
              type="button"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Show top 3" : "View all"}
            </button>
          )}
        </div>
      </div>
      <table className="w-full text-left text-[12.5px]">
        <thead className="label border-b border-[var(--line)]">
          <tr>
            <th className="py-2.5">Zone</th>
            <th className="hidden text-right md:table-cell">Records</th>
            <th className="hidden text-right md:table-cell">Billed</th>
            <th className="text-right">Collected</th>
            <th className="hidden text-center lg:table-cell">Progress</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-6 text-center text-[var(--muted)]">
                No zone activity yet.
              </td>
            </tr>
          ) : (
            visible.map((row) => {
              const pct =
                Number(row.billed) > 0
                  ? Math.min(100, Math.round((Number(row.collected) / Number(row.billed)) * 100))
                  : 0;
              return (
                <tr key={row.zoneId} className="border-b border-[var(--line)] hover:bg-[var(--soft-fill)]">
                  <td className="py-3 font-semibold">{row.zoneName}</td>
                  <td className="hidden text-right tabular-nums text-[var(--muted)] md:table-cell">
                    {row.recordCount}
                  </td>
                  <td className="hidden text-right tabular-nums text-[var(--muted)] md:table-cell">
                    {formatKesM(Number(row.billed))}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatKesM(Number(row.collected))}
                  </td>
                  <td className="hidden lg:table-cell">
                    <div className="mx-auto h-1.5 max-w-[120px] overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                      <div
                        className="h-full rounded-full bg-[var(--primary)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </calcite-card>
  );
}

function ActivityFeedLive({
  entries,
}: {
  entries: DashboardPayload["recentActivity"];
}) {
  return (
    <calcite-card class="dash-card section-card activity-card">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="panel-title">Recent activity</h2>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            Last {entries.length} audit events
          </p>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="text-[12.5px] text-[var(--muted)]">No activity logged yet.</p>
      ) : (
        <ul className="max-h-[260px] space-y-1 overflow-y-auto pr-1">
          {entries.map((entry) => {
            const tone = activityToneFor(entry.action);
            return (
              <li
                key={entry.logId}
                className="flex items-start gap-2.5 rounded-md px-1.5 py-2 text-[12.5px] hover:bg-[var(--soft-fill)]"
              >
                <span
                  className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: `var(--${tone})` }}
                />
                <div className="flex-1 min-w-0">
                  <p className="leading-snug">
                    <span className="font-semibold">{entry.userName ?? "System"}</span>{" "}
                    <span className="text-[var(--on-surface-secondary)]">
                      {humanizeAction(entry.action)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                    {formatRelative(toEpochMs(entry.createdAt)) ?? entry.createdAt}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </calcite-card>
  );
}

function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="control !h-8"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{dateRangeLabels[value]}</span>
        <span className="ml-2 text-[var(--muted)]">▾</span>
      </button>
      {open && (
        <div className="popover absolute right-0 top-[calc(100%+6px)] z-30 w-44 p-1">
          {(Object.keys(dateRangeLabels) as DateRange[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                onChange(key);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-[12.5px] transition-colors hover:bg-[var(--soft-fill)] ${
                key === value ? "text-[var(--primary)] font-semibold" : ""
              }`}
            >
              <span>{dateRangeLabels[key]}</span>
              {key === value && <Check className="h-3.5 w-3.5" strokeWidth={2.4} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function activityToneFor(action: string): string {
  if (action.includes("PAYMENT")) return "success";
  if (action.includes("NOTICE")) return "warning";
  if (action.includes("LOGIN")) return "primary";
  if (action.includes("CREATE") || action.includes("UPDATE")) return "tertiary";
  return "muted";
}

function humanizeAction(action: string): string {
  return action
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\bbulk\b/gi, "bulk-generated");
}

export { FinanceDashboard };
