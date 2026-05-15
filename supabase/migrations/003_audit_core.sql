CREATE TYPE session_status AS ENUM ('active', 'completed', 'archived');
CREATE TYPE risk_level     AS ENUM ('КРИТИЧНО', 'СУЩЕСТВЕННО', 'НЕСУЩЕСТВЕННО');
CREATE TYPE finding_status AS ENUM ('open', 'resolved', 'disputed');

CREATE TABLE audit_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID REFERENCES profiles(id),
  subscription_id UUID REFERENCES client_subscriptions(id),
  title           TEXT NOT NULL,
  period_from     DATE,
  period_to       DATE,
  status          session_status DEFAULT 'active',
  transactions_ct INTEGER DEFAULT 0,
  findings_ct     INTEGER DEFAULT 0,
  cost_rub        NUMERIC(10,2) DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE TABLE transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID REFERENCES audit_sessions(id),
  client_id         UUID REFERENCES profiles(id),
  c1_ref            TEXT,
  date              DATE,
  account_debit     TEXT,
  account_credit    TEXT,
  amount            NUMERIC(18,2),
  counterparty      TEXT,
  inn_counterparty  TEXT,
  description       TEXT,
  document_type     TEXT,
  has_document      BOOLEAN DEFAULT false,
  risk_score        INTEGER,
  risk_level        risk_level,
  raw_data          JSONB,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE findings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID REFERENCES audit_sessions(id),
  client_id      UUID REFERENCES profiles(id),
  transaction_id UUID REFERENCES transactions(id),
  risk_level     risk_level NOT NULL,
  risk_score     INTEGER,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL,
  legal_basis    TEXT,
  recommendation TEXT,
  status         finding_status DEFAULT 'open',
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE audit_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID REFERENCES audit_sessions(id),
  client_id   UUID REFERENCES profiles(id),
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  tokens_in   INTEGER DEFAULT 0,
  tokens_out  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Helper: increment session cost
CREATE OR REPLACE FUNCTION increment_session_cost(p_session_id UUID, p_amount NUMERIC)
RETURNS VOID AS $$
  UPDATE audit_sessions
  SET cost_rub = cost_rub + p_amount
  WHERE id = p_session_id;
$$ LANGUAGE sql SECURITY DEFINER;

-- RLS
ALTER TABLE audit_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE findings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_messages  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_own_sessions"  ON audit_sessions FOR ALL USING (client_id = auth.uid());
CREATE POLICY "client_own_tx"        ON transactions    FOR ALL USING (client_id = auth.uid());
CREATE POLICY "client_own_findings"  ON findings        FOR ALL USING (client_id = auth.uid());
CREATE POLICY "client_own_messages"  ON audit_messages  FOR ALL USING (client_id = auth.uid());

CREATE POLICY "admin_all_sessions"   ON audit_sessions FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "admin_all_tx"         ON transactions    FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "admin_all_findings"   ON findings        FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "admin_all_messages"   ON audit_messages  FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));