"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getRiskColor, getRiskBgColor, type RiskLevel } from "@/lib/billing";

interface Finding {
  id:             string;
  risk_level:     RiskLevel;
  title:          string;
  description:    string;
  legal_basis:    string;
  recommendation: string;
  created_at:     string;
}

interface Message {
  role:    "user" | "assistant";
  content: string;
}

interface SessionDetail {
  id:              string;
  title:           string;
  status:          string;
  transactions_ct: number;
  findings_ct:     number;
  cost_rub:        number;
  created_at:      string;
  company_name:    string;
  period:          string;
}

interface AuditDetailData {
  session:  SessionDetail;
  findings: Finding[];
  messages: Message[];
}

const RISK_ORDER: RiskLevel[] = ["КРИТИЧНО", "СУЩЕСТВЕННО", "НЕСУЩЕСТВЕННО"];

const SESSION_STATUS: Record<string, { label: string; color: string }> = {
  active:    { label: "Активна",   color: "#2ecc8f" },
  completed: { label: "Завершена", color: "#7a90c0" },
  archived:  { label: "Архив",     color: "#3d4f7a" },
};

export default function AuditDetailPage() {
  const params   = useParams();
  const router   = useRouter();
  const sessionId = params?.id as string;

  const [data,    setData]    = useState<AuditDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState<"findings" | "chat">("findings");

  useEffect(() => {
    if (!sessionId) return;
    async function load() {
      const res  = await fetch("/api/data", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "audit_detail", payload: { sessionId } }),
      });
      const json = await res.json();
      if (json.session) setData(json);
      setLoading(false);
    }
    load();
  }, [sessionId]);

  if (loading) return (
    <div style={{ color: "#7a90c0", fontFamily: "system-ui, sans-serif", padding: "40px" }}>
      Загрузка аудита...
    </div>
  );
  if (!data) return (
    <div style={{ color: "#e84040", padding: "40px" }}>Аудит не найден.</div>
  );

  const { session, findings, messages } = data;
  const st = SESSION_STATUS[session.status] || SESSION_STATUS.active;

  // Group findings by risk level
  const grouped = RISK_ORDER.reduce<Record<string, Finding[]>>((acc, level) => {
    const items = findings.filter(f => f.risk_level === level);
    if (items.length) acc[level] = items;
    return acc;
  }, {});

  return (
    <div style={{ maxWidth: "1100px" }}>

      {/* Back button */}
      <button
        onClick={() => router.push("/client/dashboard")}
        style={{
          background: "none", border: "none", color: "#7a90c0",
          fontSize: "13px", cursor: "pointer", padding: "0 0 20px 0",
          display: "flex", alignItems: "center", gap: "6px",
        }}
      >
        ← Назад к дашборду
      </button>

      {/* Header card */}
      <div style={{
        background: "#0c1220", border: "1px solid #1e2d55",
        borderRadius: "12px", padding: "24px", marginBottom: "24px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: "700", color: "#e8edf8", margin: "0 0 6px 0" }}>
              {session.company_name}
            </h1>
            {session.period && session.period !== "All periods" && (
              <div style={{ fontSize: "13px", color: "#7a90c0", marginBottom: "12px" }}>
                Период: {session.period}
              </div>
            )}
            <span style={{
              fontSize: "11px", padding: "4px 10px", borderRadius: "12px",
              color: st.color, background: st.color + "22", fontWeight: "600",
            }}>
              {st.label}
            </span>
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            {session.status === "active" && (
              <a href={`/client/chat?session=${session.id}`} style={{
                padding: "10px 20px", background: "#1565e8",
                borderRadius: "8px", color: "#fff",
                fontSize: "13px", fontWeight: "600",
                textDecoration: "none",
              }}>
                Открыть чат →
              </a>
            )}
            <button
              onClick={async () => {
                try {
                  const res = await fetch(`/api/report/${session.id}`);
                  if (!res.ok) throw new Error("Ошибка генерации");
                  const blob = await res.blob();
                  const url  = URL.createObjectURL(blob);
                  const a    = document.createElement("a");
                  a.href     = url;
                  a.download = `Аудит_${session.company_name}_${new Date().toISOString().slice(0,10)}.pdf`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  alert("Не удалось сформировать PDF. Попробуйте ещё раз.");
                }
              }}
              style={{
                padding: "10px 20px", background: "#0d1f3e",
                border: "1px solid #1e2d55",
                borderRadius: "8px", color: "#e8edf8",
                fontSize: "13px", fontWeight: "600",
                cursor: "pointer",
                display: "flex", alignItems: "center", gap: "6px",
              }}
            >
              ↓ Скачать PDF
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: "12px", marginTop: "20px",
        }}>
          {[
            { label: "Нарушений",  value: findings.length, color: findings.length > 0 ? "#e84040" : "#2ecc8f" },
            { label: "Транзакций", value: session.transactions_ct || "—", color: "#4d91ff" },
            { label: "Стоимость",  value: session.cost_rub
                ? session.cost_rub.toLocaleString("ru", { style: "currency", currency: "RUB", maximumFractionDigits: 0 })
                : "—", color: "#f59e0b" },
            { label: "Дата", value: new Date(session.created_at).toLocaleDateString("ru", { day: "numeric", month: "long", year: "numeric" }), color: "#7a90c0" },
          ].map((s, i) => (
            <div key={i} style={{
              background: "#080f1e", borderRadius: "8px", padding: "12px 14px",
              border: "1px solid #1a2340",
            }}>
              <div style={{ fontSize: "11px", color: "#3d4f7a", marginBottom: "4px" }}>{s.label}</div>
              <div style={{ fontSize: "15px", fontWeight: "700", color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "20px" }}>
        {(["findings", "chat"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 20px", borderRadius: "8px", border: "none",
            cursor: "pointer", fontSize: "13px", fontWeight: "600",
            background: tab === t ? "#1565e8" : "#0c1220",
            color:      tab === t ? "#fff"     : "#7a90c0",
            transition: "all 0.15s",
          }}>
            {t === "findings"
              ? `Нарушения (${findings.length})`
              : `История чата (${messages.length})`}
          </button>
        ))}
      </div>

      {/* Findings tab */}
      {tab === "findings" && (
        <div>
          {findings.length === 0 ? (
            <div style={{
              background: "#0c1220", border: "1px solid #1e2d55",
              borderRadius: "12px", padding: "40px",
              textAlign: "center", color: "#3d4f7a", fontSize: "14px",
            }}>
              Нарушений не обнаружено
            </div>
          ) : (
            Object.entries(grouped).map(([level, items]) => (
              <div key={level} style={{ marginBottom: "24px" }}>
                {/* Risk group header */}
                <div style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  marginBottom: "12px",
                }}>
                  <span style={{
                    fontSize: "11px", padding: "4px 12px", borderRadius: "10px",
                    fontWeight: "700",
                    color:      getRiskColor(level as RiskLevel),
                    background: getRiskBgColor(level as RiskLevel),
                  }}>
                    {level}
                  </span>
                  <span style={{ color: "#3d4f7a", fontSize: "12px" }}>
                    {items.length} нарушени{items.length === 1 ? "е" : "й"}
                  </span>
                </div>

                {/* Finding cards */}
                {items.map((f, i) => (
                  <div key={f.id} style={{
                    background: "#0c1220", border: "1px solid #1e2d55",
                    borderLeft: `3px solid ${getRiskColor(level as RiskLevel)}`,
                    borderRadius: "10px", padding: "16px 20px",
                    marginBottom: "10px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
                      <div style={{ fontSize: "14px", fontWeight: "600", color: "#e8edf8", flex: 1 }}>
                        {i + 1}. {f.title}
                      </div>
                    </div>

                    {f.description && (
                      <div style={{ fontSize: "13px", color: "#7a90c0", marginTop: "8px", lineHeight: "1.5" }}>
                        {f.description}
                      </div>
                    )}

                    {f.legal_basis && (
                      <div style={{ fontSize: "12px", color: "#3d4f7a", marginTop: "6px" }}>
                        📋 {f.legal_basis}
                      </div>
                    )}

                    {f.recommendation && (
                      <div style={{
                        marginTop: "10px", padding: "10px 12px",
                        background: "#080f1e", borderRadius: "6px",
                        fontSize: "12px", color: "#4d91ff", lineHeight: "1.5",
                      }}>
                        💡 {f.recommendation}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {/* Chat history tab */}
      {tab === "chat" && (
        <div style={{
          background: "#0c1220", border: "1px solid #1e2d55",
          borderRadius: "12px", padding: "20px",
        }}>
          {messages.length === 0 ? (
            <div style={{ textAlign: "center", color: "#3d4f7a", fontSize: "14px", padding: "40px 0" }}>
              История сообщений пуста
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {messages.map((msg, i) => (
                <div key={i} style={{
                  display: "flex",
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                }}>
                  <div style={{
                    maxWidth: "75%",
                    padding: "12px 16px",
                    borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                    background: msg.role === "user" ? "#1565e8" : "#0d1f3e",
                    border: msg.role === "assistant" ? "1px solid #1e2d55" : "none",
                    fontSize: "13px", lineHeight: "1.6",
                    color: "#e8edf8",
                    whiteSpace: "pre-wrap",
                  }}>
                    {msg.role === "assistant" && (
                      <div style={{ fontSize: "10px", color: "#4d91ff", fontWeight: "700", marginBottom: "6px", letterSpacing: "0.05em" }}>
                        ИИ АУДИТОР
                      </div>
                    )}
                    {msg.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
