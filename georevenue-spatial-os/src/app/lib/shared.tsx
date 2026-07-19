"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  BarChart3,
  Briefcase,
  ChevronDown,
  CheckCircle,
  Circle,
  Clock,
  Coins,
  Database,
  Download,
  Layers,
  LayoutDashboard,
  Map as MapIcon,
  ReceiptText,
  Search,
  Settings as SettingsIcon,
  Shield,
  Users,
  User,
  Wallet,
} from "lucide-react";
import type { Role, BackendUser } from "./api";

/* ── Types ─────────────────────────────────────────────────────────── */

export type View =
  | "finance"
  | "map"
  | "record"
  | "bulk"
  | "payments"
  | "fees"
  | "officer"
  | "config";
export type Theme = "dark" | "light";
export type DateRange = "today" | "7d" | "30d" | "quarter" | "ytd";
export type SelectOption = string | { label: string; value: string };

/* ── Constants ─────────────────────────────────────────────────────── */

export const COUNTY_BRAND = { name: "County Revenue" };
export const NAIROBI_CENTER: [number, number] = [36.8219, -1.2921];

export const dateRangeLabels: Record<DateRange, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  quarter: "This quarter",
  ytd: "Year to date",
};

// Each nav item has a unique lucide icon component (no duplicates).
export const navItems: {
  id: View;
  label: string;
  hint: string;
  Icon: typeof LayoutDashboard;
}[] = [
  { id: "finance", label: "Dashboard", hint: "Revenue overview", Icon: LayoutDashboard },
  { id: "map", label: "Map", hint: "Spatial coverage", Icon: MapIcon },
  { id: "record", label: "Records", hint: "Taxpayer records", Icon: Users },
  { id: "bulk", label: "Notices", hint: "Demand notices", Icon: ReceiptText },
  { id: "payments", label: "Payments", hint: "Collections", Icon: Wallet },
  { id: "fees", label: "Fees", hint: "Fee schedule & assignments", Icon: Coins },
  { id: "officer", label: "Officer", hint: "Field workspace", Icon: Briefcase },
  { id: "config", label: "Settings", hint: "Integrations & users", Icon: SettingsIcon },
];

/* ── Tiny visual atoms ─────────────────────────────────────────────── */

export function CountyCrest({ size = 18 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-md bg-[var(--primary)] text-white"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Shield
        style={{ width: Math.max(12, size * 0.62), height: Math.max(12, size * 0.62) }}
        strokeWidth={2.4}
      />
    </span>
  );
}

const calciteIcons: Record<
  string,
  React.ComponentType<{ className?: string; style?: CSSProperties; strokeWidth?: number }>
> = {
  cloud_done: Database,
  dashboard: LayoutDashboard,
  download: Download,
  fact_check: Users,
  layers: Layers,
  map: MapIcon,
  payments: Wallet,
  person: User,
  receipt_long: ReceiptText,
  schedule: Clock,
  search: Search,
  settings: SettingsIcon,
  shield: Shield,
  timer: Clock,
  verified: CheckCircle,
  briefcase: Briefcase,
  chart: BarChart3,
};

/** Bridge component for legacy code that passes calcite-style icon names as text. */
export function Icon({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const key = String(children).trim();
  const Cmp = calciteIcons[key] ?? Circle;
  return <Cmp className={`h-4 w-4 ${className}`} style={style} strokeWidth={2.2} />;
}

/* ── ArcGIS-signature 3-bar loader ─────────────────────────────────── */
/* Fully inline-styled so it renders regardless of CSS-class purging.    */
/* Only the @keyframes (esri-bar) lives in globals.css.                  */

export function Loader({
  label,
  scale = "m",
  inline = false,
}: {
  label?: string;
  scale?: "s" | "m" | "l";
  inline?: boolean;
}) {
  const dims =
    scale === "s"
      ? { w: 4, h: 18, gap: 3 }
      : scale === "l"
        ? { w: 8, h: 48, gap: 7 }
        : { w: 6, h: 30, gap: 5 };

  const bars = (
    <span
      role="status"
      aria-label={label ?? "Loading"}
      style={{
        display: "inline-flex",
        alignItems: "flex-end",
        gap: dims.gap,
        height: dims.h,
      }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            display: "block",
            width: dims.w,
            height: "100%",
            borderRadius: 2,
            background: "var(--primary)",
            transformOrigin: "bottom",
            animation: "esri-bar 1s ease-in-out infinite",
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </span>
  );

  if (inline) return bars;

  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
      }}
    >
      {bars}
      {label ? (
        <span style={{ fontSize: "12.5px", color: "var(--muted)", letterSpacing: "0.2px" }}>
          {label}
        </span>
      ) : null}
    </span>
  );
}

/* ── Reusable molecules ────────────────────────────────────────────── */

export function Kpi({
  label,
  value,
  delta,
  deltaCaption,
  tone,
}: {
  label: string;
  value: string;
  delta: string;
  deltaCaption: string;
  tone: string;
}) {
  return (
    <calcite-card class="dash-card kpi-card">
      <p className="label">{label}</p>
      <p className="mt-2 text-[22px] font-semibold tabular-nums leading-tight">{value}</p>
      <p className="mt-1.5 text-[12px]" style={{ color: `var(--${tone})` }}>
        <span className="font-semibold tabular-nums">{delta}</span>
        <span className="ml-2 font-normal text-[var(--muted)]">{deltaCaption}</span>
      </p>
    </calcite-card>
  );
}

export function Legend({
  color,
  label,
  value,
  share,
}: {
  color: string;
  label: string;
  value: string;
  share: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        <span>{label}</span>
      </span>
      <span className="flex items-baseline gap-1.5 tabular-nums">
        <span className="font-semibold">{value}</span>
        <span className="text-[10px] text-[var(--muted)]">{share}</span>
      </span>
    </div>
  );
}

export function MiniStat({
  icon,
  label,
  value,
  caption,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  caption: string;
  tone: string;
}) {
  const color = `var(--${tone})`;
  return (
    <calcite-card class="dash-card kpi-card">
      <div className="flex items-start justify-between">
        <p className="label">{label}</p>
        <span
          className="grid h-7 w-7 place-items-center rounded-md"
          style={{ background: color, opacity: 0.14 }}
        >
          <Icon className="text-sm" style={{ color }}>
            {icon}
          </Icon>
        </span>
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] text-[var(--muted)]">{caption}</p>
    </calcite-card>
  );
}

export function DetailRow({
  label,
  value,
  link,
  mono,
  tone,
}: {
  label: string;
  value?: string | null;
  link?: string;
  mono?: boolean;
  tone?: "success" | "warn" | "error";
}) {
  const display = value && value.toString().trim() !== "" ? value : "—";
  const toneColor =
    tone === "success"
      ? "var(--success)"
      : tone === "warn"
        ? "var(--warning)"
        : tone === "error"
          ? "var(--error)"
          : undefined;
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] py-2 last:border-0">
      <span className="text-[11.5px] text-[var(--muted)]">{label}</span>
      <span
        className={`text-right text-[12.5px] ${mono ? "font-mono" : ""}`}
        style={toneColor ? { color: toneColor } : undefined}
      >
        {link && value ? (
          <a className="hover:underline" href={link} target="_blank" rel="noreferrer">
            {display}
          </a>
        ) : (
          display
        )}
      </span>
    </div>
  );
}

export function SelectField({
  label,
  icon,
  value,
  onChange,
  options,
}: {
  label: string;
  icon: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1 flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--soft-fill)] px-2.5 py-2 text-[12.5px] focus-within:border-[var(--primary)]">
        <Icon className="text-[var(--muted)]">{icon}</Icon>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 appearance-none bg-transparent outline-none"
        >
          {options.map((opt) => {
            const v = typeof opt === "string" ? opt : opt.value;
            const l = typeof opt === "string" ? opt : opt.label;
            return (
              <option key={v} value={v}>
                {l}
              </option>
            );
          })}
        </select>
        <ChevronDown className="h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={2.4} />
      </div>
    </label>
  );
}

/* ── Formatters ────────────────────────────────────────────────────── */

export function formatKes(amount: number): string {
  return `KES ${amount.toLocaleString()}`;
}

/** Short-form: 1.2M, 950K, etc. */
export function formatKesM(amount: number): string {
  if (!amount) return "KES 0";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `KES ${(amount / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `KES ${(amount / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `KES ${(amount / 1_000).toFixed(1)}K`;
  return `KES ${amount.toLocaleString()}`;
}

export function toEpochMs(iso?: string | null): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : t;
}

export function formatDate(epoch?: number): string | undefined {
  if (!epoch) return undefined;
  try {
    return new Date(epoch).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return undefined;
  }
}

export function formatRelative(epoch?: number): string | undefined {
  if (!epoch) return undefined;
  const diffMs = Date.now() - epoch;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return formatDate(epoch);
}

export function roleLabelOf(role: Role): string {
  return (
    (
      {
        admin: "Administrator",
        finance_manager: "Finance Manager",
        officer: "Field Officer",
        gis_officer: "GIS Officer",
      } as const
    )[role] ?? role
  );
}

export function initialsOf(user: BackendUser): string {
  return (
    user.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "U"
  );
}

export function activityToneFor(action: string): string {
  if (action.includes("PAYMENT")) return "success";
  if (action.includes("NOTICE")) return "warning";
  if (action.includes("LOGIN")) return "primary";
  if (action.includes("CREATE") || action.includes("UPDATE")) return "tertiary";
  return "muted";
}

export function humanizeAction(action: string): string {
  return action.toLowerCase().replace(/_/g, " ").replace(/\bbulk\b/gi, "bulk-generated");
}

/* ── Map color palette ─────────────────────────────────────────────── */

export const TYPE_COLORS: Record<string, string> = {
  Parcel: "#007ac2",
  Business: "#00619b",
  "Market Stall": "#35ac46",
};

export function colorForType(typeName: string): string {
  return TYPE_COLORS[typeName] ?? "#7a4eb1";
}

/**
 * Friendly, revenue-oriented labels for the three canonical record types.
 * The DB / ArcGIS slot names stay "Parcel" / "Business" / "Market Stall"
 * (so fee schedules, layer slots and colours keep working) — this is purely
 * the display name shown to users.
 */
export const RECORD_TYPE_LABELS: Record<string, string> = {
  Parcel: "Land Rates",
  Business: "Business Permits and Licenses",
  "Market Stall": "Market Fees and Stall Charges",
};

export function recordTypeLabel(canonical: string | null | undefined): string {
  if (!canonical) return "—";
  return RECORD_TYPE_LABELS[canonical] ?? canonical;
}

/* ── Payment-status palette (for pins coloured by financial state) ─── */

export type RecordHealth = "paid" | "outstanding" | "pending" | "inactive";

/** Friendly label per health bucket — used in the map legend. */
export const HEALTH_LABELS: Record<RecordHealth, string> = {
  paid: "Paid up",
  outstanding: "Has outstanding",
  pending: "Pending review",
  inactive: "Inactive / closed",
};

/** Map colour palette aligned with the design tokens for status accents. */
export const HEALTH_COLORS: Record<RecordHealth, string> = {
  paid: "#35ac46",          // Calcite success green
  outstanding: "#d83020",   // Calcite danger red — owes money
  pending: "#edd317",       // Calcite warning yellow — not yet active
  inactive: "#b1b1b1",      // Calcite neutral grey — suspended / closed
};

/** Classify a taxpayer record into one of four health buckets. */
export function recordHealth(record: {
  status?: string | null;
  outstandingBalance?: number | string | null;
}): RecordHealth {
  // Payment health wins over lifecycle status. A record's `status` of
  // "pending" only means it hasn't been activated yet — it must NOT make a
  // fully-settled parcel show orange. Only suspended/closed records are
  // greyed out as inactive; everything else is judged purely on money owed.
  const status = (record.status ?? "").toLowerCase();
  if (status === "suspended" || status === "closed") return "inactive";
  const balance = Number(record.outstandingBalance ?? 0);
  if (Number.isFinite(balance) && balance > 0) return "outstanding";
  return "paid";
}

export function colorForHealth(h: RecordHealth): string {
  return HEALTH_COLORS[h];
}

/* ── Percentage helpers ───────────────────────────────────────────── */

/**
 * Largest-remainder method: turn a set of values into integer percentages
 * that ALWAYS sum to exactly 100. Naive Math.round() gives 99 or 101 when
 * floating-point shares are split across many buckets.
 */
export function percentagesOf100(values: number[]): number[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((v) => (Math.max(0, v) / total) * 100);
  const floors = exact.map((x) => Math.floor(x));
  let remainder = 100 - floors.reduce((s, v) => s + v, 0);
  // Distribute the leftover units to whichever entries had the largest
  // fractional remainder, biggest first.
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors;
}

/** Clamp a 0..∞ percentage for display so charts/donuts don't overflow. */
export function clampPercent(p: number, max = 100): number {
  if (!Number.isFinite(p) || p < 0) return 0;
  return Math.min(max, p);
}

/* ── CSV export helper ─────────────────────────────────────────────── */

export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
