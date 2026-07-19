# Revenue Management API

Backend for the Local Government Revenue Management System.  
Built with **Fastify**, **postgres.js**, **PostGIS**, and **ArcGIS REST API**.

---

## Prerequisites

- Node.js ≥ 20
- PostgreSQL ≥ 14 with **PostGIS** extension
- pnpm (`npm install -g pnpm`)

---

## Quick Start

```bash
# 1. Clone / unzip and enter the project
cd revenue-api

# 2. Install dependencies
pnpm install

# 3. Copy environment config
cp .env.example .env
# Edit .env with your database URL, JWT secret, and ArcGIS credentials

# 4. Run database migrations (creates all tables + seed data)
pnpm migrate

# 5. Start the development server
pnpm dev
```

API docs available at: http://localhost:3000/docs  
Health check: http://localhost:3000/health

---

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (must have PostGIS installed) |
| `JWT_SECRET` | Secret key for signing JWT tokens — use a long random string |
| `JWT_EXPIRES_IN` | Token expiry, e.g. `8h` |
| `PORT` | Server port (default: 3000) |
| `ARCGIS_BASE_URL` | ArcGIS Online or Enterprise base URL |
| `ARCGIS_CLIENT_ID` | Your ArcGIS OAuth2 app client ID |
| `ARCGIS_CLIENT_SECRET` | Your ArcGIS OAuth2 app client secret |
| `ARCGIS_PARCEL_LAYER_ID` | Feature layer ID for parcels |
| `ARCGIS_BUSINESS_LAYER_ID` | Feature layer ID for businesses |
| `ARCGIS_MARKET_STALL_LAYER_ID` | Feature layer ID for market stalls |
| `ARCGIS_SYNC_INTERVAL_MINUTES` | How often to pull from ArcGIS (default: 15) |
| `COUNTY_NAME` | Your county name, appears on demand notice PDFs |

---

## API Routes

### Auth
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | Public | Login, returns JWT token |
| GET | `/api/auth/me` | Any | Get current user profile |
| POST | `/api/auth/change-password` | Any | Change password |

### Records (Taxpayers)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/records` | Any | List records (officers see own zone) |
| GET | `/api/records/:id` | Any | Full record detail with fees, notices, payments |
| POST | `/api/records` | Any | Create new record |
| PATCH | `/api/records/:id` | Any | Update record |
| GET | `/api/records/types/list` | Any | List record types |

### Fees
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/fees/schedules` | Any | List fee schedules |
| POST | `/api/fees/schedules` | FM/Admin | Create fee schedule |
| POST | `/api/fees/assign` | FM/Admin | Assign fee to a record |
| POST | `/api/fees/assign/bulk` | FM/Admin | Bulk assign fees by zone |
| PATCH | `/api/fees/assign/:id/waive` | FM/Admin | Waive a fee assignment |

### Notices
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/notices` | Any | List notices |
| POST | `/api/notices/generate` | FM/Admin | Generate notice for one record |
| POST | `/api/notices/bulk` | FM/Admin | Bulk generate notices for a zone |
| GET | `/api/notices/:id/pdf` | Any | Download notice PDF |
| PATCH | `/api/notices/:id/status` | FM/Admin | Update notice status |

### Payments
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/payments` | Any | List payments |
| POST | `/api/payments` | Any | Record a payment |
| GET | `/api/payments/:id` | Any | Get payment receipt |

### Dashboard
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/dashboard` | Any | KPIs, collection trends, zone breakdown |
| GET | `/api/dashboard/sync-status` | FM/Admin | ArcGIS sync status |

### Admin
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/admin/users` | Admin | List users |
| POST | `/api/admin/users` | Admin | Create user |
| PATCH | `/api/admin/users/:id` | Admin | Update user |
| GET | `/api/admin/arcgis` | Admin | Get ArcGIS config |
| PUT | `/api/admin/arcgis` | Admin | Save ArcGIS config |
| GET | `/api/admin/audit-log` | FM/Admin | View audit trail |

### Zones
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/zones` | Any | List all zones |
| POST | `/api/zones` | Admin | Create zone |

---

## Roles

| Role | Access |
|---|---|
| `admin` | Full access to all routes |
| `finance_manager` | All routes except user management |
| `officer` | Can create/view records in own zone; cannot manage fees/notices |

---

## Default Login

After running `pnpm migrate`:

- **Email:** `admin@revenue.local`  
- **Password:** `Admin@1234`

**Change this immediately in production.**

---

## ArcGIS Sync

The sync service runs automatically on startup (after 10 seconds) then every 15 minutes (configurable via `ARCGIS_SYNC_INTERVAL_MINUTES`).

To configure ArcGIS:
1. Log in as admin
2. `PUT /api/admin/arcgis` with your client credentials and layer IDs
3. The sync will pick up the new config on its next run

**Field name mapping:** Edit `src/services/arcgis-sync.js` → `mapFeatureToRecord()` to match your Survey123 form field names.

---

## Project Structure

```
revenue-api/
├── src/
│   ├── app.js              # Fastify instance + plugins + routes
│   ├── server.js           # Entry point
│   ├── db.js               # postgres.js connection
│   ├── routes/
│   │   ├── auth.js
│   │   ├── records.js
│   │   ├── fees.js
│   │   ├── notices.js
│   │   ├── payments.js
│   │   ├── dashboard.js
│   │   ├── admin.js
│   │   └── zones.js
│   ├── services/
│   │   ├── arcgis-sync.js  # ArcGIS REST pull + upsert
│   │   └── pdf.js          # Demand notice PDF generation
│   ├── workers/
│   │   └── boss.js         # pg-boss job queue
│   └── plugins/
│       └── auth.js         # JWT + role guard
├── migrations/
│   ├── 001_schema.sql
│   └── run.js
├── .env.example
├── package.json
└── README.md
```
