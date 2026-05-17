"use client";

import { useEffect, useState } from "react";
import { formatRubles } from "@/lib/billing";

interface Stats {
  totalClients:      number;
  activeClients:     number;
  pausedClients:     number;
  totalSessions:     number;
  totalFindings:     number;
  criticalFindings:  number;
  totalAuditCharges: number;
  totalUnpaid:       number;
}

// ── Donut chart (pure SVG, zero deps) ─────────────────────────────────────────
function PaymentDonut({ paid, unpaid }: { paid: number; unpaid: number }) {
  const total = paid + unpaid;

  // Nothing to show yet
  if (total === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "160px", color: "#7a90c0", fontSize: "13px" }}>
        Нет данных
      </div>
    );
  }

  const R = 85;           // outer radius
  const r = 52;           // inner radius (hole)
  const cx = 100;
  const cy = 100;
  const gap = 0.03;       // radians gap between arcs

  // Convert a fraction to SVG arc path
  function arcPath(startAngle: number, endAngle: number) {
    const toRad = (a: number) => (a - 90) * (Math.PI / 180);
    const s = toRad(startAngle);
    const e = toRad(endAngle);
    const x1 = cx + R * Math.cos(s);
    const y1 = cy + R * Math.sin(s);
    const x2 = cx + R * Math.cos(e);
    const y2 = cy + R * Math.sin(e);
    const ix1 = cx + r * Math.cos(e);
    const iy1 = cy + r * Math.sin(e);
    const ix2 = cx + r * Math.cos(s);
    const iy2 = cy + r * Math.sin(s);
    const large = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${r} ${r} 0 ${large} 0 ${ix2} ${iy2} Z`;
  }

  const paidFrac   = paid / total;
  const unpaidFrac = unpaid / total;
  const gapDeg     = (gap * 180) / Math.PI;

  const paidEnd    = paidFrac * 360 - gapDeg;
  const unpaidStart = paidFrac * 360 + gapDeg;
  const unpaidEnd   = 360 - gapDeg;

  const paidPct   = Math.round(paidFrac * 100);
  const unpaidPct = 100 - paidPct;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
      <svg width="220" height="210" viewBox="0 0 220 210">
        {/* Paid arc */}
        <path d={arcPath(0, paidEnd)}   fill="#2ecc8f" opacity="0.9" />
        {/* Unpaid arc */}
        <path d={arcPath(unpaidStart, unpaidEnd)} fill="#f59e0b" opacity="0.9" />
        {/* Centre label */}
        <text x={cx} y={cy - 6}  textAnchor="middle" fill="#e8edf8" fontSize="13" fontWeight="600">
          {formatRubles(total)}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="#7a90c0" fontSize="11">
          всего
        </text>
      </svg>

      {/* Legend */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: "#2ecc8f", flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: "12px", color: "#7a90c0" }}>Оплачено · {paidPct}%</div>
            <div style={{ fontSize: "15px", fontWeight: "600", color: "#2ecc8f" }}>{formatRubles(paid)}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: "#f59e0b", flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: "12px", color: "#7a90c0" }}>Не оплачено · {unpaidPct}%</div>
            <div style={{ fontSize: "15px", fontWeight: "600", color: "#f59e0b" }}>{formatRubles(unpaid)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [stats, setStats]     = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      const res = await fetch("/api/data", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "admin_stats" }),
      });
      const { profiles, sessions, findings, usage } = await res.json();

      // Debug: log first session to verify `paid` field is present
      if (sessions?.length) console.log("[admin_stats] sample session:", sessions[0]);

      const totalAuditCharges = sessions?.reduce((s: number, e: any) => s + (e.cost_rub || 0), 0) ?? 0;
      // paid field must be explicitly true — null/undefined/false all count as unpaid
      const totalUnpaid       = sessions?.reduce((s: number, e: any) => s + (e.paid === true ? 0 : (e.cost_rub || 0)), 0) ?? 0;

      setStats({
        totalClients:      profiles?.length || 0,
        activeClients:     profiles?.filter((p: any) => p.status === "active").length  || 0,
        pausedClients:     profiles?.filter((p: any) => p.status === "paused").length  || 0,
        totalSessions:     sessions?.length || 0,
        totalFindings:     findings?.length || 0,
        criticalFindings:  findings?.filter((f: any) => f.risk_level === "КРИТИЧНО").length || 0,
        totalAuditCharges,
        totalUnpaid,
      });
      setLoading(false);
    }
    loadStats();
  }, []);

  const METRIC_CARDS = stats ? [
    { label: "Всего клиентов",      value: stats.totalClients,                    color: "#4d91ff" },
    { label: "Активных клиентов",   value: stats.activeClients,                   color: "#2ecc8f" },
    { label: "Приостановленных",    value: stats.pausedClients,                   color: "#f59e0b" },
    { label: "Аудит-сессий",        value: stats.totalSessions,                   color: "#4d91ff" },
    { label: "Всего нарушений",     value: stats.totalFindings,                   color: "#f59e0b" },
    { label: "Критичных нарушений", value: stats.criticalFindings,                color: "#e84040" },
    { label: "Выручка с клиентов",  value: formatRubles(stats.totalAuditCharges), color: "#2ecc8f" },
    { label: "Не оплачено",         value: formatRubles(stats.totalUnpaid),       color: "#e84040" },
  ] : [];

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "32px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#e8edf8", margin: 0 }}>
          Обзор платформы
        </h1>
        <p style={{ color: "#7a90c0", fontSize: "14px", marginTop: "6px" }}>
          Общая статистика по всем клиентам и аудитам
        </p>
      </div>

      {/* Metric cards */}
      {loading ? (
        <div style={{ color: "#7a90c0", fontSize: "14px" }}>Загрузка статистики...</div>
      ) : (
        <>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "16px",
            marginBottom: "24px",
          }}>
            {METRIC_CARDS.map((card, i) => (
              <div key={i} style={{
                background:   "#0c1220",
                border:       "1px solid #1e2d55",
                borderTop:    `3px solid ${card.color}`,
                borderRadius: "10px",
                padding:      "20px",
              }}>
                <div style={{ fontSize: "13px", color: "#7a90c0", marginBottom: "8px" }}>
                  {card.label}
                </div>
                <div style={{ fontSize: "26px", fontWeight: "700", color: card.color }}>
                  {card.value}
                </div>
              </div>
            ))}
          </div>

          {/* Payment breakdown donut */}
          <div style={{
            background:   "#0c1220",
            border:       "1px solid #1e2d55",
            borderRadius: "10px",
            padding:      "24px",
            marginBottom: "24px",
          }}>
            <h2 style={{ fontSize: "15px", fontWeight: "600", color: "#e8edf8", marginBottom: "20px", marginTop: 0 }}>
              Оплаченность аудитов
            </h2>
            <PaymentDonut
              paid={stats!.totalAuditCharges - stats!.totalUnpaid}
              unpaid={stats!.totalUnpaid}
            />
          </div>
        </>
      )}

      {/* Quick links */}
      <div style={{
        background: "#0c1220", border: "1px solid #1e2d55",
        borderRadius: "10px", padding: "24px",
      }}>
        <h2 style={{ fontSize: "16px", fontWeight: "600", color: "#e8edf8", marginBottom: "16px" }}>
          Быстрые действия
        </h2>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          {[
            { href: "/admin/clients/new", label: "+ Создать клиента",    bg: "#1565e8" },
            { href: "/admin/clients",     label: "Управление клиентами", bg: "#0d1f3e" },
            { href: "/admin/pricing",     label: "Настройка тарифов",    bg: "#0d1f3e" },
          ].map(btn => (
            <a key={btn.href} href={btn.href} style={{
              padding:        "10px 20px",
              background:     btn.bg,
              border:         "1px solid #1e2d55",
              borderRadius:   "8px",
              color:          "#e8edf8",
              fontSize:       "13px",
              fontWeight:     "500",
              textDecoration: "none",
              cursor:         "pointer",
            }}>
              {btn.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
