"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { formatRubles } from "@/lib/billing";

type Step = "client-info" | "data-source" | "processing" | "confirm";
type SourceType = "file" | "live_1c";

interface PriceResult {
  transactionCount: number;
  priceRub:         number;
  tierName:         string;
}

export default function NewAuditPage() {
  const [step,       setStep]       = useState<Step>("client-info");
  const [sourceType, setSourceType] = useState<SourceType>("file");
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");
  const [priceResult, setPriceResult] = useState<PriceResult | null>(null);
  const [sessionId,  setSessionId]  = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router  = useRouter();

  const [clientInfo, setClientInfo] = useState({
    companyName: "",
    inn:         "",
    period:      "",
  });

  const [c1Config, setC1Config] = useState({
    url:      "",
    username: "",
    password: "",
    base:     "",
  });

  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  function updateClientInfo(field: string, value: string) {
    setClientInfo(f => ({ ...f, [field]: value }));
  }

  // Step 1 → Step 2
  function handleClientInfoNext() {
    if (!clientInfo.companyName) {
      setError("Введите название компании клиента");
      return;
    }
    setError("");
    setStep("data-source");
  }

  // Step 2 → Step 3: process file
  async function handleFileProcess() {
    if (!uploadedFile) {
      setError("Выберите файл для загрузки");
      return;
    }
    setError("");
    setLoading(true);
    setStep("processing");

    const meRes = await fetch("/api/auth/me");
    const { user } = await meRes.json();
    if (!user) { router.push("/login"); return; }

    // Create audit session first
    const sessionRes = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_audit_session",
        payload: {
          clientId:    user.id,
          companyName: clientInfo.companyName,
          inn:         clientInfo.inn,
          period:      clientInfo.period,
          sourceType:  "file",
        },
      }),
    });
    const { sessionId: sid } = await sessionRes.json();
    setSessionId(sid);

    // Upload and parse file
    const formData = new FormData();
    formData.append("file",      uploadedFile);
    formData.append("clientId",  user.id);
    formData.append("sessionId", sid);

    const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
    const uploadData = await uploadRes.json();

    // Count transactions and get price
    const priceRes = await fetch("/api/audit/calculate-price", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId: uploadData.documentId,
        sessionId:  sid,
        clientId:   user.id,
      }),
    });
    const priceData = await priceRes.json();

    setPriceResult(priceData);
    setLoading(false);
    setStep("confirm");
  }

  // Step 2 → Step 3: process 1C live
  async function handleLiveProcess() {
    if (!c1Config.url || !c1Config.username || !c1Config.password) {
      setError("Заполните все поля подключения к 1С");
      return;
    }
    setError("");
    setLoading(true);
    setStep("processing");

    const meRes = await fetch("/api/auth/me");
    const { user } = await meRes.json();
    if (!user) { router.push("/login"); return; }

    // Create session
    const sessionRes = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_audit_session",
        payload: {
          clientId:    user.id,
          companyName: clientInfo.companyName,
          inn:         clientInfo.inn,
          period:      clientInfo.period,
          sourceType:  "live_1c",
        },
      }),
    });
    const { sessionId: sid } = await sessionRes.json();
    setSessionId(sid);

    // Connect to 1C and count transactions
    const priceRes = await fetch("/api/audit/calculate-price", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sid,
        clientId:  user.id,
        c1Config,
      }),
    });
    const priceData = await priceRes.json();

    if (!priceRes.ok) {
      setError(priceData.error || "Ошибка подключения к 1С");
      setStep("data-source");
      setLoading(false);
      return;
    }

    setPriceResult(priceData);
    setLoading(false);
    setStep("confirm");
  }

  // Step 4: confirm and start audit
  async function handleConfirm() {
    if (!sessionId) return;
    setLoading(true);

    await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "confirm_audit",
        payload: { sessionId, priceRub: priceResult?.priceRub },
      }),
    });

    router.push(`/client/chat?session=${sessionId}`);
  }

  const inputStyle = {
    width: "100%", padding: "11px 14px",
    background: "#101828", border: "1px solid #1e2d55",
    borderRadius: "8px", color: "#e8edf8", fontSize: "14px",
    outline: "none", boxSizing: "border-box" as const,
  };
  const labelStyle = {
    display: "block" as const, fontSize: "13px",
    color: "#7a90c0", marginBottom: "6px",
  };

  return (
    <div style={{ maxWidth: "640px" }}>
      <a href="/client/dashboard" style={{ color: "#7a90c0", fontSize: "13px", textDecoration: "none" }}>
        ← Назад
      </a>
      <h1 style={{ fontSize: "22px", fontWeight: "700", color: "#e8edf8", margin: "12px 0 4px" }}>
        Новый аудит
      </h1>

      {/* Step indicator */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "28px", marginTop: "16px" }}>
        {[
          { key: "client-info", label: "1. Клиент"     },
          { key: "data-source", label: "2. База данных" },
          { key: "processing",  label: "3. Анализ"      },
          { key: "confirm",     label: "4. Подтверждение" },
        ].map(s => (
          <div key={s.key} style={{
            padding: "6px 14px", borderRadius: "20px", fontSize: "12px",
            fontWeight: step === s.key ? "600" : "400",
            background: step === s.key ? "#1565e8" : "#0c1220",
            color:      step === s.key ? "#fff"    : "#7a90c0",
            border:     `1px solid ${step === s.key ? "#1565e8" : "#1e2d55"}`,
          }}>
            {s.label}
          </div>
        ))}
      </div>

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

      {/* ── STEP 1: Client info ── */}
      {step === "client-info" && (
        <div style={{ background: "#0c1220", border: "1px solid #1e2d55", borderRadius: "10px", padding: "24px" }}>
          <h2 style={{ fontSize: "15px", fontWeight: "600", color: "#4d91ff", margin: "0 0 20px" }}>
            Данные клиента (вашего end-клиента)
          </h2>
          <div style={{ display: "grid", gap: "16px" }}>
            <div>
              <label style={labelStyle}>Название компании *</label>
              <input style={inputStyle} value={clientInfo.companyName}
                onChange={e => updateClientInfo("companyName", e.target.value)}
                placeholder='ООО "Ромашка"' />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div>
                <label style={labelStyle}>ИНН клиента</label>
                <input style={inputStyle} value={clientInfo.inn}
                  onChange={e => updateClientInfo("inn", e.target.value)}
                  placeholder="7700000000" />
              </div>
              <div>
                <label style={labelStyle}>Период аудита</label>
                <input style={inputStyle} value={clientInfo.period}
                  onChange={e => updateClientInfo("period", e.target.value)}
                  placeholder="2024 / Q1 2024" />
              </div>
            </div>
          </div>
          <button onClick={handleClientInfoNext} style={{
            marginTop: "24px", padding: "12px 28px",
            background: "#1565e8", border: "none", borderRadius: "8px",
            color: "#fff", fontSize: "14px", fontWeight: "600", cursor: "pointer",
          }}>
            Далее →
          </button>
        </div>
      )}

      {/* ── STEP 2: Data source ── */}
      {step === "data-source" && (
        <div>
          {/* Source type selector */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
            {([
              { type: "file",    label: "Загрузить файл",       sub: "Excel, CSV, XML из 1С", icon: "↑" },
              { type: "live_1c", label: "Подключить 1С напрямую", sub: "OData / REST API",     icon: "⚡" },
            ] as const).map(opt => (
              <div key={opt.type} onClick={() => setSourceType(opt.type)} style={{
                padding: "18px", borderRadius: "10px", cursor: "pointer",
                border:     `2px solid ${sourceType === opt.type ? "#1565e8" : "#1e2d55"}`,
                background:  sourceType === opt.type ? "#0d1f3e" : "#0c1220",
              }}>
                <div style={{ fontSize: "24px", marginBottom: "8px" }}>{opt.icon}</div>
                <div style={{ color: "#e8edf8", fontWeight: "600", fontSize: "14px" }}>{opt.label}</div>
                <div style={{ color: "#7a90c0", fontSize: "12px", marginTop: "4px" }}>{opt.sub}</div>
              </div>
            ))}
          </div>

          {/* File upload */}
          {sourceType === "file" && (
            <div style={{ background: "#0c1220", border: "1px solid #1e2d55", borderRadius: "10px", padding: "24px" }}>
              <h2 style={{ fontSize: "15px", fontWeight: "600", color: "#4d91ff", margin: "0 0 16px" }}>
                Загрузите выгрузку из 1С
              </h2>
              <div
                onClick={() => fileRef.current?.click()}
                style={{
                  border: "2px dashed #1e2d55", borderRadius: "8px",
                  padding: "32px", textAlign: "center", cursor: "pointer",
                  background: uploadedFile ? "#0d1f3e" : "#101828",
                }}>
                <div style={{ fontSize: "28px", marginBottom: "8px" }}>↑</div>
                <div style={{ color: "#e8edf8", fontSize: "14px", marginBottom: "4px" }}>
                  {uploadedFile ? uploadedFile.name : "Нажмите для выбора файла"}
                </div>
                <div style={{ color: "#7a90c0", fontSize: "12px" }}>
                  Excel (.xlsx), CSV, XML из 1С · Максимум 50MB
                </div>
                <input ref={fileRef} type="file" style={{ display: "none" }}
                  accept=".xlsx,.csv,.xml,.xls"
                  onChange={e => setUploadedFile(e.target.files?.[0] || null)} />
              </div>
              <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
                <button onClick={handleFileProcess} disabled={!uploadedFile} style={{
                  padding: "12px 28px", background: uploadedFile ? "#1565e8" : "#0d3a8a",
                  border: "none", borderRadius: "8px", color: "#fff",
                  fontSize: "14px", fontWeight: "600",
                  cursor: uploadedFile ? "pointer" : "not-allowed",
                }}>
                  Загрузить и проанализировать
                </button>
                <button onClick={() => setStep("client-info")} style={{
                  padding: "12px 16px", background: "transparent",
                  border: "1px solid #1e2d55", borderRadius: "8px",
                  color: "#7a90c0", fontSize: "14px", cursor: "pointer",
                }}>
                  ← Назад
                </button>
              </div>
            </div>
          )}

          {/* Live 1C */}
          {sourceType === "live_1c" && (
            <div style={{ background: "#0c1220", border: "1px solid #1e2d55", borderRadius: "10px", padding: "24px" }}>
              <h2 style={{ fontSize: "15px", fontWeight: "600", color: "#4d91ff", margin: "0 0 16px" }}>
                Подключение к 1С:Бухгалтерия
              </h2>
              <div style={{ display: "grid", gap: "14px" }}>
                <div>
                  <label style={labelStyle}>URL сервера 1С *</label>
                  <input style={inputStyle} value={c1Config.url}
                    onChange={e => setC1Config(f => ({ ...f, url: e.target.value }))}
                    placeholder="http://192.168.1.100/accounting" />
                </div>
                <div>
                  <label style={labelStyle}>Имя базы данных</label>
                  <input style={inputStyle} value={c1Config.base}
                    onChange={e => setC1Config(f => ({ ...f, base: e.target.value }))}
                    placeholder="БухгалтерияОсновная" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                  <div>
                    <label style={labelStyle}>Логин *</label>
                    <input style={inputStyle} value={c1Config.username}
                      onChange={e => setC1Config(f => ({ ...f, username: e.target.value }))}
                      placeholder="Администратор" />
                  </div>
                  <div>
                    <label style={labelStyle}>Пароль *</label>
                    <input style={{ ...inputStyle }} type="password" value={c1Config.password}
                      onChange={e => setC1Config(f => ({ ...f, password: e.target.value }))}
                      placeholder="••••••••" />
                  </div>
                </div>
              </div>
              <div style={{
                marginTop: "16px", padding: "12px 16px",
                background: "#0d1f3e", border: "1px solid #1e2d55",
                borderRadius: "8px", fontSize: "12px", color: "#7a90c0",
              }}>
                ⚠️ Убедитесь, что сервер 1С доступен через интернет и включён OData REST API
              </div>
              <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
                <button onClick={handleLiveProcess} style={{
                  padding: "12px 28px", background: "#1565e8",
                  border: "none", borderRadius: "8px", color: "#fff",
                  fontSize: "14px", fontWeight: "600", cursor: "pointer",
                }}>
                  Подключить и проанализировать
                </button>
                <button onClick={() => setStep("client-info")} style={{
                  padding: "12px 16px", background: "transparent",
                  border: "1px solid #1e2d55", borderRadius: "8px",
                  color: "#7a90c0", fontSize: "14px", cursor: "pointer",
                }}>
                  ← Назад
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── STEP 3: Processing ── */}
      {step === "processing" && (
        <div style={{
          background: "#0c1220", border: "1px solid #1e2d55",
          borderRadius: "10px", padding: "48px", textAlign: "center",
        }}>
          <div style={{ fontSize: "40px", marginBottom: "16px" }}>⟳</div>
          <div style={{ color: "#e8edf8", fontSize: "16px", fontWeight: "600", marginBottom: "8px" }}>
            Анализируем базу данных...
          </div>
          <div style={{ color: "#7a90c0", fontSize: "13px" }}>
            Считаем количество транзакций и определяем стоимость аудита
          </div>
        </div>
      )}

      {/* ── STEP 4: Confirm ── */}
      {step === "confirm" && priceResult && (
        <div>
          <div style={{
            background: "#0c1220", border: "1px solid #1e2d55",
            borderRadius: "10px", padding: "24px", marginBottom: "16px",
          }}>
            <h2 style={{ fontSize: "15px", fontWeight: "600", color: "#4d91ff", margin: "0 0 20px" }}>
              Результаты анализа
            </h2>

            {/* Client summary */}
            <div style={{
              background: "#080c18", borderRadius: "8px",
              padding: "16px", marginBottom: "20px",
            }}>
              <div style={{ fontSize: "13px", color: "#7a90c0", marginBottom: "4px" }}>Клиент</div>
              <div style={{ fontSize: "16px", color: "#e8edf8", fontWeight: "600" }}>
                {clientInfo.companyName}
              </div>
              {clientInfo.inn && (
                <div style={{ fontSize: "12px", color: "#7a90c0", marginTop: "2px" }}>
                  ИНН: {clientInfo.inn}
                </div>
              )}
            </div>

            {/* Price breakdown */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "24px" }}>
              {[
                { label: "Транзакций найдено", value: priceResult.transactionCount.toLocaleString("ru"), color: "#4d91ff" },
                { label: "Тарифный план",      value: priceResult.tierName,                              color: "#7a90c0" },
                { label: "Стоимость аудита",   value: formatRubles(priceResult.priceRub),                color: "#2ecc8f" },
              ].map((item, i) => (
                <div key={i} style={{
                  background: "#101828", borderRadius: "8px", padding: "16px",
                  border: "1px solid #1e2d55",
                }}>
                  <div style={{ fontSize: "12px", color: "#7a90c0", marginBottom: "6px" }}>{item.label}</div>
                  <div style={{ fontSize: "18px", fontWeight: "700", color: item.color }}>{item.value}</div>
                </div>
              ))}
            </div>

            {/* Confirm info */}
            <div style={{
              background: "#0d1f3e", border: "1px solid #1565e8",
              borderRadius: "8px", padding: "14px 16px", fontSize: "13px", color: "#7a90c0",
            }}>
              После подтверждения начнётся аудит и вы перейдёте в чат с ИИ Старшим Аудитором.
              Стоимость <strong style={{ color: "#e8edf8" }}>{formatRubles(priceResult.priceRub)}</strong> будет
              зафиксирована за этот аудит.
            </div>
          </div>

          <div style={{ display: "flex", gap: "12px" }}>
            <button onClick={handleConfirm} disabled={loading} style={{
              padding: "13px 32px",
              background: loading ? "#0d3a8a" : "#1565e8",
              border: "none", borderRadius: "8px", color: "#fff",
              fontSize: "15px", fontWeight: "600",
              cursor: loading ? "not-allowed" : "pointer",
            }}>
              {loading ? "Запуск..." : `Подтвердить и начать аудит →`}
            </button>
            <button onClick={() => setStep("data-source")} style={{
              padding: "13px 20px", background: "transparent",
              border: "1px solid #1e2d55", borderRadius: "8px",
              color: "#7a90c0", fontSize: "14px", cursor: "pointer",
            }}>
              ← Назад
            </button>
          </div>
        </div>
      )}
    </div>
  );
}