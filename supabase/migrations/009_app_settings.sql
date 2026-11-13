-- 009_app_settings.sql — switches kept by the app (Nov 13, 2026)
--
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- First switch: 'demo_1c' — the demo 1C base (invented company ООО «Вектор-Трейд»)
-- served by the app itself at /api/mock-1c, turned on and off by an admin
-- for demonstrations (page «Демо 1С» in the admin area). Off by default.
-- Only the server (service role) reads and writes this table.

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;   -- no policies: clients cannot read or write it

INSERT INTO app_settings (key, value) VALUES ('demo_1c', '{"enabled": false}')
ON CONFLICT (key) DO NOTHING;
