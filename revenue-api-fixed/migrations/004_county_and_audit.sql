-- migrations/004_county_and_audit.sql
-- 1. County branding lives next to the ArcGIS connection (one row per deployment).
-- 2. Per-year notice sequence (atomic, gapless within a year).
-- 3. Audit-log immutability + sync_error visibility.
-- Idempotent.

-- ── County / deployment metadata ─────────────────────────────────────────
ALTER TABLE arcgis_config ADD COLUMN IF NOT EXISTS county_code     VARCHAR(20)   DEFAULT 'NCC';
ALTER TABLE arcgis_config ADD COLUMN IF NOT EXISTS county_name     VARCHAR(150)  DEFAULT 'Nairobi City County';
ALTER TABLE arcgis_config ADD COLUMN IF NOT EXISTS county_address  TEXT          DEFAULT 'City Hall Annex, P.O. Box 30075-00100, Nairobi, Kenya';
ALTER TABLE arcgis_config ADD COLUMN IF NOT EXISTS legal_basis     TEXT          DEFAULT 'Issued under the Rating Act, 2024 (Cap. 267, Revised)';
ALTER TABLE arcgis_config ADD COLUMN IF NOT EXISTS currency_code   VARCHAR(8)    DEFAULT 'KES';
ALTER TABLE arcgis_config ADD COLUMN IF NOT EXISTS verify_base_url TEXT          DEFAULT '';
ALTER TABLE arcgis_config ADD COLUMN IF NOT EXISTS token_endpoint  TEXT;        -- override (Enterprise)
ALTER TABLE arcgis_config ADD COLUMN IF NOT EXISTS last_sync_error TEXT;

-- ── Notice sequence (one per year, county scope is in code/format) ──────
CREATE TABLE IF NOT EXISTS notice_sequence (
  county_code   VARCHAR(20) NOT NULL,
  year          INT         NOT NULL,
  last_value    INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (county_code, year)
);

-- Atomic increment helper. Concurrent callers will serialize via the unique key.
CREATE OR REPLACE FUNCTION next_notice_seq(p_county VARCHAR, p_year INT)
RETURNS INT AS $$
DECLARE v INT;
BEGIN
  INSERT INTO notice_sequence (county_code, year, last_value)
       VALUES (p_county, p_year, 1)
  ON CONFLICT (county_code, year)
  DO UPDATE SET last_value = notice_sequence.last_value + 1
  RETURNING last_value INTO v;
  RETURN v;
END;
$$ LANGUAGE plpgsql;

-- ── Audit immutability ──────────────────────────────────────────────────
-- Reject UPDATE and DELETE on audit_log so no app-layer bug (or admin
-- mistake) can silently rewrite history. Inserts remain free.
CREATE OR REPLACE FUNCTION audit_log_block_write()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only — % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER  audit_log_no_update
BEFORE UPDATE ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_log_block_write();

DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
CREATE TRIGGER  audit_log_no_delete
BEFORE DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_log_block_write();
