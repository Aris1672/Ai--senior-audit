-- 008_finding_report_fields.sql — fields for the redesigned report (Nov 13, 2026)
--
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- financial_impact — the money side of a finding in one line (sum at risk,
--                    possible additional tax), filled by the agent for new
--                    findings and corrections; shown as its own row in the report.
-- proposal_kind / resolution_kind — how a finding was closed:
--     'corrected'  — the violation existed and has been put right
--                    (tax paid, document posted, money refunded, return corrected);
--     'documented' — the supporting documents show the basis does not hold
--                    (acts for the whole amount, НПД status, reconciliation).
--   Findings closed before this migration have no kind and are shown as
--   "closed on supporting documents".

ALTER TABLE findings
  ADD COLUMN IF NOT EXISTS financial_impact TEXT,
  ADD COLUMN IF NOT EXISTS proposal_kind    TEXT CHECK (proposal_kind   IN ('corrected', 'documented')),
  ADD COLUMN IF NOT EXISTS resolution_kind  TEXT CHECK (resolution_kind IN ('corrected', 'documented'));
