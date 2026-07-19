-- 007_integrity.sql
-- Data-integrity hardening.
--
-- Design principles:
--   1. Financial rows (payments, notices) are never edited or deleted.
--      Corrections are NEW rows: a payment is corrected by a reversal entry
--      (negative amount, references the original, carries a reason); a notice
--      is corrected by cancellation (status change + mandatory reason).
--   2. CHECK constraints encode business invariants at the storage layer so
--      no code path — including future bugs — can write nonsense.
--   3. Triggers make payment rows immutable after insert (only the reversal
--      bookkeeping fields may change, exactly once).

-- ── Payment reversal columns ───────────────────────────────────────────────
ALTER TABLE payment
  ADD COLUMN IF NOT EXISTS reverses_payment_id INT REFERENCES payment(payment_id),
  ADD COLUMN IF NOT EXISTS is_reversed         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reversal_reason     TEXT;

-- A payment may be reversed at most once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_single_reversal
  ON payment (reverses_payment_id) WHERE reverses_payment_id IS NOT NULL;

-- Normal payments are positive; reversal entries are negative and must
-- reference the original. Nothing may be zero.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_amount_sign') THEN
    ALTER TABLE payment ADD CONSTRAINT chk_payment_amount_sign CHECK (
      (reverses_payment_id IS NULL AND amount_paid > 0)
      OR (reverses_payment_id IS NOT NULL AND amount_paid < 0)
    );
  END IF;
END$$;

-- Duplicate M-Pesa refs were only blocked in app code — seal it in the DB.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_mpesa_ref
  ON payment (mpesa_ref) WHERE mpesa_ref IS NOT NULL;

-- ── Notice constraints ─────────────────────────────────────────────────────
ALTER TABLE demand_notice
  ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_notice_amount_positive') THEN
    ALTER TABLE demand_notice ADD CONSTRAINT chk_notice_amount_positive CHECK (amount_due > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_notice_status') THEN
    ALTER TABLE demand_notice ADD CONSTRAINT chk_notice_status
      CHECK (notice_status IN ('issued', 'paid', 'overdue', 'cancelled'));
  END IF;
END$$;

-- ── Fee constraints ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_schedule_window') THEN
    ALTER TABLE fee_schedule ADD CONSTRAINT chk_schedule_window
      CHECK (effective_to IS NULL OR effective_to >= effective_from);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_schedule_amount') THEN
    ALTER TABLE fee_schedule ADD CONSTRAINT chk_schedule_amount CHECK (amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_assignment_amount') THEN
    ALTER TABLE fee_assignment ADD CONSTRAINT chk_assignment_amount CHECK (amount_due >= 0);
  END IF;
END$$;

-- ── Spatial link uniqueness ────────────────────────────────────────────────
-- One parcel (per record type) can only be bound to one taxpayer record.
-- Previously enforced only in app code.
CREATE UNIQUE INDEX IF NOT EXISTS uq_record_arcgis_link
  ON taxpayer_record (record_type_id, arcgis_object_id)
  WHERE arcgis_object_id IS NOT NULL;

-- ── Field-task enums ───────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_field_task_status') THEN
    ALTER TABLE field_task ADD CONSTRAINT chk_field_task_status
      CHECK (status IN ('open', 'in_progress', 'done', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_field_task_priority') THEN
    ALTER TABLE field_task ADD CONSTRAINT chk_field_task_priority
      CHECK (priority IN ('low', 'normal', 'high'));
  END IF;
END$$;

-- ── Immutability triggers ──────────────────────────────────────────────────
-- Payments: no DELETE ever; UPDATE may only touch the reversal bookkeeping
-- fields (is_reversed, reversal_reason) — the financial facts are frozen.
CREATE OR REPLACE FUNCTION payment_freeze() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment rows are immutable — reverse the payment instead of deleting it';
  END IF;
  IF (OLD.amount_paid, OLD.payment_method, OLD.payment_date, OLD.receipt_number,
      OLD.record_id, OLD.notice_id, OLD.mpesa_ref, OLD.bank_ref,
      OLD.paystack_reference, OLD.recorded_by)
     IS DISTINCT FROM
     (NEW.amount_paid, NEW.payment_method, NEW.payment_date, NEW.receipt_number,
      NEW.record_id, NEW.notice_id, NEW.mpesa_ref, NEW.bank_ref,
      NEW.paystack_reference, NEW.recorded_by) THEN
    RAISE EXCEPTION 'payment financial fields are immutable — reverse the payment and record a new one';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_freeze ON payment;
CREATE TRIGGER trg_payment_freeze
  BEFORE UPDATE OR DELETE ON payment
  FOR EACH ROW EXECUTE FUNCTION payment_freeze();

-- Notices: no DELETE — cancellation is the correction path.
CREATE OR REPLACE FUNCTION notice_block_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'demand_notice rows are immutable — cancel the notice instead of deleting it';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notice_block_delete ON demand_notice;
CREATE TRIGGER trg_notice_block_delete
  BEFORE DELETE ON demand_notice
  FOR EACH ROW EXECUTE FUNCTION notice_block_delete();
