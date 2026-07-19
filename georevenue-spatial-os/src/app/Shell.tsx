"use client";

import { useEffect, useMemo, useState } from "react";
import { LogOut, Moon, Sun } from "lucide-react";

import { LoginScreen } from "./components/LoginScreen";
import {
  api,
  loadStoredToken,
  onSessionChange,
  setToken,
  type BackendUser,
} from "./lib/api";
import { signOut as arcgisSignOut } from "./lib/arcgis-auth";
import {
  COUNTY_BRAND,
  CountyCrest,
  Loader,
  type Theme,
  type View,
  initialsOf,
  navItems,
  roleLabelOf,
} from "./lib/shared";
import { FinanceDashboard } from "./views/finance";
import { MapWorkspace } from "./views/map";
import { RecordDetail } from "./views/record";
import { BulkNotices } from "./views/notices";
import { PaymentsPage } from "./views/payments";
import { OfficerDashboard } from "./views/officer";
import {
  SettingsArcGIS,
  SettingsAudit,
  SettingsProfile,
  SettingsSecurity,
  SettingsUsers,
  SettingsZones,
} from "./views/settings";
import { FeesPage } from "./views/fees";

/* ── Settings sub-tabs ────────────────────────────────────────────── */

type SettingsTab =
  | "profile"
  | "arcgis"
  | "zones"
  | "users"
  | "audit"
  | "security";

const settingsTabs: { id: SettingsTab; label: string; minRole?: "admin" | "finance_manager" }[] = [
  { id: "profile", label: "Profile" },
  { id: "arcgis", label: "ArcGIS", minRole: "admin" },
  { id: "zones", label: "Zones", minRole: "admin" },
  { id: "users", label: "Users", minRole: "admin" },
  { id: "audit", label: "Audit log", minRole: "finance_manager" },
  { id: "security", label: "Security" },
];

function canSee(role: BackendUser["role"], minRole?: "admin" | "finance_manager") {
  if (!minRole) return true;
  if (minRole === "admin") return role === "admin";
  return role === "admin" || role === "finance_manager";
}

/**
 * Which top-level views each role may open. The backend already enforces
 * permissions on every endpoint — this just hides what the user can't use.
 */
const VIEW_ROLES: Record<View, BackendUser["role"][]> = {
  finance: ["admin", "finance_manager"],
  map: ["admin", "finance_manager", "officer", "gis_officer"],
  record: ["admin", "finance_manager", "officer", "gis_officer"],
  bulk: ["admin", "finance_manager"],
  payments: ["admin", "finance_manager"],
  fees: ["admin", "finance_manager"],
  officer: ["admin", "officer", "gis_officer"],
  config: ["admin", "finance_manager", "officer", "gis_officer"], // Profile + Security are universal
};

function allowedViews(role: BackendUser["role"]): View[] {
  return (Object.keys(VIEW_ROLES) as View[]).filter((v) => VIEW_ROLES[v].includes(role));
}

/** Navigation state carried in the URL (?view=…&record=…). Set by the
 * Paystack callback flow so a full-page round trip through the hosted
 * checkout drops the user back on the exact page they paid from. The
 * role-bounce effect still corrects views the user's role can't open. */
function navFromUrl(): { view: View | null; recordId: number | null } {
  if (typeof window === "undefined") return { view: null, recordId: null };
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  const record = Number(params.get("record"));
  return {
    view: view && view in VIEW_ROLES ? (view as View) : null,
    recordId: Number.isInteger(record) && record > 0 ? record : null,
  };
}

function defaultViewFor(role: BackendUser["role"]): View {
  // Sensible landing page per role
  if (role === "officer") return "officer";
  if (role === "gis_officer") return "map"; // spatial-first landing for GIS staff
  return "finance";
}

/* ── Shell ────────────────────────────────────────────────────────── */

function Shell() {
  const [user, setUser] = useState<BackendUser | null>(null);
  const [view, setView] = useState<View>(() => navFromUrl().view ?? "finance");
  const [theme, setTheme] = useState<Theme>("light");
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(
    () => navFromUrl().recordId,
  );
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("profile");
  // "Link this taxpayer to a parcel" mode — set from Records/RecordDetail,
  // consumed by MapWorkspace which switches feature-clicks to PATCH the link.
  const [pendingLink, setPendingLink] = useState<{
    recordId: number;
    recordName: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  // Send users to a sensible landing view based on their role, and bounce
  // anyone who lands on a view their role doesn't include.
  useEffect(() => {
    if (!user) return;
    if (!VIEW_ROLES[view].includes(user.role)) {
      setView(defaultViewFor(user.role));
    }
  }, [user, view]);

  const loadUser = () => {
    const token = loadStoredToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    api.auth
      .me()
      .then(setUser)
      .catch(() => {
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadUser();
    return onSessionChange((token) => {
      if (!token) {
        setUser(null);
        setLoading(false);
      } else {
        loadUser();
      }
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // Calcite web components ignore data-theme — they read their own mode
    // classes. Without these, calcite-notice popups etc. stay white in dark.
    document.documentElement.classList.toggle("calcite-mode-dark", theme === "dark");
    document.documentElement.classList.toggle("calcite-mode-light", theme === "light");
    // Swap the ArcGIS widget stylesheet (basemap gallery, attribution) to the
    // matching Esri theme. Version-agnostic: rewrite the themes/ segment only.
    const esriCss = document.getElementById("esri-theme-css") as HTMLLinkElement | null;
    if (esriCss) {
      esriCss.href = esriCss.href.replace(
        /themes\/(light|dark)\//,
        `themes/${theme === "dark" ? "dark" : "light"}/`,
      );
    }
  }, [theme]);

  const firstName = useMemo(
    () => user?.name?.trim().split(/\s+/)[0] || "there",
    [user?.name],
  );

  const openRecord = (id: number) => {
    setSelectedRecordId(id);
    setView("record");
  };

  /** Top-level navigation. Clicking "Records" always returns to the list, so
   * a stale `selectedRecordId` (e.g. after a data reset) never leaves the
   * user stuck on a record-not-found page. */
  const navigateTo = (target: View) => {
    if (target === "record") setSelectedRecordId(null);
    setView(target);
  };

  /** Start "link this record to a parcel" flow — switches to Map view. */
  const startParcelLink = (recordId: number, recordName: string) => {
    setPendingLink({ recordId, recordName });
    setView("map");
  };

  const handleSignOut = async () => {
    setToken(null);
    setUser(null);
    await arcgisSignOut().catch(() => undefined);
  };

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--background)] text-[var(--on-surface)]">
        <div className="flex flex-col items-center gap-5">
          <div className="flex items-center gap-2.5">
            <CountyCrest size={30} />
            <span className="text-[15px] font-semibold tracking-tight">
              {COUNTY_BRAND.name}
            </span>
          </div>
          <Loader label="Loading GeoRevenue OS…" scale="l" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onAuthenticated={loadUser} />;
  }

  const content =
    view === "finance" ? (
      <FinanceDashboard firstName={firstName} onNavigate={setView} />
    ) : view === "map" ? (
      <MapWorkspace
        onOpenRecord={openRecord}
        pendingLink={pendingLink}
        onClearPendingLink={() => setPendingLink(null)}
      />
    ) : view === "record" ? (
      <RecordDetail
        recordId={selectedRecordId}
        onNavigate={setView}
        onOpenRecord={openRecord}
        onCloseRecord={() => setSelectedRecordId(null)}
        onStartParcelLink={startParcelLink}
      />
    ) : view === "bulk" ? (
      <BulkNotices onOpenRecord={openRecord} />
    ) : view === "payments" ? (
      <PaymentsPage onOpenRecord={openRecord} />
    ) : view === "fees" ? (
      <FeesPage />
    ) : view === "officer" ? (
      <OfficerDashboard onNavigate={setView} onOpenRecord={openRecord} role={user.role} />
    ) : (
      <SettingsHub
        user={user}
        tab={settingsTab}
        onTabChange={setSettingsTab}
      />
    );

  return (
    <div className="app-shell flex min-h-screen bg-[var(--background)] text-[var(--on-surface)]">
      <Sidebar
        view={view}
        theme={theme}
        user={user}
        allowed={allowedViews(user.role)}
        onNavigate={navigateTo}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        onSignOut={handleSignOut}
      />

      <main className="min-w-0 flex-1 p-3 sm:p-4 2xl:p-6">
        <div className="mx-auto flex max-w-[1920px] flex-col gap-3 2xl:gap-4">
          <TopBar view={view} firstName={firstName} />
          <MobileNav view={view} allowed={allowedViews(user.role)} onNavigate={navigateTo} />
          {content}
        </div>
      </main>
    </div>
  );
}

/* ── Sidebar (hover-expand) ───────────────────────────────────────── */

function Sidebar({
  view,
  theme,
  user,
  allowed,
  onNavigate,
  onToggleTheme,
  onSignOut,
}: {
  view: View;
  theme: Theme;
  user: BackendUser;
  allowed: View[];
  onNavigate: (v: View) => void;
  onToggleTheme: () => void;
  onSignOut: () => void;
}) {
  const visibleNav = navItems.filter((item) => allowed.includes(item.id));
  const role = roleLabelOf(user.role);
  const initials = initialsOf(user);
  const zone = user.zoneName ?? COUNTY_BRAND.name;
  // Role-specific accent so admin / finance / officer / GIS avatars feel distinct.
  const accent =
    user.role === "admin"
      ? { bg: "var(--primary)", text: "#fff" }
      : user.role === "finance_manager"
        ? { bg: "var(--tertiary)", text: "#0a2540" }
        : user.role === "gis_officer"
          ? { bg: "var(--color-primary-dark)", text: "#fff" }
          : { bg: "var(--success)", text: "#063b2a" };

  return (
    <aside
      className="sidebar-rail group/sidebar sticky top-0 hidden h-screen shrink-0 flex-col border-r border-[var(--line)] py-3 md:flex"
      data-collapsed="true"
    >
      <div className="mb-4 flex items-center gap-2 px-3">
        <CountyCrest size={24} />
        <div className="sidebar-label">
          <p className="text-[13px] font-semibold leading-tight">{COUNTY_BRAND.name}</p>
          <p className="label">GeoRevenue OS</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-2">
        {visibleNav.map((item) => {
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`nav-rail ${active ? "nav-rail-active" : ""}`}
              aria-label={item.label}
              title={item.label}
            >
              <item.Icon className="h-4 w-4 shrink-0" strokeWidth={2.2} />
              <span className="sidebar-label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-2 space-y-1 border-t border-[var(--line)] px-2 pt-3">
        {/* Signed-in user — avatar collapses with the rail, expands to show
            name + role + zone next to it. Tooltip mirrors the same info so
            the identity is reachable even in the collapsed state. */}
        <div
          className="flex items-center gap-2.5 rounded-md px-2 py-1.5"
          title={`${user.name} · ${role} · ${zone}`}
        >
          <span
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[10.5px] font-semibold tracking-wide"
            style={{ background: accent.bg, color: accent.text }}
            aria-hidden="true"
          >
            {initials}
          </span>
          <span className="sidebar-label min-w-0">
            <span className="block truncate text-[12px] font-semibold leading-tight text-[var(--on-surface)]">
              {user.name}
            </span>
            <span className="block truncate text-[10.5px] leading-tight text-[var(--muted)]">
              {role} · {zone}
            </span>
          </span>
        </div>
        <button
          type="button"
          className="nav-rail"
          onClick={onToggleTheme}
          aria-label="Toggle theme"
          title={theme === "dark" ? "Light mode" : "Dark mode"}
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4 shrink-0" strokeWidth={2.2} />
          ) : (
            <Moon className="h-4 w-4 shrink-0" strokeWidth={2.2} />
          )}
          <span className="sidebar-label">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>
        <button
          type="button"
          className="nav-rail"
          onClick={onSignOut}
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="h-4 w-4 shrink-0" strokeWidth={2.2} />
          <span className="sidebar-label">Sign out</span>
        </button>
      </div>
    </aside>
  );
}

/* ── Mobile horizontal nav ─────────────────────────────────────────── */

function MobileNav({
  view,
  allowed,
  onNavigate,
}: {
  view: View;
  allowed: View[];
  onNavigate: (v: View) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 md:hidden">
      {navItems
        .filter((item) => allowed.includes(item.id))
        .map((item) => {
        const active = view === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            className={`control shrink-0 ${active ? "text-[var(--primary)]" : ""}`}
          >
            <item.Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── TopBar ────────────────────────────────────────────────────────── */

function TopBar({
  view,
  firstName,
}: {
  view: View;
  firstName: string;
}) {
  const s =
    {
      finance: {
        eyebrow: "Dashboard",
        title: "Revenue overview",
        sub: `Hi ${firstName}, track billed, collected, and outstanding revenue.`,
      },
      map: {
        eyebrow: "Map",
        title: "Spatial coverage",
        sub: "Review records and notice activity across zones.",
      },
      record: {
        eyebrow: "Records",
        title: "Record management",
        sub: "Inspect taxpayer records and their attached notices.",
      },
      bulk: {
        eyebrow: "Notices",
        title: "Demand notice generation",
        sub: "Create single notices or bulk batches from backend-owned billing rules.",
      },
      payments: {
        eyebrow: "Payments",
        title: "Payments & receipts",
        sub: "Monitor payments recorded against notices and records.",
      },
      fees: {
        eyebrow: "Fees",
        title: "Fee schedule & assignments",
        sub: "Define amounts by zone and record type, then bulk-assign them.",
      },
      officer: {
        eyebrow: "Field",
        title: "Officer workspace",
        sub: "Capture taxpayer records and review field assignments.",
      },
      config: {
        eyebrow: "Settings",
        title: "County integration settings",
        sub: "Configure ArcGIS, users, reports, and audits.",
      },
    }[view] ?? { eyebrow: "Dashboard", title: "Revenue overview", sub: "Track revenue activity across the county." };

  return (
    <header className="topbar">
      <p className="topbar-eyebrow">
        <span className="text-[var(--on-surface-secondary)]">{COUNTY_BRAND.name}</span>
        <span aria-hidden="true" className="mx-1.5 text-[var(--outline-variant)]">/</span>
        <span className="text-[var(--primary)]">{s.eyebrow}</span>
      </p>
      <h1 className="topbar-title">{s.title}</h1>
      <p className="topbar-sub">{s.sub}</p>
    </header>
  );
}

/**
 * Small profile pill shown in the top bar — avatar with initials, full
 * name, role + zone. Replaces the generic green status chip so the
 * signed-in user feels named and present rather than a label.
 */
/* ── Settings hub ──────────────────────────────────────────────────── */

function SettingsHub({
  user,
  tab,
  onTabChange,
}: {
  user: BackendUser;
  tab: SettingsTab;
  onTabChange: (t: SettingsTab) => void;
}) {
  const allowed = settingsTabs.filter((t) => canSee(user.role, t.minRole));
  const active = allowed.find((t) => t.id === tab) ?? allowed[0];

  return (
    <div className="flex flex-col gap-3">
      <nav className="flex flex-wrap items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--soft-fill)] p-1">
        {allowed.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTabChange(t.id)}
            className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
              active.id === t.id
                ? "bg-[var(--surface)] text-[var(--primary)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--on-surface)]"
            }`}
            aria-current={active.id === t.id ? "page" : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {active.id === "profile" && <SettingsProfile user={user} />}
      {active.id === "arcgis" && <SettingsArcGIS />}
      {active.id === "zones" && <SettingsZones />}
      {active.id === "users" && <SettingsUsers />}
      {active.id === "audit" && <SettingsAudit />}
      {active.id === "security" && <SettingsSecurity user={user} />}
    </div>
  );
}

export default Shell;
