"use client";

import { createClient } from "@/lib/supabase-client";
import { useEffect, useState } from "react";
import { formatRubles } from "@/lib/billing";

interface Client {
  id:           string;
  full_name:    string;
  company_name: string;
  inn:          string;
  status:       string;
  created_at:   string;
  client_subscriptions: {
    audits_purchased: number;
    audits_used:      number;
    custom_price_rub: number | null;
    pricing_tiers:    { name: string; price_rub: number } | null;
  }[];
  audit_sessions: {
    id:     string;
    status: string;
    cost_rub: number;
  }[];
}

const STATUS_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  active:  { color: "#2ecc8f", bg: "#0e3d2a", label: "Активен"       },
  paused:  { color: "#f59e0b", bg: "#3d2e0a", label: "Приостановлен" },
  deleted: { color: "#e84040", bg: "#3d1515", label: "Удалён"        },
};

export default function AdminClientsPage() {
  const [clients, setClients]   = useState<Client[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search,  setSearch]    = useState("");
  const [acting,  setActing]    = useState<string | null>(null);
  const supabase = createClient();

  async function loadClients() {
    const { data } = await supabase
      .from("profiles")
      .select(`
        id, full_name, company_name, inn, status, created_at,
        client_subscriptions (
          audits_purchased, audits_used, custom_price_rub,
          pricing_tiers ( name, price_rub )
        ),
        audit_sessions ( id, status, cost_rub )
      `)
      .eq("role", "client")
      .neq("status", "deleted")
      .order("created_at", { ascending: false });

    setClients((data as any) || []);
    setLoading(false);
  }

  useEffect(() => { loadClients(); }, []);

  async function handlePause(clientId: string, currentStatus: string) {
    setActing(clientId);
    const newStatus = currentStatus === "active" ? "paused" : "active";
    await fetch("/api/admin/clients", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, status: newStatus }),
    });
    await loadClients();
    setActing(null);
  }

  async function handleDelete(clientId: string) {
    if (!confirm("Удалить клиента? Это действие необратимо.")) return;
    setActing(clientId);
    await fetch("/api/admin/clients", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId }),
    });
    await loadClients();
    setActing(null);
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
          <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#e8edf8", margin: 0 }}>
            Клиенты
          </h1>
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
          {/* Table header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr 1fr",
            padding: "12px 20px",
            background: "#080c18", borderBottom: "1px solid #1e2d55",
            fontSize: "11px", color: "#3d4f7a", letterSpacing: "0.08em",
          }}>
            <span>КОМПАНИЯ</span>
            <span>ТАРИФ</span>
            <span>АУДИТЫ</span>
            <span>СЕССИИ</span>
            <span>СТАТУС</span>
            <span>ДЕЙСТВИЯ</span>
          </div>

          {/* Rows */}
          {filtered.length === 0 ? (
            <div style={{ padding: "32px", textAlign: "center", color: "#7a90c0" }}>
              Клиенты не найдены
            </div>
          ) : filtered.map((client, i) => {
            const sub    = client.client_subscriptions?.[0];
            const tier   = sub?.pricing_tiers;
            const st     = STATUS_STYLE[client.status] || STATUS_STYLE.active;
            const totalCost = client.audit_sessions?.reduce((s, sess) => s + (sess.cost_rub || 0), 0) || 0;

            return (
              <div key={client.id} style={{
                display: "grid",
                gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr 1fr",
                padding: "16px 20px", alignItems: "center",
                borderBottom: i < filtered.length - 1 ? "1px solid #1a2340" : "none",
                fontSize: "13px",
              }}>
                {/* Company */}
                <div>
                  <div style={{ color: "#e8edf8", fontWeight: "500" }}>
                    {client.company_name || "—"}
                  </div>
                  <div style={{ color: "#7a90c0", fontSize: "12px", marginTop: "2px" }}>
                    {client.full_name || ""} {client.inn ? `· ИНН ${client.inn}` : ""}
                  </div>
                </div>

                {/* Tier */}
                <div>
                  <div style={{ color: "#4d91ff", fontWeight: "500" }}>
                    {tier?.name || "—"}
                  </div>
                  <div style={{ color: "#7a90c0", fontSize: "12px" }}>
                    {formatRubles(sub?.custom_price_rub ?? tier?.price_rub ?? 0)}
                  </div>
                </div>

                {/* Audits */}
                <div style={{ color: "#e8edf8" }}>
                  {sub ? `${sub.audits_used} / ${sub.audits_purchased}` : "—"}
                </div>

                {/* Sessions + cost */}
                <div>
                  <div style={{ color: "#e8edf8" }}>{client.audit_sessions?.length || 0}</div>
                  <div style={{ color: "#7a90c0", fontSize: "12px" }}>{formatRubles(totalCost)}</div>
                </div>

                {/* Status badge */}
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
                <div style={{ display: "flex", gap: "8px" }}>
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
            );
          })}
        </div>
      )}
    </div>
  );
}