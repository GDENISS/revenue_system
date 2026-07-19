-- 005_paystack.sql
-- Paystack gateway support: track each Paystack transaction by its unique
-- reference, and stash the raw webhook payload so we can recover the channel
-- (mobile_money / card / bank) and show it next to manual entries in the UI.
--
-- payment_method stays inside its existing enum (mpesa | bank | cash | cheque).
-- The webhook handler maps Paystack's `channel`:
--   mobile_money / mobile_money_ng → 'mpesa'
--   card / bank / bank_transfer    → 'bank'
-- and writes the full event payload to gateway_response.

ALTER TABLE payment
  ADD COLUMN IF NOT EXISTS paystack_reference VARCHAR(100),
  ADD COLUMN IF NOT EXISTS gateway_response  JSONB;

-- UNIQUE on the reference gives us free idempotency: if Paystack retries the
-- webhook (or the verify endpoint fires after the webhook already landed),
-- the second INSERT collides and we no-op gracefully.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_paystack_reference_key'
  ) THEN
    ALTER TABLE payment ADD CONSTRAINT payment_paystack_reference_key UNIQUE (paystack_reference);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_payment_paystack_ref
  ON payment (paystack_reference)
  WHERE paystack_reference IS NOT NULL;
