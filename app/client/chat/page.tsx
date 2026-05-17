"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

interface Message { role: "user" | "assistant"; content: string; costRub?: number; }

export default function ChatPage() {
  const [messages,      setMessages]      = useState<Message[]>([]);
  const [input,         setInput]         = useState("");
  const [loading,       setLoading]       = useState(false);
  const [sessionId,     setSessionId]     = useState<string | null>(null);
  const [clientId,      setClientId]      = useState<string | null>(null);
  const [totalCost,     setTotalCost]     = useState(0);
  const [context,       setContext]       = useState<any>(null);
  const [initDone,      setInitDone]      = useState(false);
  const [pendingFile,   setPendingFile]   = useState<File | null>(null);   // file waiting to be sent
  const [uploading,     setUploading]     = useState(false);

  const autoSentRef  = useRef(false);
  const bottomRef    = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const meRes = await fetch("/api/auth/me");
      const { user } = await meRes.json();
      if (!user) return;

      const uid = user.id;
      setClientId(uid);

      const urlSessionId = searchParams.get("session");

      if (urlSessionId) {
        setSessionId(urlSessionId);

        const [ctxRes, msgRes] = await Promise.all([
          fetch("/api/data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "get_session_context",
              payload: { sessionId: urlSessionId },
            }),
          }),
          fetch("/api/data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "client_messages",
              payload: { sessionId: urlSessionId },
            }),
          }),
        ]);

        const ctx  = await ctxRes.json();
        const msgs = await msgRes.json();

        setContext(ctx);
        setMessages(msgs || []);
        setInitDone(true);
        initRef.current = { uid, sessionId: urlSessionId, ctx, msgs: msgs || [] };

      } else {
        const sessionRes = await fetch("/api/data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "get_or_create_session",
            payload: { clientId: uid },
          }),
        });
        const { sessionId: sid, isNew } = await sessionRes.json();
        setSessionId(sid);

        let msgs: Message[] = [];
        if (!isNew) {
          const msgRes = await fetch("/api/data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "client_messages",
              payload: { sessionId: sid },
            }),
          });
          msgs = await msgRes.json() || [];
          setMessages(msgs);
        }

        setInitDone(true);
        initRef.current = { uid, sessionId: sid, ctx: null, msgs };
      }
    }
    init();
  }, []);

  const initRef = useRef<{
    uid: string;
    sessionId: string;
    ctx: any;
    msgs: Message[];
  } | null>(null);

  // ── Auto-send opening message ─────────────────────────────────────────────
  useEffect(() => {
    if (!initDone) return;
    if (autoSentRef.current) return;
    const init = initRef.current;
    if (!init) return;
    if (init.msgs.length > 0) return;

    autoSentRef.current = true;

    const ctx = init.ctx;
    const systemMessage = ctx
      ? `Начат новый аудит.

Клиент: ${ctx.company_name || "не указан"}
ИНН: ${ctx.inn || "не указан"}
Период: ${ctx.period || "не указан"}
Количество транзакций в базе: ${ctx.transactions_ct || 0}
Стоимость аудита зафиксирована: ${ctx.cost_rub || 0} ₽

Файл с финансовыми данными прикреплён к этой сессии — ты получишь его содержимое автоматически. Представься кратко и сразу задай уточняющие вопросы по приоритетам проверки.`
      : `Начат новый сеанс аудита. Представься и спроси, что нужно проверить.`;

    sendAutoMessageDirect(
      systemMessage,
      init.uid,
      init.sessionId,
      ctx ? {
        companyName:      ctx.company_name,
        periodFrom:       ctx.period,
        transactionCount: ctx.transactions_ct,
        openFindings:     0,
        criticalCount:    0,
      } : undefined
    );
  }, [initDone]);

  async function sendAutoMessageDirect(
    content: string,
    uid: string,
    sid: string,
    ctx?: any
  ) {
    setLoading(true);
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId:  uid,
        sessionId: sid,
        context:   ctx,
        messages:  [{ role: "user", content }],
      }),
    });
    const data = await res.json();
    if (data.message) {
      setMessages([{ role: "assistant", content: data.message, costRub: data.costRub }]);
      setTotalCost(prev => prev + (data.costRub || 0));
    }
    setLoading(false);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Handle file selection ─────────────────────────────────────────────────
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setPendingFile(file);
      // Pre-fill input if empty so user knows a file is attached
      if (!input.trim()) {
        setInput(`Загружен документ: ${file.name}. Проанализируй его в контексте текущего аудита.`);
      }
    }
    // Reset input so same file can be re-selected
    e.target.value = "";
  }

  // ── Upload pending file, then send message ────────────────────────────────
  async function uploadAndSend(
    file: File,
    uid: string,
    sid: string,
    messageText: string,
    currentMessages: Message[]
  ) {
    setUploading(true);

    const formData = new FormData();
    formData.append("file",      file);
    formData.append("clientId",  uid);
    formData.append("sessionId", sid);

    const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
    const uploadData = await uploadRes.json();

    setUploading(false);

    if (!uploadRes.ok) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `❌ Ошибка загрузки файла: ${uploadData.error || "неизвестная ошибка"}`,
      }]);
      return;
    }

    // Now send the message — chat route will pick up ALL documents for this session
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId:  uid,
        sessionId: sid,
        context: context ? {
          companyName:      context.company_name,
          periodFrom:       context.period,
          transactionCount: context.transactions_ct,
          openFindings:     0,
          criticalCount:    0,
        } : undefined,
        messages: currentMessages.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    const data = await res.json();
    if (data.message) {
      setMessages(prev => [...prev, {
        role: "assistant", content: data.message, costRub: data.costRub,
      }]);
      setTotalCost(prev => prev + (data.costRub || 0));
    }
  }

  // ── Main send handler ─────────────────────────────────────────────────────
  async function sendMessage() {
    if ((!input.trim() && !pendingFile) || !clientId || !sessionId || loading) return;

    const messageText = input.trim() || `Проанализируй загруженный документ: ${pendingFile?.name}`;
    const userMsg: Message = { role: "user", content: messageText };
    const newMessages = [...messages, userMsg];

    setMessages(newMessages);
    setInput("");
    setPendingFile(null);
    setLoading(true);

    // Reset textarea height
    const ta = document.querySelector("textarea") as HTMLTextAreaElement | null;
    if (ta) ta.style.height = "48px";

    // Save user message to DB
    await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save_message",
        payload: { sessionId, clientId, role: "user", content: messageText },
      }),
    });

    if (pendingFile) {
      // Upload file first, then send — chat route reads ALL session docs
      await uploadAndSend(pendingFile, clientId, sessionId, messageText, newMessages);
    } else {
      // No file — just send message normally
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          sessionId,
          context: context ? {
            companyName:      context.company_name,
            periodFrom:       context.period,
            transactionCount: context.transactions_ct,
            openFindings:     0,
            criticalCount:    0,
          } : undefined,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await res.json();
      if (data.message) {
        setMessages(prev => [...prev, {
          role: "assistant", content: data.message, costRub: data.costRub,
        }]);
        setTotalCost(prev => prev + (data.costRub || 0));
      }
    }

    setLoading(false);
  }

  const sessionLabel = context?.company_name
    ? `Аудит: ${context.company_name}`
    : "ИИ Старший Аудитор";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 64px)" }}>
      {/* Header */}
      <div style={{ marginBottom: "16px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: "700", color: "#e8edf8", margin: 0 }}>
          {sessionLabel}
        </h1>
        <p style={{ color: "#7a90c0", fontSize: "13px", marginTop: "4px" }}>
          Задавайте вопросы на русском языке · Сессия: {totalCost.toFixed(4)} ₽
        </p>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: "auto", background: "#0c1220",
        border: "1px solid #1e2d55", borderRadius: "10px",
        padding: "20px", marginBottom: "16px",
      }}>
        {messages.length === 0 && !loading && (
          <div style={{ textAlign: "center", color: "#3d4f7a", marginTop: "60px" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>◎</div>
            <div style={{ fontSize: "15px", color: "#7a90c0" }}>Инициализация аудита...</div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{
            marginBottom: "16px", display: "flex",
            justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
          }}>
            <div style={{
              maxWidth: "80%", padding: "12px 16px",
              borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
              background: msg.role === "user" ? "#1565e8" : "#101828",
              border: msg.role === "user" ? "none" : "1px solid #1e2d55",
              color: "#e8edf8", fontSize: "14px", lineHeight: "1.6", whiteSpace: "pre-wrap",
            }}>
              {msg.content}
              {msg.costRub && (
                <div style={{ fontSize: "10px", color: "#3d4f7a", marginTop: "6px" }}>
                  {msg.costRub.toFixed(4)} ₽
                </div>
              )}
            </div>
          </div>
        ))}

        {(loading || uploading) && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 0" }}>
            <div style={{ display: "flex", gap: "6px" }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: "8px", height: "8px", borderRadius: "50%", background: "#1565e8",
                  animation: `pulse 1.2s ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
            {uploading && (
              <span style={{ fontSize: "12px", color: "#7a90c0" }}>Загрузка файла...</span>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Pending file badge */}
      {pendingFile && (
        <div style={{
          display: "flex", alignItems: "center", gap: "8px",
          padding: "8px 12px", marginBottom: "8px",
          background: "#0d1f3e", border: "1px solid #1565e8",
          borderRadius: "8px", fontSize: "13px", color: "#7a90c0",
        }}>
          <span>📎</span>
          <span style={{ flex: 1, color: "#e8edf8" }}>{pendingFile.name}</span>
          <span style={{ fontSize: "11px" }}>
            {(pendingFile.size / 1024).toFixed(0)} KB
          </span>
          <button
            onClick={() => { setPendingFile(null); setInput(""); }}
            style={{
              background: "none", border: "none", color: "#7a90c0",
              cursor: "pointer", fontSize: "16px", padding: "0 4px",
            }}
          >×</button>
        </div>
      )}

      {/* Input row */}
      <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.csv,.xml,.xls,.pdf,.docx"
          style={{ display: "none" }}
          onChange={handleFileSelect}
        />

        {/* Attach button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={loading || uploading}
          title="Прикрепить документ"
          style={{
            width: "48px", height: "48px", flexShrink: 0,
            background: pendingFile ? "#0d3a8a" : "#101828",
            border: `1px solid ${pendingFile ? "#1565e8" : "#1e2d55"}`,
            borderRadius: "8px", color: pendingFile ? "#4d91ff" : "#7a90c0",
            fontSize: "20px", cursor: loading ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          📎
        </button>

        {/* Textarea */}
        <textarea
          value={input}
          onChange={e => {
            setInput(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
          }}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder={
            pendingFile
              ? "Добавьте комментарий или нажмите → для отправки..."
              : "Введите вопрос... (Shift+Enter для новой строки)"
          }
          disabled={loading || uploading}
          rows={1}
          style={{
            flex: 1, padding: "13px 16px",
            background: "#0c1220", border: "1px solid #1e2d55",
            borderRadius: "8px", color: "#e8edf8",
            fontSize: "14px", outline: "none",
            resize: "none", overflow: "hidden",
            lineHeight: "1.5", minHeight: "48px", maxHeight: "200px",
            fontFamily: "inherit",
          }}
        />

        {/* Send button */}
        <button
          onClick={sendMessage}
          disabled={loading || uploading || (!input.trim() && !pendingFile)}
          style={{
            width: "48px", height: "48px", flexShrink: 0,
            background: (loading || uploading) ? "#0d3a8a" : "#1565e8",
            border: "none", borderRadius: "8px", color: "#fff",
            fontSize: "18px", fontWeight: "600",
            cursor: (loading || uploading) ? "not-allowed" : "pointer",
          }}
        >
          {loading || uploading ? "…" : "→"}
        </button>
      </div>
    </div>
  );
}
