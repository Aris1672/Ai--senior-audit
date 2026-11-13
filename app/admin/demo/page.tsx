"use client";

// Admin: the demo 1C base switch (lib/demo-1c.ts, app/api/admin/demo-1c).

import { useEffect, useState } from "react";

interface DemoDoc { file: string; round: 1 | 2; title: string; expect: string; size: number | null }

interface DemoState { ready: boolean; enabled: boolean; path: string; base: string; username?: string; password?: string }

export default function DemoPage() {
  const [state, setState] = useState<DemoState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [docs, setDocs] = useState<DemoDoc[]>([]);

  async function load() {
    const res = await fetch("/api/admin/demo-1c");
    const json = await res.json();
    setOrigin(window.location.origin);
    const list = await fetch("/api/admin/demo-1c/documents?list=1").then(r => (r.ok ? r.json() : [])).catch(() => []);
    setDocs(Array.isArray(list) ? list : []);
    if (!res.ok) setError(json.error || "Не удалось получить состояние");
    else setState(json);
  }
  useEffect(() => { load(); }, []);

  async function toggle() {
    if (!state) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/admin/demo-1c", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !state.enabled }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) setError(json.error || "Не удалось переключить");
    await load();
    setBusy(false);
  }

  const row = (label: string, value: string) => (
    <div style={{ display: "flex", gap: "12px", fontSize: "14px", padding: "6px 0", borderBottom: "1px solid #1a2340" }}>
      <span style={{ width: "160px", color: "#7a90c0" }}>{label}</span>
      <code style={{ color: "#e8edf8", userSelect: "all" }}>{value}</code>
    </div>
  );

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", color: "#e8edf8", maxWidth: "760px" }}>
      <h1 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "4px" }}>Демо-база 1С</h1>
      <p style={{ color: "#7a90c0", marginBottom: "24px" }}>
        Вымышленная организация ООО «Вектор-Трейд» за 2025 год (≈ 770 документов, 8 заложенных ошибок) — для демонстраций подключения 1С.
      </p>

      {state && !state.ready && (
        <div style={{ padding: "14px 18px", background: "#2a1416", border: "1px solid #6a2a2e", borderRadius: "10px", marginBottom: "16px", fontSize: "14px" }}>
          Не выполнена миграция <code>supabase/migrations/009_app_settings.sql</code> — выполните её в Supabase SQL Editor, затем обновите страницу.
        </div>
      )}

      {state && (
        <div style={{ background: "#080c18", border: `1px solid ${state.enabled ? "#1f7a4d" : "#1a2340"}`, borderRadius: "10px", padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <div>
              <div style={{ fontSize: "16px", fontWeight: 600 }}>
                {state.enabled ? "🟢 Демо-база включена" : "⚪ Демо-база выключена"}
              </div>
              <div style={{ fontSize: "13px", color: "#7a90c0", marginTop: "4px" }}>
                {state.enabled
                  ? "В мастере нового аудита доступна кнопка «Заполнить данные демо-базы»."
                  : "Адрес демо-базы отвечает «не найдено», в мастере аудита кнопки нет."}
              </div>
            </div>
            <button onClick={toggle} disabled={busy || !state.ready} style={{
              padding: "10px 20px", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600,
              background: state.enabled ? "#3a1f22" : "#1f7a4d", color: state.enabled ? "#ff9a9a" : "#fff",
              cursor: busy || !state.ready ? "default" : "pointer", opacity: busy || !state.ready ? 0.6 : 1,
            }}>
              {busy ? "…" : state.enabled ? "Выключить" : "Включить"}
            </button>
          </div>

          {row("Адрес сервера", `${origin}${state.path}`)}
          {row("Имя базы", state.base)}
          {row("Логин", state.username ?? "odata.user")}
          {row("Пароль", state.enabled ? (state.password ?? "") : "— (видно при включённой базе)")}
          {row("Период", "01.01.2025 – 31.12.2025, ООО, УСН «Доходы минус расходы»")}
        </div>
      )}

      {error && <div style={{ marginTop: "12px", color: "#e84040", fontSize: "13px" }}>{error}</div>}

      {/* Supporting documents for the demonstration (stage 2) */}
      <div style={{ marginTop: "24px", background: "#080c18", border: "1px solid #1a2340", borderRadius: "10px", padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "6px" }}>
          <div style={{ fontSize: "16px", fontWeight: 600 }}>Документы для демонстрации</div>
          <a href="/api/admin/demo-1c/documents" download style={{
            padding: "9px 16px", background: "#1565e8", borderRadius: "8px", color: "#fff",
            fontSize: "13px", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap",
          }}>⬇ Скачать все (ZIP)</a>
        </div>
        <div style={{ fontSize: "13px", color: "#7a90c0", marginBottom: "14px", lineHeight: 1.5 }}>
          Подтверждающие документы той же вымышленной организации — для этапа устранения нарушений.
          Скачайте их на компьютер, с которого идёт демонстрация, и загрузите в чат аудита: сначала документы раунда 1, после ответа ИИ — раунда 2.
        </div>
        {docs.length === 0 && <div style={{ fontSize: "13px", color: "#7a90c0" }}>Загрузка списка…</div>}
        {[1, 2].map(round => docs.some(d => d.round === round) && (
          <div key={round} style={{ marginBottom: "10px" }}>
            <div style={{ fontSize: "12px", color: "#4d91ff", fontWeight: 600, margin: "10px 0 4px" }}>Раунд {round}</div>
            {docs.filter(d => d.round === round).map(d => (
              <div key={d.file} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "8px 0", borderBottom: "1px solid #1a2340" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "14px", color: "#e8edf8" }}>{d.title}</div>
                  <div style={{ fontSize: "12px", color: "#7a90c0" }}>
                    {d.file}{d.size ? ` · ${Math.round(d.size / 1024)} КБ` : " · нет на сервере"} — ожидается: {d.expect}
                  </div>
                </div>
                {d.size && (
                  <a href={`/api/admin/demo-1c/documents?file=${encodeURIComponent(d.file)}`} download={d.file} style={{
                    padding: "6px 12px", border: "1px solid #1e2d55", borderRadius: "6px", color: "#a9b8dc",
                    fontSize: "12px", textDecoration: "none", whiteSpace: "nowrap",
                  }}>⬇ Скачать</a>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div style={{ marginTop: "20px", fontSize: "13px", color: "#7a90c0", lineHeight: 1.6 }}>
        Подключение к демо-базе тарифицируется как обычное (по числу операций по тарифу клиента). После демонстрации выключите базу.
        Пока она включена, данными для подключения может воспользоваться любой вошедший пользователь — данные вымышленные.
      </div>
    </div>
  );
}
