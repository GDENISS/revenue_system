# GeoRevenue Spatial OS — frontend

Next.js 16 + React 19 dashboard for the **revenue-api** backend.
Authentication is **ArcGIS-only** — every user signs in with their ArcGIS Online / Enterprise account.

## Sign-in flow

```
[ArcGIS username + password]
        │
        ▼
ArcGIS portal `/sharing/rest/generateToken`     ← (or OAuth redirect for SSO accounts)
        │ portal token
        ▼
Backend `POST /api/auth/arcgis-bridge`          ← validates token + auto-provisions a local user row
        │ backend JWT
        ▼
Stored in localStorage as `rev.jwt`
Used as Bearer for every subsequent /api/* call
```

First-time sign-in for a given ArcGIS username:

- If the local `users` table is empty → user is provisioned as **admin**.
- Else if the username is listed in the backend's `ARCGIS_ADMIN_USERNAMES` env var → **admin**.
- Otherwise → **officer** (an admin can promote them in Settings → Users).

The bridge keys on `arcgis_username` first, then on `email` (so a user already seeded by email gets their ArcGIS account linked on first sign-in instead of duplicated).

## Features wired to the backend

| Page | Endpoint(s) | Notes |
|---|---|---|
| Login | `POST /api/auth/arcgis-bridge` | ArcGIS portal token → backend JWT, stored in `localStorage` |
| Auth restore | `GET /api/auth/me` | Validates the JWT on every reload |
| Dashboard | `GET /api/dashboard` | KPIs, monthly trend, by-zone table, by-type donut, recent activity |
| Map workspace | `GET /api/records`, `GET /api/records/types/list` | Live pins for records with coordinates, layer toggles per record type, search by taxpayer name, click row to open record |
| Record detail | `GET /api/records/:id` | Tabs: Summary / Map / Fees / Payments / Notices |
| Record payment modal | `POST /api/payments` | M-Pesa / bank / cash / cheque, auto-receipt |
| Notice PDF download | `GET /api/notices/:id/pdf` | Streamed via authenticated fetch |
| Bulk notices | `POST /api/notices/bulk`, `GET /api/notices`, `GET /api/zones` | Pick zone + record type + billing year + due date, generate, refresh queue |
| Settings → Profile | `GET /api/auth/me` | Real user identity (admin / finance_manager / officer) |
| Settings → Security | local | JWT + role summary |
| Settings → ArcGIS | `GET/PUT /api/admin/arcgis`, `GET /api/dashboard/sync-status` | Edit portal URL, OAuth creds, layer IDs, sync interval |
| Settings → Fee schedules | `GET /api/fees/schedules` | Read-only list with effective dates |
| Settings → Users | `GET /api/admin/users` | Directory with role + zone + last login |
| Settings → Audit log | `GET /api/admin/audit-log` | Latest 100 audit events |

The Settings tabs auto-hide based on the signed-in user's role (officers see only Profile + Security; finance managers see those plus Fee schedules and Audit log; admins see everything).

## Quick start (full local stack)

You need **two** processes running:

### 1. Backend (`revenue-api`)

```powershell
# In D:\localG\revenue-api\revenue-api-fixed
pnpm install
# Copy .env from .env.example and fill in:
#   DATABASE_URL, JWT_SECRET
#   ARCGIS_BASE_URL              (e.g. https://www.arcgis.com)
#   ARCGIS_ADMIN_USERNAMES       (comma-separated; auto-promotes these to admin on first sign-in)
psql -U postgres -c "CREATE DATABASE Revenue"
pnpm migrate    # applies 001_schema.sql + 002_arcgis_auth.sql
pnpm dev        # listens on :8080, docs at http://localhost:8080/docs
```

`ARCGIS_ADMIN_USERNAMES` is the bootstrap path: list your own ArcGIS username there so the very first sign-in you do is provisioned as admin. Once at least one admin exists, others come in as officers and get promoted via Settings → Users.

### 2. Frontend (this folder)

```powershell
pnpm install
cp .env.example .env.local
# At minimum set:
#   NEXT_PUBLIC_API_URL=http://localhost:8080
#   NEXT_PUBLIC_ARCGIS_PORTAL_URL=https://www.arcgis.com   (or your enterprise portal)
pnpm dev   # listens on :3000
```

Open http://localhost:3000 and sign in with your **ArcGIS Online / Enterprise username and password**. The first time a username signs in, the backend auto-provisions a row in the local `users` table and issues a JWT. From then on it's a normal session — the dashboard, map, records, notices and settings populate from the database.

## CORS

The backend reads `ALLOWED_ORIGINS` from its `.env`. For development, leave it unset (allows all origins) or set:

```
ALLOWED_ORIGINS=http://localhost:3000
```

## Stack

| Layer         | Technology                                             |
| ------------- | ------------------------------------------------------ |
| Backend       | Fastify 4 + Postgres + PostGIS + pg-boss + Puppeteer   |
| Frontend      | Next.js 16 (App Router, Turbopack) + React 19          |
| Auth          | JWT bearer (8-hour rolling)                            |
| Mapping       | ArcGIS Maps SDK 4.32 (CDN)                             |
| Design system | Esri Calcite Components 2.13 (CDN)                     |
| Styling       | Tailwind CSS v4 + custom design tokens                 |
| Icons         | lucide-react                                           |

## What's still mocked or skipped

These show "no data yet" states gracefully against a fresh database, but won't appear unless you seed the corresponding tables (or wait for the ArcGIS sync to ingest):

- **Field officer dashboard** — uses a mock layout; not yet pointed at `/api/payments?recordedBy=<userId>` or zone-scoped record lists. Easy to wire in next pass.
- **CSV export** — header button is decorative; the backend doesn't yet expose `/api/exports/billing-register`.
- **Mobile money (M-Pesa, MTN MoMo, Airtel, Tigo)** — payment recording works manually; STK push & callback handlers not implemented.
- **Survey123 ingestion** — backend has the sync skeleton in `services/arcgis-sync.js` running in mock mode (`ARCGIS_MOCK_MODE=true`). Flip to false and fill in layer IDs in `arcgis_config` (via Settings → ArcGIS) to start pulling real submissions.

## Project layout

```
src/
  app/
    components/
      ArcGISMap.tsx     ← Esri MapView wrapper (theme-aware)
      LoginScreen.tsx   ← email + password form
    lib/
      api.ts            ← typed fetch wrapper for the Fastify backend
      arcgis-auth.ts    ← (legacy ArcGIS-only auth, no longer used by Shell)
    globals.css         ← design tokens, panels, modals, login styles
    layout.tsx          ← injects ArcGIS + Calcite CDN assets
    page.tsx            ← client-only dynamic loader for Shell
    Shell.tsx           ← AuthGate + every dashboard view, wired to /api/*
  types/
    arcgis.d.ts         ← TypeScript shims for window.require + Calcite tags
```
