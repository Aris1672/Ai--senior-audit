"use client";

import { useEffect, useRef, useState } from "react";
import { getRiskColor, getRiskBgColor, type RiskLevel } from "@/lib/billing";

interface SessionData {
  id:              string;
  title:           string;
  status:          string;
  transactions_ct: number;
  findings_ct:     number;
  cost_rub:        number;
  paid:            boolean;
  created_at:      string;
}

interface DashboardData {
  company_name: string;
  sessions:     SessionData[];
  findings:     any[];
  totalAudits:  number;
  totalSpend:   number;
  paidTotal:    number;
  unpaidTotal:  number;
}

// Top-level custom hook — must live outside the component to satisfy Rules of Hooks
function useCountUp(target: number, duration = 900, trigger = true) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!trigger) return;
    let start: number | null = null;
    const step = (ts: number) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setVal(Math.round(ease * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, trigger]);
  return val;
}

export default function ClientDashboard() {
  const [data,    setData]    = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  // These must be called unconditionally at the top level — before any early returns
  const animTotalAudits     = useCountUp(data?.totalAudits    ?? 0, 900, mounted);
  const animActiveAudits    = useCountUp(data ? data.sessions.filter(s => s.status === "active").length    : 0, 900, mounted);
  const animCompletedAudits = useCountUp(data ? data.sessions.filter(s => s.status === "completed").length : 0, 900, mounted);
  const animFindings        = useCountUp(data?.findings.length ?? 0, 900, mounted);

  useEffect(() => {
    async function load() {
      const meRes = await fetch("/api/auth/me");
      const { user } = await meRes.json();
      if (!user) return;

      const dataRes = await fetch("/api/data", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "client_dashboard", payload: { clientId: user.id } }),
      });
      const { profile, sessions, findings } = await dataRes.json();

      const sess: SessionData[] = sessions || [];
      const totalSpend = sess.reduce((a, s) => a + (s.cost_rub || 0), 0);

      const paidTotal   = sess.filter(s => s.paid).reduce((a, s) => a + (s.cost_rub || 0), 0);
      const unpaidTotal = sess.filter(s => !s.paid).reduce((a, s) => a + (s.cost_rub || 0), 0);

      setData({
        company_name: profile?.company_name || "",
        sessions:     sess,
        findings:     findings || [],
        totalAudits:  sess.length,
        totalSpend,
        paidTotal,
        unpaidTotal,
      });
      setLoading(false);
    }
    load();
  }, []);

  // Fire animations only after the dashboard has actually painted with real data.
  // Double-rAF ensures the browser has committed at least one frame before
  // we flip mounted, so cards start invisible and transition in visibly.
  useEffect(() => {
    if (!loading) {
      requestAnimationFrame(() => requestAnimationFrame(() => setMounted(true)));
    }
  }, [loading]);

  if (loading) return (
    <div style={{ color: "#7a90c0", fontFamily: "system-ui, sans-serif" }}>Загрузка...</div>
  );
  if (!data) return null;

  const completedAudits = data.sessions.filter(s => s.status === "completed").length;
  const activeAudits    = data.sessions.filter(s => s.status === "active").length;

  const paidCount   = data.sessions.filter(s => s.paid).length;
  const unpaidCount = data.sessions.filter(s => !s.paid && s.cost_rub).length;

  const SIMPLE_METRICS = [
    {
      label: "Открытых нарушений",
      value: data.findings.length,
      sub:   data.findings.length === 0 ? "Нарушений не выявлено" : "Требуют внимания",
      color: data.findings.length === 0 ? "#2ecc8f" : "#f59e0b",
    },
    {
      label: "Потрачено на аудиты",
      value: data.totalSpend.toLocaleString("ru", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }),
      sub:   `За ${data.totalAudits} аудит${data.totalAudits === 1 ? "" : data.totalAudits < 5 ? "а" : "ов"}`,
      color: "#f59e0b",
    },
    {
      label: "Последний аудит",
      value: data.sessions[0]
        ? new Date(data.sessions[0].created_at).toLocaleDateString("ru", { day: "numeric", month: "long" })
        : "—",
      sub:   data.sessions[0]?.title?.replace(/^Аудит:\s*/, "").split("(")[0].trim() || "Аудитов пока нет",
      color: "#7a90c0",
    },
  ];

  const SESSION_STATUS: Record<string, { label: string; color: string }> = {
    active:    { label: "Активна",   color: "#2ecc8f" },
    completed: { label: "Завершена", color: "#7a90c0" },
    archived:  { label: "Архив",     color: "#3d4f7a" },
  };

  // Pure SVG donut — animates arcs on mount
  function SvgDonut({ value1, value2, color1, color2 }: { value1: number; value2: number; color1: string; color2: string }) {
    const total = value1 + value2 || 1;
    const r = 62;
    const circ = 2 * Math.PI * r;
    const dash1 = (value1 / total) * circ;
    const dash2 = (value2 / total) * circ;
    const gap = 2;
    // When not mounted, offset = full circ (invisible). When mounted, animate to real offset.
    const arc1Offset  = mounted ? 0 : circ;
    const arc2Offset  = mounted ? -(dash1 + gap / 2) : circ;
    return (
      <svg width="150" height="150" viewBox="0 0 150 150" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="75" cy="75" r={r} fill="none" stroke={color2} strokeWidth="17"
          strokeDasharray={`${dash2 - gap} ${circ - dash2 + gap}`}
          strokeDashoffset={arc2Offset}
          style={{ transition: mounted ? "stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1)" : "none" }} />
        <circle cx="75" cy="75" r={r} fill="none" stroke={color1} strokeWidth="17"
          strokeDasharray={`${dash1 - gap} ${circ - dash1 + gap}`}
          strokeDashoffset={arc1Offset}
          style={{ transition: mounted ? "stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1) 0.1s" : "none" }} />
      </svg>
    );
  }

  // Card entrance animation helper
  function cardStyle(index: number): React.CSSProperties {
    return {
      opacity:   mounted ? 1 : 0,
      transform: mounted ? "translateY(0)" : "translateY(18px)",
      transition: `opacity 0.5s ease ${index * 80}ms, transform 0.5s ease ${index * 80}ms`,
    };
  }

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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "28px" }}>

        {/* Donut — Audits */}
        <div style={{ background: "#0c1220", border: "1px solid #1e2d55", borderTop: "3px solid #378ADD", borderRadius: "10px", padding: "20px", ...cardStyle(0) }}>
          <div style={{ fontSize: "12px", color: "#7a90c0", marginBottom: "14px" }}>Всего аудитов</div>
          <div style={{ display: "flex", alignItems: "stretch", gap: "20px" }}>
            <div style={{ position: "relative", width: "150px", height: "150px", flexShrink: 0, alignSelf: "center" }}>
              <SvgDonut value1={activeAudits} value2={completedAudits} color1="#378ADD" color2="#4a5568" />
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                <span style={{ fontSize: "11px", color: "#7a90c0" }}>Всего</span>
                <span style={{ fontSize: "20px", fontWeight: "700", color: "#e8edf8" }}>{animTotalAudits}</span>
              </div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#378ADD", flexShrink: 0 }} />
                  <span style={{ fontSize: "11px", color: "#7a90c0" }}>Активных</span>
                </div>
                <div style={{ fontSize: "20px", fontWeight: "700", color: "#e8edf8", paddingLeft: "14px" }}>{animActiveAudits}</div>
              </div>
              <div style={{ height: "1px", background: "#1e2d55" }} />
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#4a5568", flexShrink: 0 }} />
                  <span style={{ fontSize: "11px", color: "#7a90c0" }}>Завершённых</span>
                </div>
                <div style={{ fontSize: "20px", fontWeight: "700", color: "#e8edf8", paddingLeft: "14px" }}>{animCompletedAudits}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Donut — Payments */}
        <div style={{ background: "#0c1220", border: "1px solid #1e2d55", borderTop: "3px solid #1D9E75", borderRadius: "10px", padding: "20px", ...cardStyle(1) }}>
          <div style={{ fontSize: "12px", color: "#7a90c0", marginBottom: "14px" }}>Оплата аудитов</div>
          <div style={{ display: "flex", alignItems: "stretch", gap: "20px" }}>
            <div style={{ position: "relative", width: "150px", height: "150px", flexShrink: 0, alignSelf: "center" }}>
              <SvgDonut value1={data.paidTotal} value2={data.unpaidTotal} color1="#1D9E75" color2="#f59e0b" />
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                <span style={{ fontSize: "11px", color: "#7a90c0" }}>Итого</span>
                <span style={{ fontSize: "13px", fontWeight: "700", color: "#e8edf8" }}>{data.totalSpend.toLocaleString("ru", { maximumFractionDigits: 0 })} ₽</span>
              </div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#1D9E75", flexShrink: 0 }} />
                  <span style={{ fontSize: "11px", color: "#7a90c0" }}>Оплачено</span>
                </div>
                <div style={{ fontSize: "15px", fontWeight: "700", color: "#e8edf8", paddingLeft: "14px" }}>{data.paidTotal.toLocaleString("ru", { style: "currency", currency: "RUB", maximumFractionDigits: 0 })}</div>
                <div style={{ fontSize: "11px", color: "#3d4f7a", paddingLeft: "14px" }}>{paidCount} аудит{paidCount === 1 ? "" : paidCount < 5 ? "а" : "ов"}</div>
              </div>
              <div style={{ height: "1px", background: "#1e2d55" }} />
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#f59e0b", flexShrink: 0 }} />
                  <span style={{ fontSize: "11px", color: "#7a90c0" }}>К оплате</span>
                </div>
                <div style={{ fontSize: "15px", fontWeight: "700", color: data.unpaidTotal > 0 ? "#f59e0b" : "#e8edf8", paddingLeft: "14px" }}>{data.unpaidTotal.toLocaleString("ru", { style: "currency", currency: "RUB", maximumFractionDigits: 0 })}</div>
                <div style={{ fontSize: "11px", color: "#3d4f7a", paddingLeft: "14px" }}>{data.unpaidTotal === 0 ? "Задолженностей нет" : `${unpaidCount} аудит${unpaidCount === 1 ? "" : unpaidCount < 5 ? "а" : "ов"}`}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Simple metrics stacked */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", ...cardStyle(2) }}>
          {SIMPLE_METRICS.map((m, i) => (
            <div key={i} style={{
              background: "#0c1220", border: "1px solid #1e2d55",
              borderTop: `3px solid ${m.color}`, borderRadius: "10px", padding: "14px 20px",
              flex: 1,
              display: "flex", flexDirection: "column", justifyContent: "center",
            }}>
              <div style={{ fontSize: "12px", color: "#7a90c0", marginBottom: "6px" }}>{m.label}</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: m.color, marginBottom: "4px" }}>
                {i === 0 ? animFindings : m.value}
              </div>
              <div style={{ fontSize: "11px", color: "#3d4f7a" }}>{m.sub}</div>
            </div>
          ))}
        </div>

      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        {/* Recent sessions */}
        <div style={{ background: "#0c1220", border: "1px solid #1e2d55", borderRadius: "10px", padding: "20px", ...cardStyle(3) }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ fontSize: "15px", fontWeight: "600", color: "#e8edf8", margin: 0 }}>
              Последние аудиты
            </h2>
            <a href="/client/audit/new" style={{
              padding: "6px 14px", background: "#1565e8",
              borderRadius: "6px", color: "#fff",
              fontSize: "12px", fontWeight: "600",
              textDecoration: "none",
            }}>
              + Новый аудит
            </a>
          </div>

          {data.sessions.length === 0 ? (
            <div style={{ color: "#3d4f7a", fontSize: "13px", textAlign: "center", padding: "20px 0" }}>
              Аудитов пока нет. Нажмите «+ Новый аудит» чтобы начать.
            </div>
          ) : data.sessions.map((sess) => {
            const st = SESSION_STATUS[sess.status] || SESSION_STATUS.active;
            const displayCost = sess.cost_rub
              ? sess.cost_rub.toLocaleString("ru", { style: "currency", currency: "RUB", maximumFractionDigits: 0 })
              : "—";
            const companyName = sess.title.replace(/^Аудит:\s*/, "").split("(")[0].trim();

            return (
              <a
                key={sess.id}
                href={`/client/audit/${sess.id}`}
                style={{ textDecoration: "none" }}
              >
                <div style={{
                  padding: "12px 8px", borderBottom: "1px solid #1a2340",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  borderRadius: "6px", cursor: "pointer",
                  transition: "background 0.15s",
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#101828")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <div>
                    <div style={{ color: "#e8edf8", fontSize: "13px", fontWeight: "500" }}>
                      {companyName}
                    </div>
                    <div style={{ color: "#7a90c0", fontSize: "12px", marginTop: "2px" }}>
                      {sess.findings_ct} нарушений · {displayCost}
                    </div>
                  </div>
                  <span style={{
                    fontSize: "11px", padding: "3px 8px", borderRadius: "12px",
                    color: st.color, background: st.color + "22", whiteSpace: "nowrap",
                  }}>
                    {st.label}
                  </span>
                </div>
              </a>
            );
          })}
        </div>

        {/* Open findings */}
        <div style={{ background: "#0c1220", border: "1px solid #1e2d55", borderRadius: "10px", padding: "20px", ...cardStyle(4) }}>
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
                color:      getRiskColor(f.risk_level as RiskLevel),
                background: getRiskBgColor(f.risk_level as RiskLevel),
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