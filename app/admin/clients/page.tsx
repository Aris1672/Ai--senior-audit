"use client";

import { useEffect, useState } from "react";
import { formatRubles } from "@/lib/billing";

interface AuditSession {
  id:         string;
  title:      string;
  status:     string;
  cost_rub:   number;
  created_at: string;
  paid:       boolean;
}

interface Client {
  id:           string;
  full_name:    string;
  company_name: string;
  inn:          string;
  status:       string;
  created_at:   string;
  audit_sessions: AuditSession[];
}

const STATUS_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  active:  { color: "#2ecc8f", bg: "#0e3d2a", label: "Активен"       },
  paused:  { color: "#f59e0b", bg: "#3d2e0a", label: "Приостановлен" },
  deleted: { color: "#e84040", bg: "#3d1515", label: "Удалён"        },
};

export default function AdminClientsPage() {
  const [clients,        setClients]        = useState<Client[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [search,         setSearch]         = useState("");
  const [acting,         setActing]         = useState<string | null>(null);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [togglingPaid,   setTogglingPaid]   = useState<string | null>(null);

  async function loadClients() {
    try {
      const res  = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "admin_clients" }),
      });
      const data = await res.json();
      setClients(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("loadClients error:", err);
      setClients([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadClients(); }, []);

  async function handlePause(clientId: string, currentStatus: string) {
    setActing(clientId);
    const newStatus = currentStatus === "active" ? "paused" : "active";
    await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_client_status", payload: { clientId, status: newStatus } }),
    });
    await loadClients();
    setActing(null);
  }

  async function handleDelete(clientId: string) {
    if (!confirm("Удалить клиента? Это действие необратимо.")) return;
    setActing(clientId);
    await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_client", payload: { clientId } }),
    });
    await loadClients();
    setActing(null);
  }

  async function togglePaid(sessionId: string, currentPaid: boolean) {
    setTogglingPaid(sessionId);
    await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_session_paid",
        payload: { sessionId, paid: !currentPaid },
      }),
    });
    await loadClients();
    setTogglingPaid(null);
  }

  const filtered = clients.filter(c =>
    (c.company_name || "").toLowerCase().includes(search.toLowerCase()) ||
    (c.full_name    || "").toLowerCase().includes(search.toLowerCase()) ||
    (c.inn          || "").includes(search)
  );

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#e8edf8", margin: 0 }}>Клиенты</h1>
          <p style={{ color: "#7a90c0", fontSize: "14px", marginTop: "6px" }}>
            {clients.length} клиентов в системе
          </p>
        </div>
        <a href="/admin/clients/new" style={{
          padding: "10px 20px", background: "#1565e8",
          borderRadius: "8px", color: "#fff",
          fontSize: "14px", fontWeight: "600", textDecoration: "none",
        }}>
          + Новый клиент
        </a>
      </div>

      {/* Search */}
      <input
        placeholder="Поиск по компании, имени или ИНН..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{
          width: "100%", padding: "12px 16px", marginBottom: "20px",
          background: "#0c1220", border: "1px solid #1e2d55",
          borderRadius: "8px", color: "#e8edf8", fontSize: "14px",
          outline: "none", boxSizing: "border-box",
        }}
      />

      {/* Table */}
      {loading ? (
        <div style={{ color: "#7a90c0" }}>Загрузка...</div>
      ) : (
        <div style={{ background: "#0c1220", border: "1px solid #1e2d55", borderRadius: "10px", overflow: "hidden" }}>
          {/* Header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
            padding: "12px 20px",
            background: "#080c18", borderBottom: "1px solid #1e2d55",
            fontSize: "11px", color: "#3d4f7a", letterSpacing: "0.08em",
          }}>
            <span>КОМПАНИЯ</span>
            <span>АУДИТЫ</span>
            <span>ИТОГО</span>
            <span>СТАТУС</span>
            <span>ДЕЙСТВИЯ</span>
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: "32px", textAlign: "center", color: "#7a90c0" }}>
              Клиенты не найдены
            </div>
          ) : filtered.map((client, i) => {
            const st        = STATUS_STYLE[client.status] || STATUS_STYLE.active;
            const sessions  = client.audit_sessions || [];
            const totalCost = sessions.reduce((s, sess) => s + (sess.cost_rub || 0), 0);
            const unpaid    = sessions.filter(s => !s.paid).reduce((s, sess) => s + (sess.cost_rub || 0), 0);
            const isExpanded = expandedClient === client.id;

            return (
              <div key={client.id}>
                {/* Client row — clickable */}
                <div
                  onClick={() => setExpandedClient(isExpanded ? null : client.id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
                    padding: "16px 20px", alignItems: "center",
                    borderBottom: "1px solid #1a2340",
                    fontSize: "13px", cursor: "pointer",
                    background: isExpanded ? "#0d1828" : "transparent",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = "#0d1828"; }}
                  onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = "transparent"; }}
                >
                  {/* Company */}
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ color: "#7a90c0", fontSize: "11px" }}>
                        {isExpanded ? "▼" : "▶"}
                      </span>
                      <div>
                        <div style={{ color: "#e8edf8", fontWeight: "500" }}>
                          {client.company_name || "—"}
                        </div>
                        <div style={{ color: "#7a90c0", fontSize: "12px", marginTop: "2px" }}>
                          {client.full_name || ""}{client.inn ? ` · ИНН ${client.inn}` : ""}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Sessions count */}
                  <div style={{ color: "#e8edf8" }}>{sessions.length}</div>

                  {/* Total + unpaid */}
                  <div>
                    <div style={{ color: "#e8edf8" }}>{formatRubles(totalCost)}</div>
                    {unpaid > 0 && (
                      <div style={{ color: "#e84040", fontSize: "12px" }}>
                        Не оплачено: {formatRubles(unpaid)}
                      </div>
                    )}
                  </div>

                  {/* Status */}
                  <div>
                    <span style={{
                      padding: "4px 10px", borderRadius: "20px",
                      background: st.bg, color: st.color,
                      fontSize: "11px", fontWeight: "600",
                    }}>
                      {st.label}
                    </span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: "8px" }} onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => handlePause(client.id, client.status)}
                      disabled={acting === client.id}
                      style={{
                        padding: "6px 12px", borderRadius: "6px", cursor: "pointer",
                        background: client.status === "active" ? "#3d2e0a" : "#0e3d2a",
                        border: `1px solid ${client.status === "active" ? "#f59e0b" : "#2ecc8f"}`,
                        color:  client.status === "active" ? "#f59e0b" : "#2ecc8f",
                        fontSize: "12px",
                      }}
                    >
                      {client.status === "active" ? "Пауза" : "Активировать"}
                    </button>
                    <button
                      onClick={() => handleDelete(client.id)}
                      disabled={acting === client.id}
                      style={{
                        padding: "6px 12px", borderRadius: "6px", cursor: "pointer",
                        background: "#3d1515", border: "1px solid #e84040",
                        color: "#e84040", fontSize: "12px",
                      }}
                    >
                      Удалить
                    </button>
                  </div>
                </div>

                {/* Expanded audit sessions */}
                {isExpanded && (
                  <div style={{
                    background: "#070b16",
                    borderBottom: "1px solid #1a2340",
                    padding: "0 20px 16px 48px",
                  }}>
                    {sessions.length === 0 ? (
                      <div style={{ color: "#3d4f7a", fontSize: "13px", padding: "16px 0" }}>
                        Аудитов нет
                      </div>
                    ) : (
                      <>
                        {/* Audit table header */}
                        <div style={{
                          display: "grid",
                          gridTemplateColumns: "2fr 1fr 1fr 1fr",
                          padding: "10px 0",
                          fontSize: "11px", color: "#3d4f7a",
                          letterSpacing: "0.08em",
                          borderBottom: "1px solid #1a2340",
                          marginBottom: "4px",
                        }}>
                          <span>АУДИТ</span>
                          <span>ДАТА</span>
                          <span>СТОИМОСТЬ</span>
                          <span>ОПЛАТА</span>
                        </div>

                        {sessions.map(sess => {
                          const isPaid = sess.paid;
                          const date   = new Date(sess.created_at).toLocaleDateString("ru", {
                            day: "numeric", month: "long", year: "numeric",
                          });
                          const companyName = (sess.title || "")
                            .replace(/^Аудит:\s*/, "")
                            .split("(")[0]
                            .trim();

                          return (
                            <div key={sess.id} style={{
                              display: "grid",
                              gridTemplateColumns: "2fr 1fr 1fr 1fr",
                              padding: "10px 0",
                              alignItems: "center",
                              borderBottom: "1px solid #0d1420",
                              fontSize: "13px",
                            }}>
                              {/* Title */}
                              <div style={{ color: "#e8edf8" }}>{companyName || "—"}</div>

                              {/* Date */}
                              <div style={{ color: "#7a90c0", fontSize: "12px" }}>{date}</div>

                              {/* Cost — red if unpaid, green if paid */}
                              <div style={{
                                fontWeight: "600",
                                color: isPaid ? "#2ecc8f" : "#e84040",
                              }}>
                                {formatRubles(sess.cost_rub || 0)}
                              </div>

                              {/* Paid toggle */}
                              <div>
                                <button
                                  onClick={() => togglePaid(sess.id, isPaid)}
                                  disabled={togglingPaid === sess.id}
                                  style={{
                                    padding: "4px 12px", borderRadius: "6px",
                                    cursor: togglingPaid === sess.id ? "not-allowed" : "pointer",
                                    fontSize: "11px", fontWeight: "600",
                                    background: isPaid ? "#0e3d2a" : "#3d1515",
                                    border: `1px solid ${isPaid ? "#2ecc8f" : "#e84040"}`,
                                    color: isPaid ? "#2ecc8f" : "#e84040",
                                  }}
                                >
                                  {togglingPaid === sess.id ? "..." : isPaid ? "✓ Оплачен" : "✗ Не оплачен"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
