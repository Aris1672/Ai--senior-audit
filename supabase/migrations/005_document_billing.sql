-- 005_document_billing.sql — per-document billing (Nov 12, 2026)
--
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- Every uploaded document now gets a server-side quote (operations or pages)
-- and is analysed only after the client confirms it. Documents uploaded
-- before this migration are marked as already confirmed, so existing audits
-- keep working and keep their recorded price.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS billing_status       TEXT,
  ADD COLUMN IF NOT EXISTS billing_kind         TEXT,
  ADD COLUMN IF NOT EXISTS billing_units        INTEGER,
  ADD COLUMN IF NOT EXISTS billing_new_units    INTEGER,
  ADD COLUMN IF NOT EXISTS billing_rate_rub     NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS billing_amount_rub   NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS billing_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS content_hash         TEXT;

-- Existing documents: already accepted under the old pricing.
UPDATE documents SET billing_status = 'confirmed' WHERE billing_status IS NULL;

ALTER TABLE documents ALTER COLUMN billing_status SET DEFAULT 'pending';
ALTER TABLE documents ALTER COLUMN billing_status SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE documents ADD CONSTRAINT documents_billing_status_check
    CHECK (billing_status IN ('pending', 'confirmed', 'declined'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS documents_session_billing_idx ON documents (session_id, billing_status);

-- Audit totals: pages next to operations, and the moment the amount was frozen.
ALTER TABLE audit_sessions
  ADD COLUMN IF NOT EXISTS pages_ct          INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billing_frozen_at TIMESTAMPTZ;

-- Rate per page of a supporting document.
ALTER TABLE billing_settings
  ADD COLUMN IF NOT EXISTS price_per_page_rub NUMERIC(10,2) NOT NULL DEFAULT 20;
