-- scripts/reset_data.sql
-- Wipe ALL operational data and reset to a clean slate with ONLY the
-- seeded system administrator.
--
-- KEPT
--   • role               (admin / finance_manager / officer)
--   • status             (pending / active / suspended / closed)
--   • record_type        (Parcel / Business / Market Stall)
--   • zone               (only the seeded "County HQ" row)
--   • users              (only admin@revenue.local)
--   • arcgis_config      (kept, but timestamps + error cleared)
--   • notice_sequence    (cleared so the next notice is #000001)
--
-- WIPED
--   • taxpayer_record, record_attributes
--   • fee_schedule, fee_assignment
--   • demand_notice, payment
--   • audit_log (TRUNCATE bypasses the immutability trigger)
--
-- Run in pgAdmin (or psql) as the database owner. Wrapped in a transaction,
-- so if anything fails nothing is committed.

BEGIN;

-- 1. Clear all transactional data. RESTART IDENTITY resets serial PKs so
--    the next record / notice / payment starts at 1.
TRUNCATE TABLE
  audit_log,
  payment,
  demand_notice,
  fee_assignment,
  fee_schedule,
  record_attributes,
  taxpayer_record,
  notice_sequence
RESTART IDENTITY CASCADE;

-- 2. Keep only the seeded admin user. Any officers / finance managers
--    created via the UI are removed.
DELETE FROM users
WHERE email <> 'admin@revenue.local';

-- 3. Keep only the seeded County HQ zone. Drop any zones added later.
DELETE FROM zone
WHERE zone_code <> 'COUNTY-HQ';

-- 4. Reset the sequences for users + zone so the next inserts start fresh.
SELECT setval(
  pg_get_serial_sequence('users','user_id'),
  COALESCE((SELECT MAX(user_id) FROM users), 1),
  TRUE
);
SELECT setval(
  pg_get_serial_sequence('zone','zone_id'),
  COALESCE((SELECT MAX(zone_id) FROM zone), 1),
  TRUE
);

-- 5. ArcGIS connection survives, but timestamps + error are cleared so the
--    next sync acts like a fresh deployment.
UPDATE arcgis_config
SET last_sync_at    = NULL,
    last_sync_error = NULL;

-- (Sanity output — runs without COMMIT inside a transaction; if you're in
--  psql you'll see the counts.)
SELECT 'users' AS table_name, COUNT(*) FROM users
UNION ALL SELECT 'zone',              COUNT(*) FROM zone
UNION ALL SELECT 'taxpayer_record',   COUNT(*) FROM taxpayer_record
UNION ALL SELECT 'fee_schedule',      COUNT(*) FROM fee_schedule
UNION ALL SELECT 'fee_assignment',    COUNT(*) FROM fee_assignment
UNION ALL SELECT 'demand_notice',     COUNT(*) FROM demand_notice
UNION ALL SELECT 'payment',           COUNT(*) FROM payment
UNION ALL SELECT 'audit_log',         COUNT(*) FROM audit_log;

COMMIT;
