-- migrations/003_drop_spatial.sql
-- GIS becomes the cornerstone: all geometry is owned by ArcGIS feature
-- services. Postgres keeps ONLY the taxpayer attributes plus the
-- `arcgis_object_id` link to the canonical parcel/business/stall feature.
--
-- Idempotent: safe to re-run.

-- 1. Drop the PostGIS spatial index and column
DROP INDEX IF EXISTS idx_taxpayer_geom;
ALTER TABLE taxpayer_record DROP COLUMN IF EXISTS geom;

-- 2. Drop the denormalised lat/lng columns. Coordinates are no longer the
--    source of truth — query the linked ArcGIS layer instead.
ALTER TABLE taxpayer_record DROP COLUMN IF EXISTS latitude;
ALTER TABLE taxpayer_record DROP COLUMN IF EXISTS longitude;

-- 3. Keep `arcgis_object_id` indexed for fast linked-record lookups.
CREATE INDEX IF NOT EXISTS idx_taxpayer_arcgis ON taxpayer_record(arcgis_object_id);

-- (Optional) If the PostGIS extension was only here for our column, you can
-- drop it manually — we leave it installed because other extensions might
-- depend on it:
--   DROP EXTENSION IF EXISTS postgis;
