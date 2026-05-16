"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewClientPage() {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const router = useRouter();

  const [form, setForm] = useState({
    email:       "",
    password:    "",
    fullName:    "",
    companyName: "",
    inn:         "",
    phone:       "",
    notes:       "",
  });

  function update(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit() {
    setError("");
    if (!form.email || !form.password) {
      setError("Email и пароль обязательны");
      return;
    }
    if (form.password.length < 6) {
      setError("Пароль должен содержать минимум 6 символов");
      return;
    }
    setLoading(true);

    const res  = await fetch("/api/admin/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
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
    <div style={{ maxWidth: "620px" }}>
      {/* Back link */}
      <a href="/admin/clients" style={{ color: "#7a90c0", fontSize: "13px", textDecoration: "none" }}>
        ← Назад к клиентам
      </a>

      <h1 style={{ fontSize: "22px", fontWeight: "700", color: "#e8edf8", margin: "12px 0 4px" }}>
        Новый клиент
      </h1>
      <p style={{ color: "#7a90c0", fontSize: "14px", marginBottom: "28px" }}>
        Создайте аккаунт для бухгалтерской компании. Стоимость аудитов рассчитывается
        автоматически по количеству транзакций при каждом аудите.
      </p>

      {/* Error */}
      {error && (
        <div style={{
          background: "#3d1515", border: "1px solid #e84040",
          borderRadius: "8px", padding: "12px 16px",
          marginBottom: "20px", fontSize: "13px", color: "#e84040",
        }}>
          {error}
        </div>
      )}

      {/* Login credentials */}
      <div style={{
        background: "#0c1220", border: "1px solid #1e2d55",
        borderRadius: "10px", padding: "24px", marginBottom: "16px",
      }}>
        <h2 style={{ fontSize: "14px", fontWeight: "600", color: "#4d91ff", margin: "0 0 16px" }}>
          Данные для входа
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div>
            <label style={labelStyle}>Email *</label>
            <input style={inputStyle} type="email" value={form.email}
              onChange={e => update("email", e.target.value)}
              placeholder="accountant@company.ru" />
          </div>
          <div>
            <label style={labelStyle}>Пароль *</label>
            <input style={inputStyle} type="password" value={form.password}
              onChange={e => update("password", e.target.value)}
              placeholder="Минимум 6 символов" />
          </div>
        </div>
      </div>

      {/* Company details */}
      <div style={{
        background: "#0c1220", border: "1px solid #1e2d55",
        borderRadius: "10px", padding: "24px", marginBottom: "16px",
      }}>
        <h2 style={{ fontSize: "14px", fontWeight: "600", color: "#4d91ff", margin: "0 0 16px" }}>
          Данные компании
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div>
            <label style={labelStyle}>Название компании</label>
            <input style={inputStyle} value={form.companyName}
              onChange={e => update("companyName", e.target.value)}
              placeholder='ООО "Бухгалтер Про"' />
          </div>
          <div>
            <label style={labelStyle}>ФИО контакта</label>
            <input style={inputStyle} value={form.fullName}
              onChange={e => update("fullName", e.target.value)}
              placeholder="Иванов Иван Иванович" />
          </div>
          <div>
            <label style={labelStyle}>ИНН</label>
            <input style={inputStyle} value={form.inn}
              onChange={e => update("inn", e.target.value)}
              placeholder="7700000000" />
          </div>
          <div>
            <label style={labelStyle}>Телефон</label>
            <input style={inputStyle} value={form.phone}
              onChange={e => update("phone", e.target.value)}
              placeholder="+7 (999) 000-00-00" />
          </div>
        </div>
      </div>

      {/* Notes */}
      <div style={{
        background: "#0c1220", border: "1px solid #1e2d55",
        borderRadius: "10px", padding: "24px", marginBottom: "24px",
      }}>
        <h2 style={{ fontSize: "14px", fontWeight: "600", color: "#4d91ff", margin: "0 0 16px" }}>
          Заметки (только для админа)
        </h2>
        <textarea
          value={form.notes}
          onChange={e => update("notes", e.target.value)}
          placeholder="Внутренние комментарии о клиенте..."
          rows={3}
          style={{
            ...inputStyle,
            resize: "vertical", fontFamily: "system-ui, sans-serif",
          }}
        />
      </div>

      {/* Pricing info box */}
      <div style={{
        background: "#0d1f3e", border: "1px solid #1e2d55",
        borderLeft: "3px solid #1565e8", borderRadius: "8px",
        padding: "14px 18px", marginBottom: "24px",
      }}>
        <div style={{ fontSize: "12px", color: "#4d91ff", fontWeight: "600", marginBottom: "6px" }}>
          Тарификация по факту аудита
        </div>
        <div style={{ fontSize: "12px", color: "#7a90c0", lineHeight: "1.6" }}>
          Стоимость каждого аудита рассчитывается автоматически при создании аудита
          на основе количества транзакций в базе данных клиента.
          Текущий прайс-лист можно посмотреть в разделе <a href="/admin/pricing"
          style={{ color: "#4d91ff" }}>Тарифы</a>.
        </div>
      </div>

      {/* Submit */}
      <div style={{ display: "flex", gap: "12px" }}>
        <button onClick={handleSubmit} disabled={loading} style={{
          padding: "12px 28px",
          background: loading ? "#0d3a8a" : "#1565e8",
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