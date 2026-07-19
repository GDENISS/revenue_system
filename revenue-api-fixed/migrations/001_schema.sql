-- migrations/001_schema.sql
-- Full schema for Local Government Revenue Management System
-- Run via: pnpm migrate

-- Enable PostGIS (requires PostGIS extension installed on server)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Zones / Hierarchy ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS zone (
  zone_id       SERIAL PRIMARY KEY,
  zone_name     VARCHAR(150) NOT NULL,
  zone_code     VARCHAR(50) UNIQUE NOT NULL,
  parent_zone_id INT REFERENCES zone(zone_id) ON DELETE RESTRICT,
  zone_type     VARCHAR(50) NOT NULL DEFAULT 'ward', -- county | subcounty | ward | village
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Record Types ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS record_type (
  record_type_id  SERIAL PRIMARY KEY,
  type_name       VARCHAR(100) NOT NULL UNIQUE, -- Parcel | Business | Market Stall
  geometry_type   VARCHAR(20) NOT NULL DEFAULT 'point', -- point | polygon
  description     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

-- ── Status lookup ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS status (
  status_id   SERIAL PRIMARY KEY,
  status_name VARCHAR(50) NOT NULL UNIQUE  -- pending | active | suspended | closed
);

-- ── Roles ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role (
  role_id     SERIAL PRIMARY KEY,
  role_name   VARCHAR(50) NOT NULL UNIQUE  -- admin | finance_manager | officer
);

-- ── Users ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  user_id       SERIAL PRIMARY KEY,
  name          VARCHAR(200) NOT NULL,
  email         VARCHAR(200) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role_id       INT NOT NULL REFERENCES role(role_id),
  zone_id       INT REFERENCES zone(zone_id),  -- officer's assigned zone
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Taxpayer Records ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS taxpayer_record (
  record_id        SERIAL PRIMARY KEY,
  record_type_id   INT NOT NULL REFERENCES record_type(record_type_id),
  taxpayer_name    VARCHAR(200) NOT NULL,
  taxpayer_phone   VARCHAR(20),
  taxpayer_email   VARCHAR(200),
  taxpayer_id_no   VARCHAR(50),  -- national ID or business reg number
  zone_id          INT NOT NULL REFERENCES zone(zone_id),
  status_id        INT NOT NULL REFERENCES status(status_id) DEFAULT 1,
  -- Spatial
  geom             GEOMETRY(Geometry, 4326),  -- point or polygon
  latitude         NUMERIC(10,7),  -- denormalized for fast non-PostGIS lookups
  longitude        NUMERIC(10,7),
  -- ArcGIS sync
  arcgis_object_id BIGINT UNIQUE,
  sync_batch_id    VARCHAR(100),
  last_synced_at   TIMESTAMPTZ,
  -- Audit
  submitted_by     INT REFERENCES users(user_id),
  submission_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_taxpayer_zone ON taxpayer_record(zone_id);
CREATE INDEX IF NOT EXISTS idx_taxpayer_status ON taxpayer_record(status_id);
CREATE INDEX IF NOT EXISTS idx_taxpayer_arcgis ON taxpayer_record(arcgis_object_id);
CREATE INDEX IF NOT EXISTS idx_taxpayer_geom ON taxpayer_record USING GIST(geom);

-- ── Flexible Attributes ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS record_attributes (
  attribute_id  SERIAL PRIMARY KEY,
  record_id     INT NOT NULL REFERENCES taxpayer_record(record_id) ON DELETE CASCADE,
  attribute_key VARCHAR(100) NOT NULL,
  attribute_val TEXT,
  UNIQUE(record_id, attribute_key)
);

-- ── Fee Schedules ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fee_schedule (
  schedule_id     SERIAL PRIMARY KEY,
  schedule_name   VARCHAR(200) NOT NULL,
  record_type_id  INT NOT NULL REFERENCES record_type(record_type_id),
  zone_id         INT REFERENCES zone(zone_id),  -- NULL = applies to all zones
  amount          NUMERIC(14,2) NOT NULL,
  billing_period  VARCHAR(20) NOT NULL DEFAULT 'annual', -- annual | monthly | once
  effective_from  DATE NOT NULL,
  effective_to    DATE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      INT REFERENCES users(user_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Fee Assignments ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fee_assignment (
  assignment_id  SERIAL PRIMARY KEY,
  record_id      INT NOT NULL REFERENCES taxpayer_record(record_id) ON DELETE CASCADE,
  schedule_id    INT NOT NULL REFERENCES fee_schedule(schedule_id),
  assigned_by    INT NOT NULL REFERENCES users(user_id),
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  billing_year   INT NOT NULL,
  amount_due     NUMERIC(14,2) NOT NULL,  -- snapshot of amount at time of assignment
  due_date       DATE NOT NULL,
  is_waived      BOOLEAN NOT NULL DEFAULT FALSE,
  waived_by      INT REFERENCES users(user_id),
  waived_reason  TEXT
);

CREATE INDEX IF NOT EXISTS idx_fee_assignment_record ON fee_assignment(record_id);
CREATE INDEX IF NOT EXISTS idx_fee_assignment_year ON fee_assignment(billing_year);

-- ── Demand Notices ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS demand_notice (
  notice_id       SERIAL PRIMARY KEY,
  record_id       INT NOT NULL REFERENCES taxpayer_record(record_id),
  assignment_id   INT REFERENCES fee_assignment(assignment_id),
  notice_number   VARCHAR(100) NOT NULL UNIQUE,
  amount_due      NUMERIC(14,2) NOT NULL,
  issued_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date        DATE NOT NULL,
  notice_status   VARCHAR(30) NOT NULL DEFAULT 'issued', -- issued | paid | overdue | cancelled
  pdf_path        TEXT,  -- path / URL to generated PDF
  generated_by    INT NOT NULL REFERENCES users(user_id),
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at         TIMESTAMPTZ,
  sent_via        VARCHAR(30)  -- email | sms | print
);

CREATE INDEX IF NOT EXISTS idx_notice_record ON demand_notice(record_id);
CREATE INDEX IF NOT EXISTS idx_notice_status ON demand_notice(notice_status);

-- ── Payments ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment (
  payment_id       SERIAL PRIMARY KEY,
  notice_id        INT REFERENCES demand_notice(notice_id),
  record_id        INT NOT NULL REFERENCES taxpayer_record(record_id),
  amount_paid      NUMERIC(14,2) NOT NULL,
  payment_method   VARCHAR(30) NOT NULL DEFAULT 'mpesa', -- mpesa | bank | cash | cheque
  mpesa_ref        VARCHAR(100),
  bank_ref         VARCHAR(100),
  payment_date     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  receipt_number   VARCHAR(100) UNIQUE,
  recorded_by      INT NOT NULL REFERENCES users(user_id),
  notes            TEXT
);

CREATE INDEX IF NOT EXISTS idx_payment_record ON payment(record_id);
CREATE INDEX IF NOT EXISTS idx_payment_notice ON payment(notice_id);

-- ── Audit Log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  log_id      BIGSERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(user_id),
  action      VARCHAR(100) NOT NULL,  -- CREATE_RECORD | ASSIGN_FEE | GENERATE_NOTICE | etc.
  table_name  VARCHAR(100),
  record_id   INT,
  old_values  JSONB,
  new_values  JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- ── ArcGIS Config ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arcgis_config (
  config_id              SERIAL PRIMARY KEY,
  base_url               TEXT NOT NULL DEFAULT 'https://www.arcgis.com',
  client_id              TEXT NOT NULL,
  client_secret_enc      TEXT NOT NULL,  -- store encrypted in production
  parcel_layer_id        TEXT,
  business_layer_id      TEXT,
  market_stall_layer_id  TEXT,
  sync_interval_minutes  INT NOT NULL DEFAULT 15,
  last_sync_at           TIMESTAMPTZ,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE
);

-- ── Seed: Statuses ─────────────────────────────────────────────────────────
INSERT INTO status (status_name) VALUES
  ('pending'), ('active'), ('suspended'), ('closed')
ON CONFLICT (status_name) DO NOTHING;

-- ── Seed: Roles ────────────────────────────────────────────────────────────
INSERT INTO role (role_name)
SELECT v.n FROM (VALUES ('admin'),('finance_manager'),('officer')) v(n)
WHERE NOT EXISTS (SELECT 1 FROM role WHERE role_name = v.n);

-- ── Seed: Record Types ─────────────────────────────────────────────────────
INSERT INTO record_type (type_name, geometry_type, description)
SELECT v.type_name, v.geometry_type, v.description
FROM (VALUES
  ('Parcel',       'polygon', 'Land parcel for rates billing'),
  ('Business',     'point',   'Business premises for business licence fee'),
  ('Market Stall', 'point',   'Market stall within a designated market')
) AS v(type_name, geometry_type, description)
WHERE NOT EXISTS (SELECT 1 FROM record_type WHERE type_name = v.type_name);

-- ── Seed: Default Zone ─────────────────────────────────────────────────────
INSERT INTO zone (zone_name, zone_code, zone_type)
SELECT 'County HQ', 'COUNTY-HQ', 'county'
WHERE NOT EXISTS (SELECT 1 FROM zone WHERE zone_code = 'COUNTY-HQ');

-- ── Seed: Default Admin (password: Admin@1234 — CHANGE IN PRODUCTION) ──────
INSERT INTO users (name, email, password_hash, role_id)
SELECT
  'System Administrator',
  'admin@revenue.local',
  crypt('Admin@1234', gen_salt('bf')),
  (SELECT role_id FROM role WHERE role_name = 'admin')
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@revenue.local');