-- 007_finding_revision.sql — stage 2: correcting a finding's assessment (Nov 13, 2026)
--
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- The agent may find that a recorded finding is assessed wrongly (risk level,
-- evidence status, legal reasoning, description) — e.g. a finding recorded
-- before a prompt rule was corrected. It PROPOSES a corrected version; the
-- client confirms or declines, exactly as with closing. The previous version
-- is kept in finding_events.payload; the finding shows what was changed.

ALTER TABLE findings
  ADD COLUMN IF NOT EXISTS revision_proposed_at TIMESTAMPTZ,  -- a correction is waiting for the client
  ADD COLUMN IF NOT EXISTS proposed_revision    JSONB,        -- only the fields to change: risk_level, evidence_status, title, description, legal_basis, recommendation
  ADD COLUMN IF NOT EXISTS revision_basis       TEXT,         -- why the agent thinks the old assessment is wrong
  ADD COLUMN IF NOT EXISTS revised_at           TIMESTAMPTZ,  -- last confirmed correction
  ADD COLUMN IF NOT EXISTS revision_summary     TEXT;         -- what was changed and why (shown on the page and in the PDF)

ALTER TABLE finding_events ADD COLUMN IF NOT EXISTS payload JSONB;   -- before / after of a correction

ALTER TABLE finding_events DROP CONSTRAINT IF EXISTS finding_events_event_type_check;
ALTER TABLE finding_events ADD CONSTRAINT finding_events_event_type_check CHECK (event_type IN (
  'proposed', 'kept_open', 'confirmed', 'declined', 'reopened',
  'revision_proposed', 'revision_confirmed', 'revision_declined'
));
