"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";

interface Message { role: "user" | "assistant"; content: string; costRub?: number; }

// ── Markdown rendering for assistant messages ──────────────────────────────
// Added to fix the "flat" chat feel: report headers (## Резюме аудитора),
// finding subheaders (### Нарушение: ...), and bold labels (**Уровень
// риска:**) were previously shown as literal markdown syntax because
// messages rendered as plain text. Only applied to FINISHED assistant
// messages — the actively-typing message still renders as plain text via
// TypewriterMessage, since partial/unclosed markdown (e.g. "**Провер")
// mid-animation would render incorrectly. User messages also stay plain
// text; they're never markdown.
const markdownComponents = {
  h1: (props: any) => (
    <h1 style={{
      fontSize: "17px", fontWeight: 800, color: "#e8edf8",
      margin: "0 0 12px 0", paddingBottom: "8px",
      borderBottom: "1px solid #1e2d55",
    }} {...props} />
  ),
  h2: (props: any) => (
    <h2 style={{
      fontSize: "14px", fontWeight: 700, color: "#4d91ff",
      textTransform: "uppercase", letterSpacing: "0.03em",
      margin: "18px 0 10px 0",
    }} {...props} />
  ),
  h3: (props: any) => (
    <h3 style={{
      fontSize: "14px", fontWeight: 700, color: "#e8edf8",
      margin: "14px 0 8px 0", paddingLeft: "10px",
      borderLeft: "3px solid #1565e8",
    }} {...props} />
  ),
  p: (props: any) => (
    <p style={{ margin: "0 0 10px 0", lineHeight: "1.6" }} {...props} />
  ),
  strong: (props: any) => (
    <strong style={{ color: "#a9c1f0", fontWeight: 700 }} {...props} />
  ),
  ul: (props: any) => (
    <ul style={{ margin: "0 0 10px 0", paddingLeft: "20px" }} {...props} />
  ),
  ol: (props: any) => (
    <ol style={{ margin: "0 0 10px 0", paddingLeft: "20px" }} {...props} />
  ),
  li: (props: any) => (
    <li style={{ marginBottom: "5px", lineHeight: "1.55" }} {...props} />
  ),
  hr: (props: any) => (
    <hr style={{ border: "none", borderTop: "1px solid #1e2d55", margin: "16px 0" }} {...props} />
  ),
  code: (props: any) => (
    <code style={{
      background: "#0c1220", padding: "2px 6px", borderRadius: "4px",
      fontSize: "13px", color: "#8fb3f5",
    }} {...props} />
  ),
};

// ── Typewriter component ───────────────────────────────────────────────────
function TypewriterMessage({ text, onDone, onScroll }: { 
  text: string; onDone: () => void; onScroll: () => void; 
}) {
  const [displayed, setDisplayed] = useState("");
  const indexRef = useRef(0);
  const rafRef   = useRef(0);

  useEffect(() => {
    indexRef.current = 0;
    setDisplayed("");

    const INTERVAL    = 18; // ms per tick (unchanged — this is the frame-safe interval)
    const CHARS_PER_TICK = 2; // 2x speed: advance 2 characters per tick instead of 1
    let last = 0;

    function tick(ts: number) {
      if (ts - last >= INTERVAL) {
        last = ts;
        if (indexRef.current < text.length) {
          indexRef.current = Math.min(indexRef.current + CHARS_PER_TICK, text.length);
          setDisplayed(text.slice(0, indexRef.current));
          onScroll(); // ← scroll on every tick
        } else {
          onDone();
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [text]);

  return (
    <>
      {displayed}
      {displayed.length < text.length && (
        <span style={{
          display: "inline-block", width: "2px", height: "1em",
          background: "#4d91ff", marginLeft: "2px",
          verticalAlign: "text-bottom",
          animation: "cursorBlink 0.7s steps(1) infinite",
        }} />
      )}
    </>
  );
}

export default function ChatPage() {
  const [messages,       setMessages]       = useState<Message[]>([]);
  const [input,          setInput]          = useState("");
  const [loading,        setLoading]        = useState(false);
  const [sessionId,      setSessionId]      = useState<string | null>(null);
  const [clientId,       setClientId]       = useState<string | null>(null);
  const [totalCost,      setTotalCost]      = useState(0);
  const [context,        setContext]        = useState<any>(null);
  const [initDone,       setInitDone]       = useState(false);
  const [pendingFile,    setPendingFile]    = useState<File | null>(null);
  const [uploading,      setUploading]      = useState(false);
  const [auditCompleted, setAuditCompleted] = useState(false);
  // index of the message currently being typewritten (-1 = none)
  const [typingIndex,    setTypingIndex]    = useState(-1);

  const autoSentRef  = useRef(false);
  const bottomRef    = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();
  const router = useRouter();

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
            body: JSON.stringify({ action: "get_session_context", payload: { sessionId: urlSessionId } }),
          }),
          fetch("/api/data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "client_messages", payload: { sessionId: urlSessionId } }),
          }),
        ]);

        const ctx  = await ctxRes.json();
        const msgs = await msgRes.json();

        setContext(ctx);
        setMessages(msgs || []);
        if (ctx?.status === "completed") setAuditCompleted(true);
        setInitDone(true);
        initRef.current = { uid, sessionId: urlSessionId, ctx, msgs: msgs || [] };

      } else {
        // No ?session= in the URL — previously fell back to
        // get_or_create_session, which creates an audit_sessions row with
        // NO tax-profile fields (legal_form/tax_regime/vat_status all
        // null). That session could never reach full analysis anyway
        // (confirm_audit's defense-in-depth check blocks it), so it just
        // produced a dead end. Redirecting to the wizard instead means the
        // ONLY way to reach this page is via the wizard's confirm_audit
        // success redirect — i.e. every session on this page is guaranteed
        // to have passed the tax-profile gate. See PROJECT_STATUS.md.
        router.replace("/client/audit/new");
        return;
      }
    }
    init();
  }, []);

  const initRef = useRef<{ uid: string; sessionId: string; ctx: any; msgs: Message[]; } | null>(null);

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
      ? `Начат новый аудит.\n\nКлиент: ${ctx.company_name || "не указан"}\nИНН: ${ctx.inn || "не указан"}\nПериод: ${ctx.period || "не указан"}\nКоличество транзакций в базе: ${ctx.transactions_ct || 0}\nСтоимость аудита зафиксирована: ${ctx.cost_rub || 0} ₽\n\nФайл с финансовыми данными прикреплён к этой сессии — ты получишь его содержимое автоматически. Представься кратко и сразу задай уточняющие вопросы по приоритетам проверки.`
      : `Начат новый сеанс аудита. Представься и спроси, что нужно проверить.`;

    sendAutoMessageDirect(
      systemMessage, init.uid, init.sessionId,
      ctx ? {
        companyName: ctx.company_name, periodFrom: ctx.period,
        transactionCount: ctx.transactions_ct, openFindings: 0, criticalCount: 0,
        legalForm: ctx.legal_form_display, taxRegime: ctx.tax_regime_display, vatStatus: ctx.vat_status,
      } : undefined
    );
  }, [initDone]);

  // ── Helper: push assistant reply and start typewriter ────────────────────
  function pushAssistantReply(content: string, costRub?: number) {
    setMessages(prev => {
      const next = [...prev, { role: "assistant" as const, content, costRub }];
      setTypingIndex(next.length - 1); // typewrite the last message
      return next;
    });
    setTotalCost(prev => prev + (costRub || 0));
  }

  async function sendAutoMessageDirect(content: string, uid: string, sid: string, ctx?: any) {
    setLoading(true);
    const res  = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: uid, sessionId: sid, context: ctx, messages: [{ role: "user", content }] }),
    });
    const data = await res.json();
    if (data.message) pushAssistantReply(data.message, data.costRub);
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
      if (!input.trim()) setInput(`Загружен документ: ${file.name}. Проанализируй его в контексте текущего аудита.`);
    }
    e.target.value = "";
  }

  // ── Upload pending file, then send ───────────────────────────────────────
  async function uploadAndSend(file: File, uid: string, sid: string, messageText: string, currentMessages: Message[]) {
    setUploading(true);

    const formData = new FormData();
    formData.append("file",      file);
    formData.append("clientId",  uid);
    formData.append("sessionId", sid);

    const uploadRes  = await fetch("/api/upload", { method: "POST", body: formData });
    const uploadData = await uploadRes.json();
    setUploading(false);

    if (!uploadRes.ok) {
      pushAssistantReply(`❌ Ошибка загрузки файла: ${uploadData.error || "неизвестная ошибка"}`);
      return;
    }

    const res  = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: uid, sessionId: sid,
        context: context ? {
          companyName: context.company_name, periodFrom: context.period,
          transactionCount: context.transactions_ct, openFindings: 0, criticalCount: 0,
          legalForm: context.legal_form_display, taxRegime: context.tax_regime_display, vatStatus: context.vat_status,
        } : undefined,
        messages: currentMessages.map(m => ({ role: m.role, content: m.content })),
      }),
    });
    const data = await res.json();
    if (data.message) pushAssistantReply(data.message, data.costRub);
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

    const ta = document.querySelector("textarea") as HTMLTextAreaElement | null;
    if (ta) ta.style.height = "48px";

    await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_message", payload: { sessionId, clientId, role: "user", content: messageText } }),
    });

    if (pendingFile) {
      await uploadAndSend(pendingFile, clientId, sessionId, messageText, newMessages);
    } else {
      const res  = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId, sessionId,
          context: context ? {
            companyName: context.company_name, periodFrom: context.period,
            transactionCount: context.transactions_ct, openFindings: 0, criticalCount: 0,
            legalForm: context.legal_form_display, taxRegime: context.tax_regime_display, vatStatus: context.vat_status,
          } : undefined,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (data.message) pushAssistantReply(data.message, data.costRub);
    }

    setLoading(false);
  }

  // ── Complete audit ────────────────────────────────────────────────────────
  async function completeAudit() {
    if (!sessionId || !clientId || auditCompleted) return;
    const confirmed = window.confirm("Завершить аудит? После завершения чат останется доступен только для чтения.");
    if (!confirmed) return;

    await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_session_status", payload: { sessionId, status: "completed" } }),
    });

    setAuditCompleted(true);
    pushAssistantReply("✅ Аудит завершён. Спасибо за использование ИИ Старшего Аудитора. Результаты и нарушения сохранены в вашем дашборде.");
  }

  const sessionLabel = context?.company_name ? `Аудит: ${context.company_name}` : "ИИ Старший Аудитор";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 64px)" }}>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 0.2; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }
        @keyframes cursorBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h1 style={{ fontSize: "20px", fontWeight: "700", color: "#e8edf8", margin: 0 }}>{sessionLabel}</h1>
            {auditCompleted && (
              <span style={{ fontSize: "11px", padding: "3px 10px", borderRadius: "12px", background: "#7a90c022", color: "#7a90c0", fontWeight: "600" }}>
                Завершён
              </span>
            )}
          </div>
          <p style={{ color: "#7a90c0", fontSize: "13px", marginTop: "4px" }}>Задавайте вопросы на русском языке</p>
        </div>
        {!auditCompleted && initDone && (
          <button onClick={completeAudit} disabled={loading || uploading || auditCompleted} style={{
            padding: "8px 16px", background: "transparent",
            border: "1px solid #2ecc8f", borderRadius: "8px",
            color: "#2ecc8f", fontSize: "13px", fontWeight: "600",
            cursor: loading ? "not-allowed" : "pointer", flexShrink: 0,
          }}>
            ✓ Завершить аудит
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", background: "#0c1220", border: "1px solid #1e2d55", borderRadius: "10px", padding: "20px", marginBottom: "16px" }}>
        {messages.length === 0 && !loading && (
          <div style={{ textAlign: "center", color: "#3d4f7a", marginTop: "60px" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>◎</div>
            <div style={{ fontSize: "15px", color: "#7a90c0" }}>Инициализация аудита...</div>
          </div>
        )}

        {messages.map((msg, i) => {
          const isTyping       = msg.role === "assistant" && i === typingIndex;
          const renderMarkdown = msg.role === "assistant" && !isTyping;

          return (
            <div key={i} style={{ marginBottom: "16px", display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
              <div style={{
                maxWidth: msg.role === "user" ? "80%" : "88%",
                padding: "12px 16px",
                borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                background: msg.role === "user" ? "#1565e8" : "#101828",
                border: msg.role === "user" ? "none" : "1px solid #1e2d55",
                color: "#e8edf8", fontSize: "14px", lineHeight: "1.6",
                // pre-wrap only for plain text — markdown's own <p>/<li> tags
                // handle their own spacing, so "normal" avoids double gaps
                whiteSpace: renderMarkdown ? "normal" : "pre-wrap",
              }}>
                {isTyping
                  ? <TypewriterMessage
                      text={msg.content}
                      onDone={() => setTypingIndex(-1)}
                      onScroll={() => bottomRef.current?.scrollIntoView({ behavior: "smooth" })}
                    />
                  : renderMarkdown
                    ? <ReactMarkdown components={markdownComponents}>{msg.content}</ReactMarkdown>
                    : msg.content
                }
              </div>
            </div>
          );
        })}

        {(loading || uploading) && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 0" }}>
            <div style={{ display: "flex", gap: "6px" }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#1565e8", animation: `pulse 1.2s ${i * 0.2}s infinite` }} />
              ))}
            </div>
            {uploading && <span style={{ fontSize: "12px", color: "#7a90c0" }}>Загрузка файла...</span>}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Pending file badge */}
      {pendingFile && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", marginBottom: "8px", background: "#0d1f3e", border: "1px solid #1565e8", borderRadius: "8px", fontSize: "13px", color: "#7a90c0" }}>
          <span>📎</span>
          <span style={{ flex: 1, color: "#e8edf8" }}>{pendingFile.name}</span>
          <span style={{ fontSize: "11px" }}>{(pendingFile.size / 1024).toFixed(0)} KB</span>
          <button onClick={() => { setPendingFile(null); setInput(""); }} style={{ background: "none", border: "none", color: "#7a90c0", cursor: "pointer", fontSize: "16px", padding: "0 4px" }}>×</button>
        </div>
      )}

      {/* Input row */}
      <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
        <input ref={fileInputRef} type="file" accept=".xlsx,.csv,.xml,.xls,.pdf,.docx,.doc,.txt" style={{ display: "none" }} onChange={handleFileSelect} />

        <button onClick={() => fileInputRef.current?.click()} disabled={loading || uploading || auditCompleted} title="Прикрепить документ" style={{
          width: "48px", height: "48px", flexShrink: 0,
          background: pendingFile ? "#0d3a8a" : "#101828",
          border: `1px solid ${pendingFile ? "#1565e8" : "#1e2d55"}`,
          borderRadius: "8px", color: pendingFile ? "#4d91ff" : "#7a90c0",
          fontSize: "20px", cursor: loading ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>📎</button>

        <textarea
          value={input}
          onChange={e => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px"; }}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder={pendingFile ? "Добавьте комментарий или нажмите → для отправки..." : "Введите вопрос... (Shift+Enter для новой строки)"}
          disabled={loading || uploading || auditCompleted}
          rows={1}
          style={{ flex: 1, padding: "13px 16px", background: "#0c1220", border: "1px solid #1e2d55", borderRadius: "8px", color: "#e8edf8", fontSize: "14px", outline: "none", resize: "none", overflow: "hidden", lineHeight: "1.5", minHeight: "48px", maxHeight: "200px", fontFamily: "inherit" }}
        />

        <button onClick={sendMessage} disabled={loading || uploading || (!input.trim() && !pendingFile) || auditCompleted} style={{
          width: "48px", height: "48px", flexShrink: 0,
          background: (loading || uploading) ? "#0d3a8a" : "#1565e8",
          border: "none", borderRadius: "8px", color: "#fff",
          fontSize: "18px", fontWeight: "600",
          cursor: (loading || uploading) ? "not-allowed" : "pointer",
        }}>
          {loading || uploading ? "…" : "→"}
        </button>
      </div>
    </div>
  );
}