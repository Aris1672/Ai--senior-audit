-- Pricing tiers
CREATE TABLE pricing_tiers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  max_transactions INTEGER NOT NULL,
  price_rub        NUMERIC(10,2) NOT NULL,
  description      TEXT,
  is_active        BOOLEAN DEFAULT true,
  sort_order       INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Default tiers
INSERT INTO pricing_tiers (name, max_transactions, price_rub, description, sort_order) VALUES
  ('Базовый',    500,   8000,  'До 500 транзакций на 1 аудит',    1),
  ('Стандарт',   2000,  15000, 'До 2000 транзакций на 1 аудит',   2),
  ('Профи',      5000,  30000, 'До 5000 транзакций на 1 аудит',   3),
  ('Корпоратив', 20000, 75000, 'До 20 000 транзакций на 1 аудит', 4);

-- Client subscriptions
CREATE TABLE client_subscriptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID REFERENCES profiles(id) ON DELETE CASCADE,
  tier_id          UUID REFERENCES pricing_tiers(id),
  custom_price_rub NUMERIC(10,2),
  custom_max_tx    INTEGER,
  audits_purchased INTEGER DEFAULT 1,
  audits_used      INTEGER DEFAULT 0,
  valid_from       DATE DEFAULT CURRENT_DATE,
  valid_to         DATE,
  notes            TEXT,
  created_by       UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT positive_audits CHECK (audits_purchased > 0)
);

-- Usage events
CREATE TABLE usage_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID REFERENCES profiles(id),
  session_id       UUID,
  event_type       TEXT NOT NULL,
  tokens_in        INTEGER DEFAULT 0,
  tokens_out       INTEGER DEFAULT 0,
  transactions_ct  INTEGER DEFAULT 0,
  cost_rub         NUMERIC(10,4) DEFAULT 0,
  metadata         JSONB,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Helper function: get effective limits for a client
CREATE OR REPLACE FUNCTION get_client_limit(p_client_id UUID)
RETURNS TABLE(max_tx INTEGER, price_rub NUMERIC, audits_remaining INTEGER) AS $$
  SELECT
    COALESCE(cs.custom_max_tx, pt.max_transactions),
    COALESCE(cs.custom_price_rub, pt.price_rub),
    (cs.audits_purchased - cs.audits_used)
  FROM client_subscriptions cs
  JOIN pricing_tiers pt ON pt.id = cs.tier_id
  WHERE cs.client_id = p_client_id
    AND (cs.valid_to IS NULL OR cs.valid_to >= CURRENT_DATE)
  ORDER BY cs.created_at DESC
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

-- RLS
ALTER TABLE client_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_tiers         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_subs"    ON client_subscriptions FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "client_own_sub"    ON client_subscriptions FOR SELECT
  USING (client_id = auth.uid());

CREATE POLICY "admin_all_usage"   ON usage_events FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "client_own_usage"  ON usage_events FOR SELECT
  USING (client_id = auth.uid());

CREATE POLICY "anyone_read_tiers" ON pricing_tiers FOR SELECT USING (true);
CREATE POLICY "admin_manage_tiers" ON pricing_tiers FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));