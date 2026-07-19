"use client";

export interface ArcGISUser {
  username: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  description?: string;
  thumbnailUrl?: string;
  role: string;
  roleLabel: string;
  userType?: string;
  userTypeLabel?: string;
  orgName?: string;
  orgUrl?: string;
  privileges?: string[];
  groups?: { id: string; title: string; thumbnailUrl?: string }[];
  /** epoch ms */
  created?: number;
  /** epoch ms */
  modified?: number;
  /** epoch ms */
  lastLogin?: number;
  mfaEnabled?: boolean;
  /** bytes */
  storageUsage?: number;
  /** bytes */
  storageQuota?: number;
  region?: string;
  culture?: string;
  units?: string;
  provider?: string;
  tags?: string[];
  access?: string;
  preferredView?: string;
}

const ROLE_LABELS: Record<string, string> = {
  org_admin: "Administrator",
  org_publisher: "Publisher",
  org_user: "User",
  org_viewer: "Viewer",
  account_admin: "Administrator",
  account_publisher: "Publisher",
  account_user: "User",
};

const USER_TYPE_LABELS: Record<string, string> = {
  creatorUT: "Creator",
  viewerUT: "Viewer",
  publisherUT: "Publisher",
  gisProfessionalBasicUT: "GIS Professional Basic",
  gisProfessionalStdUT: "GIS Professional Standard",
  gisProfessionalAdvUT: "GIS Professional Advanced",
  fieldWorkerUT: "Field Worker",
  storyTellerUT: "Storyteller",
  insightsAnalystUT: "Insights Analyst",
  surveyorUT: "Surveyor",
  contributorUT: "Contributor",
  liteUT: "Lite",
};

function labelForRole(role?: string): string {
  if (!role) return "User";
  return ROLE_LABELS[role] ?? role.replace(/^org_/, "").replace(/^./, (c) => c.toUpperCase());
}

function labelForUserType(t?: string): string | undefined {
  if (!t) return undefined;
  return USER_TYPE_LABELS[t] ?? t.replace(/UT$/, "");
}

export const PORTAL_URL =
  process.env.NEXT_PUBLIC_ARCGIS_PORTAL_URL?.replace(/\/+$/, "") ||
  "https://www.arcgis.com";
export const APP_ID = process.env.NEXT_PUBLIC_ARCGIS_APP_ID || "";
export const API_KEY = process.env.NEXT_PUBLIC_ARCGIS_API_KEY || "";

const REQUIRE_TIMEOUT_MS = 15000;
const TOKEN_STORAGE_KEY = "georevenue.arcgis.token";
const SHARING_REST = `${PORTAL_URL}/sharing/rest`;

interface StoredToken {
  server: string;
  token: string;
  expires: number; // epoch ms
  userId: string;
}

interface RegisteredTokenSpec {
  server: string;
  token: string;
  expires: number;
  userId?: string;
  ssl?: boolean;
}

interface ArcgisCredential {
  token?: string;
  userId?: string;
  expires?: number;
}

interface EsriModules {
  esriConfig: { apiKey?: string };
  IdentityManager: {
    registerOAuthInfos: (infos: unknown[]) => void;
    registerToken: (spec: RegisteredTokenSpec) => void;
    checkSignInStatus: (url: string) => Promise<unknown>;
    getCredential: (url: string) => Promise<ArcgisCredential>;
    findCredential: (url: string) => ArcgisCredential | null | undefined;
    destroyCredentials: () => void;
  };
  OAuthInfo: new (props: Record<string, unknown>) => unknown;
  Portal: new (props: { url?: string }) => {
    load: () => Promise<void>;
    name?: string;
    url?: string;
    portalProperties?: { homePage?: { id?: string } };
    user: PortalUser;
  };
}

interface PortalUser {
  username: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  description?: string;
  thumbnail?: string;
  thumbnailUrl?: string;
  role?: string;
  userType?: string;
  privileges?: string[];
  created?: Date | number;
  modified?: Date | number;
  lastLogin?: Date | number;
  mfaEnabled?: boolean;
  storageUsage?: number;
  storageQuota?: number;
  region?: string;
  culture?: string;
  units?: string;
  provider?: string;
  tags?: string[];
  access?: string;
  preferredView?: string;
  fetchGroups?: () => Promise<
    { id: string; title: string; thumbnailUrl?: string }[]
  >;
}

let modulesPromise: Promise<EsriModules> | null = null;

function loadModules(): Promise<EsriModules> {
  if (modulesPromise) return modulesPromise;
  modulesPromise = new Promise<EsriModules>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("ArcGIS auth can only run in the browser"));
      return;
    }
    const start = Date.now();
    const tick = () => {
      if (window.require) {
        window.require(
          [
            "esri/config",
            "esri/identity/IdentityManager",
            "esri/identity/OAuthInfo",
            "esri/portal/Portal",
          ],
          (...args: unknown[]) => {
            const [esriConfig, IdentityManager, OAuthInfo, Portal] = args as [
              EsriModules["esriConfig"],
              EsriModules["IdentityManager"],
              EsriModules["OAuthInfo"],
              EsriModules["Portal"],
            ];

            if (API_KEY) esriConfig.apiKey = API_KEY;

            // Optional OAuth registration — kept available as a fallback for
            // SSO / 2FA accounts that can't use generateToken.
            if (APP_ID) {
              const info = new OAuthInfo({
                appId: APP_ID,
                popup: false,
                portalUrl: PORTAL_URL,
                flowType: "authorization-code",
              });
              IdentityManager.registerOAuthInfos([info]);
            }

            resolve({ esriConfig, IdentityManager, OAuthInfo, Portal });
          },
          (err) => reject(err),
        );
      } else if (Date.now() - start > REQUIRE_TIMEOUT_MS) {
        reject(new Error("Timed out waiting for ArcGIS Maps SDK to load"));
      } else {
        window.setTimeout(tick, 80);
      }
    };
    tick();
  });
  return modulesPromise;
}

function toEpoch(value: Date | number | undefined): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "number") return value;
  return value.getTime();
}

async function loadUser(Portal: EsriModules["Portal"]): Promise<ArcGISUser> {
  const portal = new Portal({ url: PORTAL_URL });
  await portal.load();
  const u = portal.user;

  const thumbnail = u.thumbnail || u.thumbnailUrl;
  const thumbnailUrl = thumbnail
    ? `${PORTAL_URL}/sharing/rest/community/users/${encodeURIComponent(u.username)}/info/${thumbnail}`
    : undefined;

  let groups: { id: string; title: string; thumbnailUrl?: string }[] | undefined;
  if (typeof u.fetchGroups === "function") {
    try {
      const fetched = await u.fetchGroups();
      groups = fetched
        .filter((g) => g && g.id)
        .map((g) => ({
          id: g.id,
          title: g.title,
          thumbnailUrl: g.thumbnailUrl,
        }));
    } catch {
      /* ignore */
    }
  }

  const role = u.role ?? "org_user";
  return {
    username: u.username,
    fullName: u.fullName?.trim() || u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    description: u.description,
    thumbnailUrl,
    role,
    roleLabel: labelForRole(role),
    userType: u.userType,
    userTypeLabel: labelForUserType(u.userType),
    orgName: portal.name,
    orgUrl: portal.url,
    privileges: u.privileges,
    groups,
    created: toEpoch(u.created),
    modified: toEpoch(u.modified),
    lastLogin: toEpoch(u.lastLogin),
    mfaEnabled: u.mfaEnabled,
    storageUsage: u.storageUsage,
    storageQuota: u.storageQuota,
    region: u.region,
    culture: u.culture,
    units: u.units,
    provider: u.provider,
    tags: u.tags,
    access: u.access,
    preferredView: u.preferredView,
  };
}

function readStoredToken(): StoredToken | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredToken;
    if (!parsed.token || !parsed.expires || parsed.expires < Date.now() + 30_000) {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveStoredToken(t: StoredToken) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(t));
}

function clearStoredToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

interface GenerateTokenResponse {
  token?: string;
  expires?: number;
  ssl?: boolean;
  error?: { code: number; message: string; details?: string[] };
}

/**
 * Direct username/password sign-in via the ArcGIS portal token service.
 * Works for ArcGIS Online & Enterprise built-in accounts. Will fail for
 * accounts that require SSO / SAML / multi-factor — those need the OAuth flow.
 */
export async function signInWithPassword(
  username: string,
  password: string,
): Promise<ArcGISUser> {
  if (!username.trim() || !password) {
    throw new Error("Enter both your ArcGIS username and password.");
  }
  if (typeof window === "undefined") {
    throw new Error("Sign-in must run in the browser.");
  }

  const referer = window.location.origin;
  const expirationMinutes = 60 * 8; // 8 hours

  const body = new URLSearchParams({
    username: username.trim(),
    password,
    referer,
    expiration: String(expirationMinutes),
    client: "referer",
    f: "json",
  });

  const res = await fetch(`${SHARING_REST}/generateToken`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  let data: GenerateTokenResponse;
  try {
    data = (await res.json()) as GenerateTokenResponse;
  } catch {
    throw new Error("Could not reach the ArcGIS portal. Check your network.");
  }

  if (data.error) {
    const detail = data.error.details?.[0] ?? data.error.message;
    if (/invalid username or password/i.test(detail)) {
      throw new Error("Invalid username or password.");
    }
    if (/locked/i.test(detail)) {
      throw new Error("This account is temporarily locked. Try again in a few minutes.");
    }
    throw new Error(detail || "Sign-in failed.");
  }
  if (!data.token || !data.expires) {
    throw new Error("Sign-in failed: portal did not return a token.");
  }

  const stored: StoredToken = {
    server: SHARING_REST,
    token: data.token,
    expires: data.expires,
    userId: username.trim(),
  };
  saveStoredToken(stored);

  const { IdentityManager, Portal } = await loadModules();
  IdentityManager.registerToken({
    server: stored.server,
    token: stored.token,
    expires: stored.expires,
    userId: stored.userId,
    ssl: true,
  });

  return loadUser(Portal);
}

/**
 * Restore a session: prefer a stored token (password flow), fall back to
 * an OAuth credential if one is registered.
 */
export async function checkAuth(): Promise<ArcGISUser | null> {
  const stored = readStoredToken();
  if (stored) {
    try {
      const { IdentityManager, Portal } = await loadModules();
      IdentityManager.registerToken({
        server: stored.server,
        token: stored.token,
        expires: stored.expires,
        userId: stored.userId,
        ssl: true,
      });
      return await loadUser(Portal);
    } catch {
      clearStoredToken();
    }
  }

  if (APP_ID) {
    try {
      const { IdentityManager, Portal } = await loadModules();
      await IdentityManager.checkSignInStatus(`${PORTAL_URL}/sharing`);
      return await loadUser(Portal);
    } catch {
      /* not signed in via OAuth either */
    }
  }

  return null;
}

/** OAuth fallback — only used if the user explicitly clicks "Use SSO instead". */
export async function signInWithOAuth(): Promise<ArcGISUser> {
  if (!APP_ID) {
    throw new Error(
      "OAuth sign-in is not configured. Add NEXT_PUBLIC_ARCGIS_APP_ID to .env.local.",
    );
  }
  const { IdentityManager, Portal } = await loadModules();
  await IdentityManager.getCredential(`${PORTAL_URL}/sharing`);
  return loadUser(Portal);
}

/**
 * Returns the ArcGIS portal token for the current session, regardless of
 * whether the user signed in with password or OAuth. The backend bridge
 * accepts this token and exchanges it for a backend JWT.
 */
export async function getCurrentArcgisToken(): Promise<string | null> {
  const stored = readStoredToken();
  if (stored?.token) return stored.token;
  try {
    const { IdentityManager } = await loadModules();
    const cred = IdentityManager.findCredential(`${PORTAL_URL}/sharing`);
    return cred?.token ?? null;
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  clearStoredToken();
  try {
    const { IdentityManager } = await loadModules();
    IdentityManager.destroyCredentials();
  } catch {
    /* noop */
  }
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}

export const isOAuthConfigured = () => Boolean(APP_ID);

export async function ensureEsriReady(): Promise<void> {
  await loadModules();
}

/**
 * True when the SDK can request premium services (Basemap Styles, geocoding…)
 * — either via an API key or via a registered token / OAuth credential.
 */
export async function hasPremiumAccess(): Promise<boolean> {
  if (API_KEY) return true;
  if (readStoredToken()) return true;
  try {
    const { IdentityManager } = await loadModules();
    return Boolean(IdentityManager.findCredential(`${PORTAL_URL}/sharing`));
  } catch {
    return false;
  }
}
