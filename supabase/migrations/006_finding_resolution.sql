-- 006_finding_resolution.sql — stage 2: closing findings (Nov 13, 2026)
--
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- The agent proposes closing a finding when the uploaded documents remove
-- its basis; the client confirms or declines. Every step is kept in
-- finding_events, so the report can show who closed what, when and on what.

ALTER TABLE findings
  ADD COLUMN IF NOT EXISTS proposed_at        TIMESTAMPTZ,   -- a closing proposal is waiting for the client
  ADD COLUMN IF NOT EXISTS proposal_basis     TEXT,
  ADD COLUMN IF NOT EXISTS proposal_documents TEXT,
  ADD COLUMN IF NOT EXISTS agent_note         TEXT,          -- what the agent last said is still missing
  ADD COLUMN IF NOT EXISTS resolved_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by        UUID,
  ADD COLUMN IF NOT EXISTS resolution_basis   TEXT,
  ADD COLUMN IF NOT EXISTS resolution_documents TEXT;

CREATE TABLE IF NOT EXISTS finding_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id  UUID NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  session_id  UUID,
  event_type  TEXT NOT NULL CHECK (event_type IN ('proposed', 'kept_open', 'confirmed', 'declined', 'reopened')),
  actor       TEXT NOT NULL CHECK (actor IN ('agent', 'client', 'admin')),
  actor_id    UUID,
  note        TEXT,
  documents   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finding_events_finding_idx ON finding_events (finding_id, created_at);
CREATE INDEX IF NOT EXISTS finding_events_session_idx ON finding_events (session_id, created_at);

-- Read and written by the server only.
ALTER TABLE finding_events ENABLE ROW LEVEL SECURITY;
