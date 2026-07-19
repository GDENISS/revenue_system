-- 008_performance_indexes.sql
-- Hot-path indexes identified during the scalability review.

-- Trigram index so taxpayer search (ILIKE '%term%') stops being a full-table
-- scan. Powers the records/officer/map search boxes at 100k+ rows.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_taxpayer_name_trgm
  ON taxpayer_record USING gin (taxpayer_name gin_trgm_ops);

-- Date-window filters on the payments page + summary aggregates.
CREATE INDEX IF NOT EXISTS idx_payment_date ON payment (payment_date);

-- Notice register default ordering + year-window checks in bulk generation.
CREATE INDEX IF NOT EXISTS idx_notice_issued_date ON demand_notice (issued_date);

-- fee_assignment lookups by record + year (auto-assign duplicate checks,
-- outstanding-balance subqueries).
CREATE INDEX IF NOT EXISTS idx_fee_assignment_record_year
  ON fee_assignment (record_id, billing_year);
