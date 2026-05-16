"use client";

import { createClient } from "@/lib/supabase-client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRubles } from "@/lib/billing";

interface Tier {
  id:               string;
  name:             string;
  max_transactions: number;
  price_rub:        number;
  description:      string;
}

export default function NewClientPage() {
  const [tiers,   setTiers]   = useState<Tier[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const router   = useRouter();
  const supabase = createClient();

  const [form, setForm] = useState({
    email:        "",
    password:     "",
    fullName:     "",
    companyName:  "",
    inn:          "",
    phone:        "",
    tierId:       "",
    auditsCount:  1,
    customPrice:  "",
    customMaxTx:  "",
    validTo:      "",
    notes:        "",
  });

  useEffect(() => {
    supabase.from("pricing_tiers")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => {
        setTiers(data || []);
        if (data?.[0]) setForm(f => ({ ...f, tierId: data[0].id }));
      });
  }, []);

  function update(field: string, value: any) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit() {
    setError("");
    if (!form.email || !form.password || !form.tierId) {
      setError("Email, пароль и тариф обязательны");
      return;
    }
    setLoading(true);

    const res = await fetch("/api/admin/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        customPrice: form.customPrice ? Number(form.customPrice) : null,
        customMaxTx: form.customMaxTx ? Number(form.customMaxTx) : null,
        validTo:     form.validTo || null,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Ошибка создания клиента");
      setLoading(false);
      return;
    }

    router.push("/admin/clients");
  }

  const inputStyle = {
    width: "100%", padding: "11px 14px",
    background: "#101828", border: "1px solid #1e2d55",
    borderRadius: "8px", color: "#e8edf8",
    fontSize: "14px", outline: "none", boxSizing: "border-box" as const,
  };

  const labelStyle = {
    display: "block" as const, fontSize: "13px",
    color: "#7a90c0", marginBottom: "6px",
  };

  return (
    <div style={{ maxWidth: "680px" }}>
      <div style={{ marginBottom: "28px" }}>
        <a href="/admin/clients" style={{ color: "#7a90c0", fontSize: "13px", textDecoration: "none" }}>
          ← Назад к клиентам
        </a>
        <h1 style={{ fontSize: "22px", fontWeight: "700", color: "#e8edf8", margin: "12px 0 4px" }}>
          Новый клиент
        </h1>
        <p style={{ color: "#7a90c0", fontSize: "14px" }}>
          Создайте аккаунт клиента и назначьте тарифный план
        </p>
      </div>

      {error && (
        <div style={{
          background: "#3d1515", border: "1px solid #e84040",
          borderRadius: "8px", padding: "12px 16px",
          marginBottom: "20px", fontSize: "13px", color: "#e84040",
        }}>
          {error}
        </div>
      )}

      {/* Section: Login */}
      <div style={{ background: "#0c1220", border: "1px solid #1e2d55", borderRadius: "10px", padding: "24px", marginBottom: "16px" }}>
        <h2 style={{ fontSize: "14px", fontWeight: "600", color: "#4d91ff", marginBottom: "16px", margin: "0 0 16px" }}>
          Данные для входа
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div>
            <label style={labelStyle}>Email *</label>
            <input style={inputStyle} type="email" value={form.email}
              onChange={e => update("email", e.target.value)} placeholder="client@company.ru" />
          </div>
          <div>
            <label style={labelStyle}>Пароль *</label>
            <input style={inputStyle} type="password" value={form.password}
              onChange={e => update("password", e.target.value)} placeholder="Минимум 6 символов" />
          </div>
        </div>
      </div>

      {/* Section: Company */}
      <div style={{ background: "#0c1220", border: "1px solid #1e2d55", borderRadius: "10px", padding: "24px", marginBottom: "16px" }}>
        <h2 style={{ fontSize: "14px", fontWeight: "600", color: "#4d91ff", margin: "0 0 16px" }}>
          Данные компании
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div>
            <label style={labelStyle}>Название компании</label>
            <input style={inputStyle} value={form.companyName}
              onChange={e => update("companyName", e.target.value)} placeholder='ООО "Компания"' />
          </div>
          <div>
            <label style={labelStyle}>ФИО контакта</label>
            <input style={inputStyle} value={form.fullName}
              onChange={e => update("fullName", e.target.value)} placeholder="Иванов Иван Иванович" />
          </div>
          <div>
            <label style={labelStyle}>ИНН</label>
            <input style={inputStyle} value={form.inn}
              onChange={e => update("inn", e.target.value)} placeholder="7700000000" />
          </div>
          <div>
            <label style={labelStyle}>Телефон</label>
            <input style={inputStyle} value={form.phone}
              onChange={e => update("phone", e.target.value)} placeholder="+7 (999) 000-00-00" />
          </div>
        </div>
      </div>

      {/* Section: Subscription */}
      <div style={{ background: "#0c1220", border: "1px solid #1e2d55", borderRadius: "10px", padding: "24px", marginBottom: "24px" }}>
        <h2 style={{ fontSize: "14px", fontWeight: "600", color: "#4d91ff", margin: "0 0 16px" }}>
          Тарифный план
        </h2>

        {/* Tier selector */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px", marginBottom: "16px" }}>
          {tiers.map(tier => (
            <div key={tier.id} onClick={() => update("tierId", tier.id)} style={{
              padding: "14px", borderRadius: "8px", cursor: "pointer",
              border: form.tierId === tier.id ? "2px solid #1565e8" : "1px solid #1e2d55",
              background: form.tierId === tier.id ? "#0d1f3e" : "#101828",
            }}>
              <div style={{ fontWeight: "600", color: "#e8edf8", fontSize: "14px" }}>{tier.name}</div>
              <div style={{ color: "#4d91ff", fontSize: "18px", fontWeight: "700", margin: "4px 0" }}>
                {formatRubles(tier.price_rub)}
              </div>
              <div style={{ color: "#7a90c0", fontSize: "12px" }}>{tier.description}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginBottom: "16px" }}>
          <div>
            <label style={labelStyle}>Количество аудитов</label>
            <input style={inputStyle} type="number" min={1} value={form.auditsCount}
              onChange={e => update("auditsCount", Number(e.target.value))} />
          </div>
          <div>
            <label style={labelStyle}>Цена override (₽)</label>
            <input style={inputStyle} type="number" value={form.customPrice}
              onChange={e => update("customPrice", e.target.value)}
              placeholder="Оставьте пустым для стандартной" />
          </div>
          <div>
            <label style={labelStyle}>Лимит транзакций override</label>
            <input style={inputStyle} type="number" value={form.customMaxTx}
              onChange={e => update("customMaxTx", e.target.value)}
              placeholder="Оставьте пустым для стандартного" />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div>
            <label style={labelStyle}>Действует до</label>
            <input style={inputStyle} type="date" value={form.validTo}
              onChange={e => update("validTo", e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Заметки (только для админа)</label>
            <input style={inputStyle} value={form.notes}
              onChange={e => update("notes", e.target.value)}
              placeholder="Внутренние комментарии..." />
          </div>
        </div>
      </div>

      {/* Submit */}
      <div style={{ display: "flex", gap: "12px" }}>
        <button onClick={handleSubmit} disabled={loading} style={{
          padding: "12px 28px", background: loading ? "#0d3a8a" : "#1565e8",
          border: "none", borderRadius: "8px", color: "#fff",
          fontSize: "15px", fontWeight: "600",
          cursor: loading ? "not-allowed" : "pointer",
        }}>
          {loading ? "Создание..." : "Создать клиента"}
        </button>
        <a href="/admin/clients" style={{
          padding: "12px 20px", background: "transparent",
          border: "1px solid #1e2d55", borderRadius: "8px",
          color: "#7a90c0", fontSize: "14px", textDecoration: "none",
          display: "flex", alignItems: "center",
        }}>
          Отмена
        </a>
      </div>
    </div>
  );
}