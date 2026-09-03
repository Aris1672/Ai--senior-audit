"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";

interface Message { role: "user" | "assistant"; content: string; costRub?: number; fileNames?: string[]; }

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
      fontSize: "15px", fontWeight: 600, color: "#f4f7ff",
      margin: "20px 0 12px 0", padding: "9px 14px",
      background: "#152449", borderRadius: "6px",
      borderLeft: "4px solid #4d91ff",
    }} {...props} />
  ),
  p: (props: any) => (
    <p style={{ margin: "0 0 10px 0", lineHeight: "1.6" }} {...props} />
  ),
  strong: (props: any) => (
    <strong style={{ color: "#4d91ff", fontWeight: 700 }} {...props} />
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

// ── (TypewriterMessage removed) ────────────────────────────────────────────
// Previously simulated a typing effect over an already-fully-received
// response. No longer needed: /api/chat now streams real text as Claude
// generates it, so the message content itself grows in real time — see
// runStreamedReply below and its use of typingIndex to gate plain-text vs.
// Markdown rendering in the message list.

// ── Streaming chat helper ───────────────────────────────────────────────────
// Reads the NDJSON stream from /api/chat (see route.ts: one JSON object per
// line — {type:"delta"}, {type:"done"}, {type:"error"}) and calls onDelta
// with the cumulative text so far as each chunk arrives.
//
// Also fixes the original bug directly: previously every call site did
// `const data = await res.json()` with no !res.ok check and no try/catch.
// If the server ever returned a 504 (Vercel function timeout) or any
// non-JSON error page, res.json() threw uncaught — which skipped
// setLoading(false) further down and left the whole chat input locked
// forever, with no visible error. Every failure path here instead throws a
// normal Error with a real message, which callers catch and always resolve
// (loading/uploading state is guaranteed to reset — see finally blocks below).
async function streamChat(
  payload: Record<string, unknown>,
  onDelta: (fullTextSoFar: string) => void
): Promise<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.body) {
    // Pre-stream failures (400/403/500) still come back as plain JSON, not
    // NDJSON — read it as such for a real error message where possible.
    let errMsg = `Ошибка сервера (${res.status})`;
    try {
      const errData = await res.json();
      if (errData?.error) errMsg = errData.error;
    } catch {
      // body wasn't JSON either (e.g. a raw Vercel error page) — keep the
      // generic HTTP-status message above rather than throwing here too.
    }
    throw new Error(errMsg);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer   = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // last entry may be a partial line — hold it for next read

    for (const line of lines) {
      if (!line.trim()) continue;
      let evt: any;
      try {
        evt = JSON.parse(line);
      } catch {
        console.warn("[chat] Skipping malformed stream line:", line.slice(0, 100));
        continue;
      }

      if (evt.type === "delta") {
        fullText += evt.text;
        onDelta(fullText);
      } else if (evt.type === "done") {
        fullText = evt.message; // authoritative final text, in case of any drift
      } else if (evt.type === "error") {
        throw new Error(evt.error || "Ошибка сервера во время генерации ответа");
      } else if (evt.type === "heartbeat") {
        // No-op. Sent every ~15s server-side purely to keep bytes flowing
        // over the connection so no idle-timeout (proxy, CDN, or browser)
        // fires during long silent gaps before Claude's first visible text —
        // see route.ts. Nothing to do here but keep reading.
      }
    }
  }

  return fullText;
}

export default function ChatPage() {
  const [messages,       setMessages]       = useState<Message[]>([]);
  const [input,          setInput]          = useState("");
  const [loading,        setLoading]        = useState(false);
  // Shown alongside the pulsing dots during a long-running audit request, so
  // the wait feels less like a frozen screen. statusText cycles through a
  // few phrases; elapsedSeconds just counts up — both purely cosmetic, driven
  // by a local timer in runStreamedReply, not tied to actual pipeline stages.
  const [statusText,     setStatusText]     = useState("");
  const [elapsedSeconds, setElapsedSeconds]  = useState(0);
  const [sessionId,      setSessionId]      = useState<string | null>(null);
  const [clientId,       setClientId]       = useState<string | null>(null);
  const [totalCost,      setTotalCost]      = useState(0);
  const [context,        setContext]        = useState<any>(null);
  const [initDone,       setInitDone]       = useState(false);
  const [pendingFiles,   setPendingFiles]   = useState<File[]>([]);
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

  // ── Helper: stream a reply into a live-updating message bubble ────────────
  // Replaces the old "await full response, then push it" pattern. A blank
  // assistant bubble is added immediately; content grows as text arrives
  // from the server, so the user sees the report being written in real
  // time instead of a frozen "thinking" indicator (or a silent 504 with no
  // visible error at all).
  //
  // SMOOTHING: raw network deltas arrive in bursts (Claude streams by
  // token/sentence-sized chunks, not evenly), which on its own looks choppy
  // — text visibly jumping in clumps rather than the smooth reveal the old
  // TypewriterMessage gave. Fix: `target` always holds the latest text the
  // server has actually sent (updated instantly, no delay); `displayed` is
  // what's shown on screen, and a requestAnimationFrame loop advances it
  // toward `target` a few characters at a time on a fixed interval — same
  // pacing constants the old TypewriterMessage used. This keeps the real
  // streaming behavior (fast delivery, no more stuck-forever screen) while
  // making the on-screen reveal feel smooth regardless of how bursty the
  // underlying network chunks are.
  //
  // typingIndex is reused here for its existing purpose: while it points at
  // this message, the render below shows plain growing text; once fully
  // caught up (or on error), typingIndex is cleared so the message switches
  // over to full Markdown rendering.
  async function runStreamedReply(payload: Record<string, unknown>): Promise<boolean> {
    let msgIndex = -1;
    setMessages(prev => {
      msgIndex = prev.length;
      return [...prev, { role: "assistant" as const, content: "" }];
    });
    setTypingIndex(msgIndex);

    // ── Rotating status text + elapsed timer ──────────────────────────────
    // Purely cosmetic — audits can genuinely take 1-3 minutes (real model
    // reasoning time, not a bug), and a static pulsing-dots indicator that
    // long starts to look broken even when it isn't. These give the person
    // something to read and a sense of "still working, X seconds in"
    // instead of an ambiguous frozen screen.
    const STATUS_MESSAGES = [
      "Анализирую документ...",
      "Проверяю налоговые риски...",
      "Сопоставляю операции...",
      "Формирую выводы аудитора...",
      "Ищу признаки риска...",
    ];
    let statusIdx = 0;
    setStatusText(STATUS_MESSAGES[0]);
    setElapsedSeconds(0);

    const statusInterval = setInterval(() => {
      statusIdx = (statusIdx + 1) % STATUS_MESSAGES.length;
      setStatusText(STATUS_MESSAGES[statusIdx]);
    }, 4000);

    const timerInterval = setInterval(() => {
      setElapsedSeconds(s => s + 1);
    }, 1000);

    let target = "";      // latest text actually received from the server
    let displayed = "";   // what's currently shown — chases `target`
    let rafId = 0;
    let serverDone = false;

    const INTERVAL_MS      = 18; // same pacing as the old TypewriterMessage
    const CHARS_PER_TICK   = 3;  // slightly faster than before, to avoid falling behind on long bursts
    let lastTick = 0;

    function tick(ts: number) {
      if (ts - lastTick >= INTERVAL_MS) {
        lastTick = ts;
        if (displayed.length < target.length) {
          displayed = target.slice(0, Math.min(displayed.length + CHARS_PER_TICK, target.length));
          setMessages(prev => {
            const next = [...prev];
            if (next[msgIndex]) next[msgIndex] = { ...next[msgIndex], content: displayed };
            return next;
          });
          bottomRef.current?.scrollIntoView({ behavior: "smooth" });
        }
      }
      // Keep ticking until the server is done AND the display has fully
      // caught up — this is what lets `displayed` finish revealing even
      // after the network stream itself has already ended.
      if (!serverDone || displayed.length < target.length) {
        rafId = requestAnimationFrame(tick);
      }
    }
    rafId = requestAnimationFrame(tick);

    try {
      const finalText = await streamChat(payload, (partial) => {
        target = partial; // tick() above picks this up on its own schedule
      });
      target = finalText; // authoritative final text, in case of any drift
      serverDone = true;

      // Wait for the display to actually finish catching up before
      // resolving — otherwise the message would flip to Markdown rendering
      // (typingIndex cleared) mid-reveal.
      await new Promise<void>(resolve => {
        function waitForCatchUp() {
          if (displayed.length >= target.length) resolve();
          else requestAnimationFrame(waitForCatchUp);
        }
        waitForCatchUp();
      });

      setMessages(prev => {
        const next = [...prev];
        if (next[msgIndex]) next[msgIndex] = { ...next[msgIndex], content: finalText };
        return next;
      });
      return true;

    } catch (err) {
      console.error("[chat] streamed reply failed:", err);
      serverDone = true;
      cancelAnimationFrame(rafId);
      setMessages(prev => {
        const next = [...prev];
        if (next[msgIndex]) {
          next[msgIndex] = {
            ...next[msgIndex],
            content: "⚠️ Не удалось получить ответ. Попробуйте обновить страницу — сообщение могло всё же обработаться на сервере.",
          };
        }
        return next;
      });
      return false;

    } finally {
      cancelAnimationFrame(rafId); // safety net — normal paths above already stop ticking on their own
      clearInterval(statusInterval);
      clearInterval(timerInterval);
      setTypingIndex(-1); // always release — this is what previously never ran on the error path
    }
  }

  async function sendAutoMessageDirect(content: string, uid: string, sid: string, ctx?: any) {
    setLoading(true);
    try {
      await runStreamedReply({
        clientId: uid, sessionId: sid, context: ctx,
        messages: [{ role: "user", content }],
      });
    } finally {
      setLoading(false); // always runs — previously skipped entirely if res.json() threw on a 504/error page
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Handle file selection ─────────────────────────────────────────────────
  // Supports selecting (or dragging-in via multiple picks) more than one
  // file at once. Newly selected files are appended to whatever is already
  // pending, so the attach button can be used more than once before send.
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setPendingFiles(prev => [...prev, ...files]);
      if (!input.trim()) {
        const names = files.map(f => f.name).join(", ");
        setInput(`Загружены документы: ${names}. Проанализируй их в контексте текущего аудита.`);
      }
    }
    e.target.value = "";
  }

  // ── Upload all pending files (one /api/upload call per file — that route's
  //    contract is unchanged), then send a single /api/chat call once every
  //    upload has succeeded. /api/chat already re-reads ALL documents linked
  //    to the session on every turn (see getAllDocumentsContent server-side),
  //    so a single call after all uploads is sufficient — no need to call
  //    /api/chat once per file. ─────────────────────────────────────────────
  async function uploadFilesAndSend(files: File[], uid: string, sid: string, currentMessages: Message[]) {
    setUploading(true);

    for (const file of files) {
      const formData = new FormData();
      formData.append("file",      file);
      formData.append("clientId",  uid);
      formData.append("sessionId", sid);

      const uploadRes  = await fetch("/api/upload", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();

      if (!uploadRes.ok) {
        setUploading(false);
        pushAssistantReply(`❌ Ошибка загрузки файла «${file.name}»: ${uploadData.error || "неизвестная ошибка"}`);
        return; // stop on first failure — avoids sending a partial/confusing analysis
      }
    }

    setUploading(false);

    try {
      await runStreamedReply({
        clientId: uid, sessionId: sid,
        context: context ? {
          companyName: context.company_name, periodFrom: context.period,
          transactionCount: context.transactions_ct, openFindings: 0, criticalCount: 0,
          legalForm: context.legal_form_display, taxRegime: context.tax_regime_display, vatStatus: context.vat_status,
        } : undefined,
        messages: currentMessages.map(m => ({ role: m.role, content: m.content })),
      });
    } catch (err) {
      // runStreamedReply already surfaces its own in-bubble error message on
      // failure and never throws — this catch only guards against something
      // unexpected escaping it, so uploadFilesAndSend's caller (sendMessage)
      // still reaches its own finally block below either way.
      console.error("[chat] post-upload streamed reply failed unexpectedly:", err);
    }
  }

  // ── Main send handler ─────────────────────────────────────────────────────
  async function sendMessage() {
    if ((!input.trim() && pendingFiles.length === 0) || !clientId || !sessionId || loading) return;

    const messageText = input.trim() || `Проанализируй загруженные документы: ${pendingFiles.map(f => f.name).join(", ")}`;
    const userMsg: Message = {
      role: "user",
      content: messageText,
      ...(pendingFiles.length > 0 ? { fileNames: pendingFiles.map(f => f.name) } : {}),
    };
    const newMessages = [...messages, userMsg];

    setMessages(newMessages);
    setInput("");
    const filesToUpload = pendingFiles;
    setPendingFiles([]);
    setLoading(true);

    const ta = document.querySelector("textarea") as HTMLTextAreaElement | null;
    if (ta) ta.style.height = "48px";

    await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_message", payload: { sessionId, clientId, role: "user", content: messageText } }),
    });

    try {
      if (filesToUpload.length > 0) {
        await uploadFilesAndSend(filesToUpload, clientId, sessionId, newMessages);
      } else {
        await runStreamedReply({
          clientId, sessionId,
          context: context ? {
            companyName: context.company_name, periodFrom: context.period,
            transactionCount: context.transactions_ct, openFindings: 0, criticalCount: 0,
            legalForm: context.legal_form_display, taxRegime: context.tax_regime_display, vatStatus: context.vat_status,
          } : undefined,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        });
      }
    } finally {
      // Always runs — this is the fix for the original bug: previously
      // setLoading(false) sat unconditionally after the if/else, so if the
      // fetch inside either branch threw (504, non-JSON error page), it was
      // never reached and the whole input stayed locked with no way to
      // recover short of a manual page reload.
      setLoading(false);
    }
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
                {msg.fileNames && msg.fileNames.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
                    {msg.fileNames.map((name, idx) => (
                      <div key={idx} style={{
                        display: "flex", alignItems: "center", gap: "6px",
                        padding: "6px 10px", background: "#e8edf8", borderRadius: "8px",
                        fontSize: "13px", color: "#0c1220", width: "fit-content",
                      }}>
                        <span>📎</span>
                        <span style={{ wordBreak: "break-all" }}>{name}</span>
                      </div>
                    ))}
                  </div>
                )}
                {isTyping
                  ? <>
                      {msg.content}
                      <span style={{
                        display: "inline-block", width: "2px", height: "1em",
                        background: "#4d91ff", marginLeft: "2px",
                        verticalAlign: "text-bottom",
                        animation: "cursorBlink 0.7s steps(1) infinite",
                      }} />
                    </>
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
            {/* Rotating status + elapsed timer — only during the actual chat
                request (not file upload), and only before real content has
                started streaming in (once text appears, that IS the status). */}
            {loading && !uploading && (
              <span style={{ fontSize: "12px", color: "#7a90c0" }}>
                {/* TEMPORARY DEPLOY-VERIFICATION MARKER — remove once confirmed
                    SpaceWeb is actually serving new builds, not a cached bundle. */}
                <strong style={{ color: "#ff3b3b", fontSize: "14px" }}>[BUILD TEST V2] </strong>
                {statusText}
                {elapsedSeconds > 0 && (
                  <span style={{ marginLeft: "8px", color: "#4d6a9e" }}>
                    {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, "0")}
                  </span>
                )}
              </span>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Pending files list */}
      {pendingFiles.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "8px" }}>
          {pendingFiles.map((file, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", background: "#0d1f3e", border: "1px solid #1565e8", borderRadius: "8px", fontSize: "13px", color: "#7a90c0" }}>
              <span>📎</span>
              <span style={{ flex: 1, color: "#e8edf8" }}>{file.name}</span>
              <span style={{ fontSize: "11px" }}>{(file.size / 1024).toFixed(0)} KB</span>
              <button onClick={() => setPendingFiles(prev => prev.filter((_, i) => i !== idx))} style={{ background: "none", border: "none", color: "#7a90c0", cursor: "pointer", fontSize: "16px", padding: "0 4px" }}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
        <input ref={fileInputRef} type="file" multiple accept=".xlsx,.csv,.xml,.xls,.pdf,.docx,.doc,.txt,.jpg,.jpeg,.png" style={{ display: "none" }} onChange={handleFileSelect} />

        <button onClick={() => fileInputRef.current?.click()} disabled={loading || uploading || auditCompleted} title="Прикрепить документ(ы)" style={{
          width: "48px", height: "48px", flexShrink: 0,
          background: pendingFiles.length > 0 ? "#0d3a8a" : "#101828",
          border: `1px solid ${pendingFiles.length > 0 ? "#1565e8" : "#1e2d55"}`,
          borderRadius: "8px", color: pendingFiles.length > 0 ? "#4d91ff" : "#7a90c0",
          fontSize: "20px", cursor: loading ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>📎</button>

        <textarea
          value={input}
          onChange={e => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px"; }}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder={pendingFiles.length > 0 ? "Добавьте комментарий или нажмите → для отправки..." : "Введите вопрос... (Shift+Enter для новой строки)"}
          disabled={loading || uploading || auditCompleted}
          rows={1}
          style={{ flex: 1, padding: "13px 16px", background: "#0c1220", border: "1px solid #1e2d55", borderRadius: "8px", color: "#e8edf8", fontSize: "14px", outline: "none", resize: "none", overflow: "hidden", lineHeight: "1.5", minHeight: "48px", maxHeight: "200px", fontFamily: "inherit" }}
        />

        <button onClick={sendMessage} disabled={loading || uploading || (!input.trim() && pendingFiles.length === 0) || auditCompleted} style={{
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
