"use client";


import { useEffect, useState } from "react";
import { formatRubles } from "@/lib/billing";

interface UsageEvent {
  id:          string;
  event_type:  string;
  tokens_in:   number;
  tokens_out:  number;
  cost_rub:    number;
  created_at:  string;
}

const EVENT_LABELS: Record<string, string> = {
  ai_message:       "ИИ-ответ",
  document_upload:  "Загрузка документа",
  document_parse:   "Обработка документа",
};

export default function UsagePage() {
  const [events,    setEvents]    = useState<UsageEvent[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [totalCost, setTotalCost] = useState(0);
  const [totalIn,   setTotalIn]   = useState(0);
  const [totalOut,  setTotalOut]  = useState(0);
  

useEffect(() => {
  async function load() {
    // Get user via Vercel — not directly from Russia to Supabase
    const meRes = await fetch("/api/auth/me");
    const { user } = await meRes.json();
    if (!user) return;

    const dataRes = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "client_usage", payload: { clientId: user.id } }),
    });
    const evts = await dataRes.json() as UsageEvent[];
    setEvents(evts);
    setTotalCost(evts.reduce((s, e) => s + (e.cost_rub  || 0), 0));
    setTotalIn(  evts.reduce((s, e) => s + (e.tokens_in || 0), 0));
    setTotalOut( evts.reduce((s, e) => s + (e.tokens_out|| 0), 0));
    setLoading(false);
  }
  load();
}, []);

  return (
    <div>
      <div style={{ marginBottom: "28px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#e8edf8", margin: 0 }}>
          Расходы и использование
        </h1>
        <p style={{ color: "#7a90c0", fontSize: "14px", marginTop: "6px" }}>
          Детализация использования ИИ-агента в реальном времени
        </p>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "28px" }}>
        {[
          { label: "Общие расходы (₽)",    value: formatRubles(totalCost), color: "#f59e0b" },
          { label: "Входящих токенов",      value: totalIn.toLocaleString("ru"),  color: "#4d91ff" },
          { label: "Исходящих токенов",     value: totalOut.toLocaleString("ru"), color: "#2ecc8f" },
        ].map((card, i) => (
          <div key={i} style={{
            background: "#0c1220", border: "1px solid #1e2d55",
            borderTop: `3px solid ${card.color}`, borderRadius: "10px", padding: "20px",
          }}>
            <div style={{ fontSize: "12px", color: "#7a90c0", marginBottom: "8px" }}>{card.label}</div>
            <div style={{ fontSize: "24px", fontWeight: "700", color: card.color }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Events log */}
      <div style={{ background: "#0c1220", border: "1px solid #1e2d55", borderRadius: "10px", overflow: "hidden" }}>
        <div style={{
          display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr 1fr",
          padding: "12px 20px", background: "#080c18",
          borderBottom: "1px solid #1e2d55",
          fontSize: "11px", color: "#3d4f7a", letterSpacing: "0.08em",
        }}>
          <span>СОБЫТИЕ</span><span>ТОКЕНЫ ВХ.</span>
          <span>ТОКЕНЫ ИСХ.</span><span>СТОИМОСТЬ</span><span>ВРЕМЯ</span>
        </div>

        {loading ? (
          <div style={{ padding: "32px", textAlign: "center", color: "#7a90c0" }}>Загрузка...</div>
        ) : events.length === 0 ? (
          <div style={{ padding: "32px", textAlign: "center", color: "#7a90c0" }}>
            Событий пока нет
          </div>
        ) : events.map((evt, i) => (
          <div key={evt.id} style={{
            display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr 1fr",
            padding: "13px 20px", alignItems: "center",
            borderBottom: i < events.length - 1 ? "1px solid #1a2340" : "none",
            fontSize: "13px",
          }}>
            <span style={{ color: "#e8edf8" }}>
              {EVENT_LABELS[evt.event_type] || evt.event_type}
            </span>
            <span style={{ color: "#4d91ff" }}>{(evt.tokens_in  || 0).toLocaleString("ru")}</span>
            <span style={{ color: "#2ecc8f" }}>{(evt.tokens_out || 0).toLocaleString("ru")}</span>
            <span style={{ color: "#f59e0b", fontWeight: "600" }}>
              {formatRubles(evt.cost_rub || 0)}
            </span>
            <span style={{ color: "#7a90c0", fontSize: "12px" }}>
              {new Date(evt.created_at).toLocaleString("ru")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}