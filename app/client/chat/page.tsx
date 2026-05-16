"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

interface Message { role: "user" | "assistant"; content: string; costRub?: number; }

export default function ChatPage() {
  const [messages,  setMessages]  = useState<Message[]>([]);
  const [input,     setInput]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [clientId,  setClientId]  = useState<string | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const [context,   setContext]   = useState<any>(null);
  const [initDone,  setInitDone]  = useState(false);
  const autoSentRef  = useRef(false);   // prevent double auto-send
  const bottomRef    = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();

  // ── Init: load user, session, context, history ──────────────────────────────
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

        // Load context and message history in parallel
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

        // Pass resolved values directly to avoid stale-state race
        setInitDone(true);
        // Store for auto-send trigger below
        initRef.current = { uid, sessionId: urlSessionId, ctx, msgs: msgs || [] };

      } else {
        // No session in URL — get or create a generic one
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

  // Ref to hold resolved init values (avoids stale closure in auto-send)
  const initRef = useRef<{
    uid: string;
    sessionId: string;
    ctx: any;
    msgs: Message[];
  } | null>(null);

  // ── Auto-send opening message once init is done ──────────────────────────────
  useEffect(() => {
    if (!initDone) return;
    if (autoSentRef.current) return;

    const init = initRef.current;
    if (!init) return;

    // Only auto-send if this is a fresh session (no prior messages)
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

    // Call sendAutoMessage with resolved values directly
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

  // ── Send auto opening message (uses direct params, not state) ────────────────
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
        sessionId: sid,       // ← always the resolved value, never null
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

  // ── Scroll to bottom on new messages ─────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Send user message ─────────────────────────────────────────────────────────
  async function sendMessage() {
    if (!input.trim() || !clientId || !sessionId || loading) return;

    const userMsg: Message = { role: "user", content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    // Save user message to DB
    await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save_message",
        payload: { sessionId, clientId, role: "user", content: userMsg.content },
      }),
    });

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
            <div style={{ fontSize: "15px", color: "#7a90c0" }}>
              Инициализация аудита...
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{
            marginBottom: "16px",
            display: "flex",
            justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
          }}>
            <div style={{
              maxWidth:     "80%",
              padding:      "12px 16px",
              borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
              background:   msg.role === "user" ? "#1565e8" : "#101828",
              border:       msg.role === "user" ? "none" : "1px solid #1e2d55",
              color:        "#e8edf8",
              fontSize:     "14px",
              lineHeight:   "1.6",
              whiteSpace:   "pre-wrap",
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

        {loading && (
          <div style={{ display: "flex", gap: "6px", padding: "8px 0" }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: "8px", height: "8px", borderRadius: "50%",
                background: "#1565e8",
                animation: `pulse 1.2s ${i * 0.2}s infinite`,
              }} />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ display: "flex", gap: "10px" }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
          placeholder="Введите вопрос на русском языке..."
          disabled={loading}
          style={{
            flex: 1, padding: "13px 16px",
            background: "#0c1220", border: "1px solid #1e2d55",
            borderRadius: "8px", color: "#e8edf8",
            fontSize: "14px", outline: "none",
          }}
        />
        <button onClick={sendMessage} disabled={loading || !input.trim()} style={{
          padding: "13px 24px", background: loading ? "#0d3a8a" : "#1565e8",
          border: "none", borderRadius: "8px", color: "#fff",
          fontSize: "14px", fontWeight: "600",
          cursor: loading ? "not-allowed" : "pointer",
        }}>
          {loading ? "..." : "→"}
        </button>
      </div>
    </div>
  );
}
