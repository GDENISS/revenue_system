-- migrations/002_arcgis_auth.sql
-- Add support for ArcGIS-based authentication.
-- Idempotent: safe to re-run.

-- 1. Allow rows with no local password (ArcGIS-only users)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 2. Track which provider authenticated the user
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) NOT NULL DEFAULT 'local';

-- 3. Map a local user to the ArcGIS portal username they sign in as.
--    Unique so each ArcGIS account corresponds to at most one local row.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS arcgis_username VARCHAR(150);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'users_arcgis_username_key'
  ) THEN
    CREATE UNIQUE INDEX users_arcgis_username_key
      ON users (arcgis_username)
      WHERE arcgis_username IS NOT NULL;
  END IF;
END$$;
