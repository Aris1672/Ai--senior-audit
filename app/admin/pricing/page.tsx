"use client";

import { useEffect, useState } from "react";
import { formatRubles } from "@/lib/billing";

interface ClientRateRow {
  id:                    string;   // profiles.id (client_id)
  company_name:          string;
  custom_price_rub:      number | null;  // null = uses global default
}

export default function PricingPage() {
  const [globalRate, setGlobalRate]   = useState<number>(0);
  const [rateInput,  setRateInput]    = useState("");
  const [loading,    setLoading]      = useState(true);
  const [saving,     setSaving]       = useState(false);

  const [clients,     setClients]     = useState<ClientRateRow[]>([]);
  const [editingId,   setEditingId]   = useState<string | null>(null);
  const [editValue,   setEditValue]   = useState("");

  async function loadAll() {
    const [settingsRes, clientsRes] = await Promise.all([
      fetch("/api/admin/pricing"),
      fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "admin_client_rates" }),
      }),
    ]);
    const settings = await settingsRes.json();
    const clientRows = await clientsRes.json();

    setGlobalRate(settings.price_per_transaction_rub ?? 0);
    setRateInput(String(settings.price_per_transaction_rub ?? ""));
    setClients(clientRows || []);
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  async function saveGlobalRate() {
    const value = Number(rateInput);
    if (!value || value <= 0) return;
    setSaving(true);
    await fetch("/api/admin/pricing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "global", price_per_transaction_rub: value }),
    });
    await loadAll();
    setSaving(false);
  }

  function startEditClient(row: ClientRateRow) {
    setEditingId(row.id);
    setEditValue(row.custom_price_rub != null ? String(row.custom_price_rub) : "");
  }

  async function saveClientRate(clientId: string) {
    setSaving(true);
    const value = editValue.trim() === "" ? null : Number(editValue);
    await fetch("/api/admin/pricing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "client", clientId, custom_price_rub: value }),
    });
    setEditingId(null);
    await loadAll();
    setSaving(false);
  }

  async function clearClientRate(clientId: string) {
    setSaving(true);
    await fetch("/api/admin/pricing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "client", clientId, custom_price_rub: null }),
    });
    await loadAll();
    setSaving(false);
  }

  const inputStyle = {
    padding: "8px 12px", background: "#101828",
    border: "1px solid #1e2d55", borderRadius: "6px",
    color: "#e8edf8", fontSize: "13px", outline: "none",
    width: "100%", boxSizing: "border-box" as const,
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#e8edf8", margin: 0 }}>
          Тарификация
        </h1>
        <p style={{ color: "#7a90c0", fontSize: "14px", marginTop: "6px" }}>
          Стоимость аудита = количество транзакций × ставка за транзакцию
        </p>
      </div>

      {/* Global rate */}
      <div style={{
        background: "#0c1220", border: "1px solid #1e2d55",
        borderRadius: "10px", padding: "24px", marginBottom: "24px",
      }}>
        <h3 style={{ fontSize: "15px", fontWeight: "600", color: "#e8edf8", margin: "0 0 4px" }}>
          Ставка по умолчанию
        </h3>
        <p style={{ fontSize: "12px", color: "#7a90c0", margin: "0 0 16px" }}>
          Применяется ко всем клиентам без индивидуальной ставки
        </p>
        {loading ? (
          <div style={{ color: "#7a90c0" }}>Загрузка...</div>
        ) : (
          <div style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
            <div style={{ maxWidth: "220px" }}>
              <label style={{ display: "block", fontSize: "12px", color: "#7a90c0", marginBottom: "6px" }}>
                Цена за транзакцию (₽)
              </label>
              <input style={inputStyle} type="number" step="0.01" value={rateInput}
                onChange={e => setRateInput(e.target.value)}
                placeholder="15.00" />
            </div>
            <button onClick={saveGlobalRate} disabled={saving} style={{
              padding: "9px 20px", background: "#1565e8", border: "none",
              borderRadius: "6px", color: "#fff", fontSize: "13px",
              fontWeight: "600", cursor: "pointer",
            }}>
              {saving ? "Сохранение..." : "Сохранить"}
            </button>
            <span style={{ fontSize: "12px", color: "#7a90c0", paddingBottom: "10px" }}>
              Текущая: <strong style={{ color: "#2ecc8f" }}>{formatRubles(globalRate)}</strong> / транзакция
            </span>
          </div>
        )}
      </div>

      {/* Per-client overrides */}
      <div style={{
        background: "#0c1220", border: "1px solid #1e2d55", borderRadius: "10px", overflow: "hidden",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #1e2d55" }}>
          <h3 style={{ fontSize: "15px", fontWeight: "600", color: "#e8edf8", margin: 0 }}>
            Индивидуальные ставки
          </h3>
          <p style={{ fontSize: "12px", color: "#7a90c0", margin: "4px 0 0" }}>
            Переопределяет ставку по умолчанию для конкретного клиента
          </p>
        </div>

        <div style={{
          display: "grid", gridTemplateColumns: "2fr 1.5fr 1.5fr",
          padding: "12px 20px", background: "#080c18",
          borderBottom: "1px solid #1e2d55",
          fontSize: "11px", color: "#3d4f7a", letterSpacing: "0.08em",
        }}>
          <span>КЛИЕНТ</span>
          <span>СТАВКА</span>
          <span>ДЕЙСТВИЯ</span>
        </div>

        {loading ? (
          <div style={{ padding: "32px", textAlign: "center", color: "#7a90c0" }}>Загрузка...</div>
        ) : clients.length === 0 ? (
          <div style={{ padding: "32px", textAlign: "center", color: "#7a90c0" }}>Нет клиентов</div>
        ) : clients.map((row, i) => (
          <div key={row.id} style={{
            display: "grid", gridTemplateColumns: "2fr 1.5fr 1.5fr",
            padding: "14px 20px", alignItems: "center", fontSize: "13px",
            borderBottom: i < clients.length - 1 ? "1px solid #1a2340" : "none",
          }}>
            <span style={{ color: "#e8edf8", fontWeight: "500" }}>{row.company_name}</span>

            {editingId === row.id ? (
              <input style={inputStyle} type="number" step="0.01" value={editValue}
                onChange={e => setEditValue(e.target.value)}
                placeholder={`по умолчанию (${formatRubles(globalRate)})`} />
            ) : row.custom_price_rub != null ? (
              <span style={{ color: "#2ecc8f", fontWeight: "600" }}>
                {formatRubles(row.custom_price_rub)}
              </span>
            ) : (
              <span style={{ color: "#7a90c0" }}>по умолчанию</span>
            )}

            <div style={{ display: "flex", gap: "8px" }}>
              {editingId === row.id ? (
                <>
                  <button onClick={() => saveClientRate(row.id)} disabled={saving} style={{
                    padding: "6px 12px", background: "#1565e8", border: "none",
                    borderRadius: "6px", color: "#fff", fontSize: "12px", cursor: "pointer",
                  }}>
                    Сохранить
                  </button>
                  <button onClick={() => setEditingId(null)} style={{
                    padding: "6px 12px", background: "transparent",
                    border: "1px solid #1e2d55", borderRadius: "6px",
                    color: "#7a90c0", fontSize: "12px", cursor: "pointer",
                  }}>
                    Отмена
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => startEditClient(row)} style={{
                    padding: "6px 12px", background: "#0d1f3e",
                    border: "1px solid #1e2d55", borderRadius: "6px",
                    color: "#4d91ff", fontSize: "12px", cursor: "pointer",
                  }}>
                    Изменить
                  </button>
                  {row.custom_price_rub != null && (
                    <button onClick={() => clearClientRate(row.id)} style={{
                      padding: "6px 12px", background: "#3d1515",
                      border: "1px solid #e84040", borderRadius: "6px",
                      color: "#e84040", fontSize: "12px", cursor: "pointer",
                    }}>
                      Сбросить
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
