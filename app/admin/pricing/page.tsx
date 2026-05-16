"use client";

import { useEffect, useState } from "react";
import { formatRubles } from "@/lib/billing";

interface Tier {
  id:               string;
  name:             string;
  max_transactions: number;
  price_rub:        number;
  description:      string;
  is_active:        boolean;
  sort_order:       number;
}

export default function PricingPage() {
  const [tiers,   setTiers]   = useState<Tier[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving,  setSaving]  = useState(false);
  const [showNew, setShowNew] = useState(false);

  const [editForm, setEditForm] = useState({
    name: "", max_transactions: 0, price_rub: 0, description: "",
  });

  const [newForm, setNewForm] = useState({
    name: "", max_transactions: 0, price_rub: 0, description: "",
  });

  async function loadTiers() {
    const res  = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pricing_tiers_all" }),
    });
    const data = await res.json();
    setTiers(data || []);
    setLoading(false);
  }

  useEffect(() => { loadTiers(); }, []);

  function startEdit(tier: Tier) {
    setEditing(tier.id);
    setEditForm({
      name:             tier.name,
      max_transactions: tier.max_transactions,
      price_rub:        tier.price_rub,
      description:      tier.description || "",
    });
  }

  async function saveEdit(tierId: string) {
    setSaving(true);
    await fetch("/api/admin/pricing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tierId, ...editForm }),
    });
    setEditing(null);
    await loadTiers();
    setSaving(false);
  }

  async function toggleActive(tier: Tier) {
    await fetch("/api/admin/pricing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tierId: tier.id, is_active: !tier.is_active }),
    });
    await loadTiers();
  }

  async function createTier() {
    if (!newForm.name || !newForm.max_transactions || !newForm.price_rub) return;
    setSaving(true);
    await fetch("/api/admin/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newForm),
    });
    setShowNew(false);
    setNewForm({ name: "", max_transactions: 0, price_rub: 0, description: "" });
    await loadTiers();
    setSaving(false);
  }

  async function deleteTier(tierId: string) {
    if (!confirm("Удалить тариф?")) return;
    await fetch("/api/admin/pricing", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tierId }),
    });
    await loadTiers();
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "28px" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#e8edf8", margin: 0 }}>
            Тарифы на аудит
          </h1>
          <p style={{ color: "#7a90c0", fontSize: "14px", marginTop: "6px" }}>
            Цены рассчитываются автоматически по количеству транзакций в базе
          </p>
        </div>
        <button onClick={() => setShowNew(true)} style={{
          padding: "10px 20px", background: "#1565e8",
          border: "none", borderRadius: "8px", color: "#fff",
          fontSize: "14px", fontWeight: "600", cursor: "pointer",
        }}>
          + Новый тариф
        </button>
      </div>

      {/* How pricing works info box */}
      <div style={{
        background: "#0d1f3e", border: "1px solid #1e2d55",
        borderLeft: "3px solid #1565e8", borderRadius: "8px",
        padding: "16px 20px", marginBottom: "24px",
      }}>
        <div style={{ fontSize: "13px", color: "#4d91ff", fontWeight: "600", marginBottom: "6px" }}>
          Как работает тарификация
        </div>
        <div style={{ fontSize: "13px", color: "#7a90c0", lineHeight: "1.6" }}>
          При создании нового аудита система автоматически считает количество транзакций
          в загруженной базе или подключённой 1С и применяет соответствующий тариф.
          Клиент видит цену до начала аудита и подтверждает её.
        </div>
      </div>

      {/* New tier form */}
      {showNew && (
        <div style={{
          background: "#0c1220", border: "1px solid #1565e8",
          borderRadius: "10px", padding: "20px", marginBottom: "20px",
        }}>
          <h3 style={{ fontSize: "15px", fontWeight: "600", color: "#e8edf8", margin: "0 0 16px" }}>
            Новый тариф
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 2fr", gap: "12px", marginBottom: "16px" }}>
            <div>
              <label style={{ display: "block", fontSize: "12px", color: "#7a90c0", marginBottom: "6px" }}>
                Название
              </label>
              <input style={inputStyle} value={newForm.name}
                onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Базовый" />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "12px", color: "#7a90c0", marginBottom: "6px" }}>
                Макс. транзакций
              </label>
              <input style={inputStyle} type="number" value={newForm.max_transactions || ""}
                onChange={e => setNewForm(f => ({ ...f, max_transactions: Number(e.target.value) }))}
                placeholder="500" />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "12px", color: "#7a90c0", marginBottom: "6px" }}>
                Цена (₽)
              </label>
              <input style={inputStyle} type="number" value={newForm.price_rub || ""}
                onChange={e => setNewForm(f => ({ ...f, price_rub: Number(e.target.value) }))}
                placeholder="8000" />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "12px", color: "#7a90c0", marginBottom: "6px" }}>
                Описание
              </label>
              <input style={inputStyle} value={newForm.description}
                onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))}
                placeholder="До 500 транзакций на 1 аудит" />
            </div>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={createTier} disabled={saving} style={{
              padding: "8px 20px", background: "#1565e8", border: "none",
              borderRadius: "6px", color: "#fff", fontSize: "13px",
              fontWeight: "600", cursor: "pointer",
            }}>
              {saving ? "Сохранение..." : "Создать тариф"}
            </button>
            <button onClick={() => setShowNew(false)} style={{
              padding: "8px 16px", background: "transparent",
              border: "1px solid #1e2d55", borderRadius: "6px",
              color: "#7a90c0", fontSize: "13px", cursor: "pointer",
            }}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Tiers table */}
      <div style={{ background: "#0c1220", border: "1px solid #1e2d55", borderRadius: "10px", overflow: "hidden" }}>
        {/* Table header */}
        <div style={{
          display: "grid", gridTemplateColumns: "1.5fr 1.5fr 1.5fr 2fr 1fr 1.5fr",
          padding: "12px 20px", background: "#080c18",
          borderBottom: "1px solid #1e2d55",
          fontSize: "11px", color: "#3d4f7a", letterSpacing: "0.08em",
        }}>
          <span>НАЗВАНИЕ</span>
          <span>МАКС. ТРАНЗАКЦИЙ</span>
          <span>ЦЕНА</span>
          <span>ОПИСАНИЕ</span>
          <span>СТАТУС</span>
          <span>ДЕЙСТВИЯ</span>
        </div>

        {loading ? (
          <div style={{ padding: "32px", textAlign: "center", color: "#7a90c0" }}>Загрузка...</div>
        ) : tiers.map((tier, i) => (
          <div key={tier.id} style={{
            borderBottom: i < tiers.length - 1 ? "1px solid #1a2340" : "none",
          }}>
            {editing === tier.id ? (
              // Edit row
              <div style={{ padding: "16px 20px", background: "#0d1f3e" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 2fr", gap: "12px", marginBottom: "12px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", color: "#7a90c0", marginBottom: "4px" }}>Название</label>
                    <input style={inputStyle} value={editForm.name}
                      onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", color: "#7a90c0", marginBottom: "4px" }}>Макс. транзакций</label>
                    <input style={inputStyle} type="number" value={editForm.max_transactions}
                      onChange={e => setEditForm(f => ({ ...f, max_transactions: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", color: "#7a90c0", marginBottom: "4px" }}>Цена (₽)</label>
                    <input style={inputStyle} type="number" value={editForm.price_rub}
                      onChange={e => setEditForm(f => ({ ...f, price_rub: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", color: "#7a90c0", marginBottom: "4px" }}>Описание</label>
                    <input style={inputStyle} value={editForm.description}
                      onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => saveEdit(tier.id)} disabled={saving} style={{
                    padding: "7px 16px", background: "#1565e8", border: "none",
                    borderRadius: "6px", color: "#fff", fontSize: "12px",
                    fontWeight: "600", cursor: "pointer",
                  }}>
                    {saving ? "..." : "Сохранить"}
                  </button>
                  <button onClick={() => setEditing(null)} style={{
                    padding: "7px 12px", background: "transparent",
                    border: "1px solid #1e2d55", borderRadius: "6px",
                    color: "#7a90c0", fontSize: "12px", cursor: "pointer",
                  }}>
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              // Display row
              <div style={{
                display: "grid", gridTemplateColumns: "1.5fr 1.5fr 1.5fr 2fr 1fr 1.5fr",
                padding: "16px 20px", alignItems: "center", fontSize: "13px",
              }}>
                <span style={{ color: "#e8edf8", fontWeight: "500" }}>{tier.name}</span>
                <span style={{ color: "#4d91ff" }}>
                  до {tier.max_transactions.toLocaleString("ru")}
                </span>
                <span style={{ color: "#2ecc8f", fontWeight: "600" }}>
                  {formatRubles(tier.price_rub)}
                </span>
                <span style={{ color: "#7a90c0", fontSize: "12px" }}>{tier.description}</span>
                <span>
                  <span style={{
                    fontSize: "11px", padding: "3px 10px", borderRadius: "12px",
                    color:       tier.is_active ? "#2ecc8f" : "#7a90c0",
                    background:  tier.is_active ? "#0e3d2a" : "#1a2340",
                    fontWeight: "600",
                  }}>
                    {tier.is_active ? "Активен" : "Отключён"}
                  </span>
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => startEdit(tier)} style={{
                    padding: "6px 12px", background: "#0d1f3e",
                    border: "1px solid #1e2d55", borderRadius: "6px",
                    color: "#4d91ff", fontSize: "12px", cursor: "pointer",
                  }}>
                    Изменить
                  </button>
                  <button onClick={() => toggleActive(tier)} style={{
                    padding: "6px 12px",
                    background:  tier.is_active ? "#3d2e0a" : "#0e3d2a",
                    border:      `1px solid ${tier.is_active ? "#f59e0b" : "#2ecc8f"}`,
                    borderRadius: "6px",
                    color:        tier.is_active ? "#f59e0b" : "#2ecc8f",
                    fontSize: "12px", cursor: "pointer",
                  }}>
                    {tier.is_active ? "Откл." : "Вкл."}
                  </button>
                  <button onClick={() => deleteTier(tier.id)} style={{
                    padding: "6px 12px", background: "#3d1515",
                    border: "1px solid #e84040", borderRadius: "6px",
                    color: "#e84040", fontSize: "12px", cursor: "pointer",
                  }}>
                    ✕
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
