"use client";

import { useState } from "react";
import { Eye, EyeOff, Globe2, Lock, ShieldCheck } from "lucide-react";
import { api, ApiError, setToken } from "../lib/api";
import { Loader } from "../lib/shared";
import {
  getCurrentArcgisToken,
  isOAuthConfigured,
  PORTAL_URL,
  signInWithOAuth,
  signInWithPassword,
} from "../lib/arcgis-auth";

type Mode = "local" | "arcgis";

export function LoginScreen({
  onAuthenticated,
}: {
  onAuthenticated: () => void;
}) {
  const [mode, setMode] = useState<Mode>("local");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  const portalHost = (() => {
    try {
      return new URL(PORTAL_URL).host;
    } catch {
      return "arcgis.com";
    }
  })();

  // ArcGIS-side sign-in completes by exchanging the portal token for a backend
  // JWT via /api/auth/arcgis-bridge (auto-provisions a local user the first
  // time, role = admin if no users exist, otherwise officer).
  const bridge = async () => {
    const arcgisToken = await getCurrentArcgisToken();
    if (!arcgisToken) {
      throw new Error("Could not obtain an ArcGIS token after sign-in.");
    }
    const { token: jwt } = await api.auth.arcgisBridge(arcgisToken, PORTAL_URL);
    setToken(jwt);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "local") {
        // Local account → backend JWT directly, no ArcGIS round-trip
        const { token } = await api.auth.login(username.trim(), password);
        setToken(token);
      } else {
        await signInWithPassword(username, password);
        await bridge();
      }
      onAuthenticated();
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 0
          ? `Cannot reach the API at ${api.baseUrl}.`
          : err instanceof Error
            ? err.message
            : "Sign-in failed";
      setError(message);
      setLoading(false);
    }
  };

  const handleOAuth = async () => {
    setError(null);
    setOauthLoading(true);
    try {
      await signInWithOAuth();
      await bridge();
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setOauthLoading(false);
    }
  };

  const local = mode === "local";

  return (
    <div className="auth-page grid min-h-screen w-full lg:grid-cols-[1fr_minmax(420px,_46%)]">
      <aside className="auth-brand relative hidden flex-col justify-between overflow-hidden p-10 lg:flex">
        <div className="relative z-10 flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-white/95 text-[var(--primary)] shadow">
            <Globe2 className="h-5 w-5" strokeWidth={2.4} />
          </div>
          <span className="text-[13px] font-semibold tracking-tight text-white">
            GeoRevenue
          </span>
        </div>
        <div className="relative z-10">
          <h1 className="max-w-[400px] text-[28px] font-semibold leading-[1.15] tracking-tight text-white">
            The spatial revenue console
            <br />
            for county finance teams.
          </h1>
        </div>
        <p className="relative z-10 text-[11px] text-white/60">
          Local accounts for officers · ArcGIS sign-in for portal users
          <br />
          Powered by {" "}
          <span className="font-semibold text-[var(--surface-secondary)]">ESRI Eastern Africa</span>{" "}
        </p>
      </aside>

      <section className="flex flex-col justify-center bg-[var(--surface)] px-6 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-[360px]">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-[var(--primary)] text-white">
              <Globe2 className="h-4 w-4" strokeWidth={2.4} />
            </div>
            <span className="text-[13px] font-semibold">GeoRevenue</span>
          </div>

          <h2 className="text-[22px] font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-[12.5px] text-[var(--muted)]">
            {local
              ? "With your GeoRevenue account."
              : "With your ArcGIS account."}
          </p>

          {/* Mode toggle */}
          <div className="mt-5 inline-flex rounded-lg border border-[var(--line)] bg-[var(--soft-fill)] p-1">
            <button
              type="button"
              onClick={() => {
                setMode("local");
                setError(null);
              }}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                local
                  ? "bg-[var(--surface)] text-[var(--primary)] shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--on-surface)]"
              }`}
            >
              <Lock className="h-3.5 w-3.5" strokeWidth={2.2} />
              Local account
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("arcgis");
                setError(null);
              }}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                !local
                  ? "bg-[var(--surface)] text-[var(--primary)] shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--on-surface)]"
              }`}
            >
              <Globe2 className="h-3.5 w-3.5" strokeWidth={2.2} />
              ArcGIS
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <label className="block">
              <span className="auth-label">
                {local ? "Email" : "ArcGIS username"}
              </span>
              <input
                type={local ? "email" : "text"}
                autoComplete={local ? "email" : "username"}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="auth-input"
                placeholder={local ? "admin@revenue.local" : ""}
                required
                autoFocus
              />
            </label>

            <label className="block">
              <span className="auth-label flex items-center justify-between">
                <span>Password</span>
                {!local && (
                  <a
                    href={`${PORTAL_URL}/home/forgot.html`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10.5px] font-semibold normal-case tracking-normal text-[var(--primary)] hover:underline"
                  >
                    Forgot?
                  </a>
                )}
              </span>
              <div className="auth-input-shell">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="auth-input auth-input--bare"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="icon-btn h-8 w-8"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" strokeWidth={2.2} />
                  ) : (
                    <Eye className="h-4 w-4" strokeWidth={2.2} />
                  )}
                </button>
              </div>
            </label>

            <button
              type="submit"
              disabled={loading || oauthLoading}
              className="auth-primary-btn"
            >
              {loading ? (
                <Loader inline scale="s" label="Signing in" />
              ) : (
                <span>Sign in</span>
              )}
            </button>
          </form>

          {!local && isOAuthConfigured() && (
            <>
              <div className="mt-5 flex items-center gap-2 text-[11.5px] text-[var(--muted)]">
                <span className="h-px flex-1 bg-[var(--line)]" />
                <span>or</span>
                <span className="h-px flex-1 bg-[var(--line)]" />
              </div>
              <button
                type="button"
                onClick={handleOAuth}
                disabled={loading || oauthLoading}
                className="auth-secondary-btn mt-3"
              >
                {oauthLoading ? (
                  <Loader inline scale="s" label="Redirecting" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                <span>
                  {oauthLoading ? "Redirecting…" : "Sign in with organization SSO"}
                </span>
              </button>
            </>
          )}

          {error && (
            <div className="mt-4">
              <calcite-notice open icon="exclamation-mark-triangle" kind="danger" scale="s">
                <div slot="title">Sign-in failed</div>
                <div slot="message">{error}</div>
              </calcite-notice>
            </div>
          )}

          <p className="mt-8 text-center text-[11px] text-[var(--muted)]">
            {local ? (
              <>
                Local accounts are managed in{" "}
                <span className="font-semibold text-[var(--on-surface)]">Settings → Users</span>{" "}
                by an admin.
              </>
            ) : (
              <>
                Authenticated against{" "}
                <span className="font-semibold text-[var(--on-surface)]">{portalHost}</span>
                . First-time sign-in auto-provisions your account.
              </>
            )}
          </p>
        </div>
      </section>
    </div>
  );
}

export default LoginScreen;
