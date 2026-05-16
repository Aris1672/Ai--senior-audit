"use client";

import { createClient } from "@/lib/supabase-client";
import { useEffect, useState } from "react";
import { formatRubles, getRiskColor, getRiskBgColor, type RiskLevel } from "@/lib/billing";

interface DashboardData {
  company_name:     string;
  tier_name:        string;
  audits_remaining: number;
  audits_purchased: number;
  max_tx:           number;
  price_rub:        number;
  sessions:         any[];
  findings:         any[];
  totalCost:        number;
  totalTx:          number;
}

export default function ClientDashboard() {
  const [data,    setData]    = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [
        { data: profile },
        { data: sub },
        { data: sessions },
        { data: findings },
        { data: usage },
      ] = await Promise.all([
        supabase.from("profiles").select("company_name").eq("id", user.id).single(),
        supabase.from("client_subscriptions")
          .select("audits_purchased, audits_used, custom_price_rub, custom_max_tx, pricing_tiers(name, price_rub, max_transactions)")
          .eq("client_id", user.id).order("created_at", { ascending: false }).limit(1),
        supabase.from("audit_sessions")
          .select("id, title, status, transactions_ct, findings_ct, cost_rub, created_at")
          .eq("client_id", user.id).order("created_at", { ascending: false }).limit(5),
        supabase.from("findings")
          .select("id, risk_level, title, created_at")
          .eq("client_id", user.id).eq("status", "open")
          .order("created_at", { ascending: false }).limit(8),
        supabase.from("usage_events")
          .select("cost_rub, transactions_ct")
          .eq("client_id", user.id),
      ]);

      const s    = sub?.[0] as any;
      const tier = s?.pricing_tiers;

      setData({
        company_name:     profile?.company_name || "",
        tier_name:        tier?.name            || "—",
        audits_remaining: s ? (s.audits_purchased - s.audits_used) : 0,
        audits_purchased: s?.audits_purchased   || 0,
        max_tx:           s?.custom_max_tx      || tier?.max_transactions || 0,
        price_rub:        s?.custom_price_rub   || tier?.price_rub        || 0,
        sessions:         sessions              || [],
        findings:         findings              || [],
        totalCost:        usage?.reduce((a, e) => a + (e.cost_rub || 0), 0)          || 0,
        totalTx:          usage?.reduce((a, e) => a + (e.transactions_ct || 0), 0)   || 0,
      });
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return (
    <div style={{ color: "#7a90c0", fontFamily: "system-ui, sans-serif" }}>Загрузка...</div>
  );
  if (!data)   return null;

  const METRICS = [
    { label: "Тарифный план",        value: data.tier_name,                     color: "#4d91ff" },
    { label: "Осталось аудитов",     value: `${data.audits_remaining} из ${data.audits_purchased}`, color: data.audits_remaining > 0 ? "#2ecc8f" : "#e84040" },
    { label: "Лимит транзакций",     value: data.max_tx.toLocaleString("ru"),   color: "#7a90c0" },
    { label: "Потрачено (AI)",       value: formatRubles(data.totalCost),       color: "#f59e0b" },
  ];

  const SESSION_STATUS: Record<string, { label: string; color: string }> = {
    active:    { label: "Активна",   color: "#2ecc8f" },
    completed: { label: "Завершена", color: "#7a90c0" },
    archived:  { label: "Архив",     color: "#3d4f7a" },
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#e8edf8", margin: 0 }}>
          {data.company_name ? `Добро пожаловать, ${data.company_name}` : "Дашборд"}
        </h1>
        <p style={{ color: "#7a90c0", fontSize: "14px", marginTop: "6px" }}>
          Обзор ваших аудитов и нарушений
        </p>
      </div>

      {/* Metric cards */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
        gap: "16px", marginBottom: "28px",
      }}>
        {METRICS.map((m, i) => (
          <div key={i} style={{
            background: "#0c1220", border: "1px solid #1e2d55",
            borderTop: `3px solid ${m.color}`, borderRadius: "10px", padding: "20px",
          }}>
            <div style={{ fontSize: "12px", color: "#7a90c0", marginBottom: "8px" }}>{m.label}</div>
            <div style={{ fontSize: "22px", fontWeight: "700", color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        {/* Recent sessions */}
        <div style={{ background: "#0c1220", border: "1px solid #1e2d55", borderRadius: "10px", padding: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ fontSize: "15px", fontWeight: "600", color: "#e8edf8", margin: 0 }}>
              Последние аудиты
            </h2>
            <a href="/client/chat" style={{ fontSize: "12px", color: "#1565e8", textDecoration: "none" }}>
              + Новый аудит
            </a>
          </div>
          {data.sessions.length === 0 ? (
            <div style={{ color: "#3d4f7a", fontSize: "13px", textAlign: "center", padding: "20px 0" }}>
              Аудитов пока нет. Начните новый аудит в разделе «ИИ Аудитор».
            </div>
          ) : data.sessions.map((sess: any) => {
            const st = SESSION_STATUS[sess.status] || SESSION_STATUS.active;
            return (
              <div key={sess.id} style={{
                padding: "12px 0", borderBottom: "1px solid #1a2340",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <div style={{ color: "#e8edf8", fontSize: "13px", fontWeight: "500" }}>
                    {sess.title}
                  </div>
                  <div style={{ color: "#7a90c0", fontSize: "12px", marginTop: "2px" }}>
                    {sess.transactions_ct} тр. · {sess.findings_ct} нарушений · {formatRubles(sess.cost_rub)}
                  </div>
                </div>
                <span style={{
                  fontSize: "11px", padding: "3px 8px", borderRadius: "12px",
                  color: st.color, background: st.color + "22",
                }}>
                  {st.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Open findings */}
        <div style={{ background: "#0c1220", border: "1px solid #1e2d55", borderRadius: "10px", padding: "20px" }}>
          <h2 style={{ fontSize: "15px", fontWeight: "600", color: "#e8edf8", margin: "0 0 16px" }}>
            Открытые нарушения ({data.findings.length})
          </h2>
          {data.findings.length === 0 ? (
            <div style={{ color: "#3d4f7a", fontSize: "13px", textAlign: "center", padding: "20px 0" }}>
              Нарушений не обнаружено
            </div>
          ) : data.findings.map((f: any) => (
            <div key={f.id} style={{
              padding: "10px 0", borderBottom: "1px solid #1a2340",
              display: "flex", alignItems: "center", gap: "10px",
            }}>
              <span style={{
                fontSize: "10px", padding: "3px 8px", borderRadius: "10px",
                fontWeight: "700", whiteSpace: "nowrap",
                color:       getRiskColor(f.risk_level as RiskLevel),
                background:  getRiskBgColor(f.risk_level as RiskLevel),
              }}>
                {f.risk_level}
              </span>
              <span style={{ color: "#e8edf8", fontSize: "13px" }}>{f.title}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}