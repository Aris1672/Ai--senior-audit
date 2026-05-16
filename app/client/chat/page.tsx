"use client";

import { createClient } from "@/lib/supabase-client";
import { useEffect, useRef, useState } from "react";

interface Message { role: "user" | "assistant"; content: string; costRub?: number; }

export default function ChatPage() {
  const [messages,  setMessages]  = useState<Message[]>([]);
  const [input,     setInput]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [clientId,  setClientId]  = useState<string | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const supabase  = createClient();

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setClientId(user.id);

      // Get or create active session
      const { data: existing } = await supabase
        .from("audit_sessions")
        .select("id")
        .eq("client_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1);

      if (existing && existing.length > 0) {
        setSessionId(existing[0].id);
        // Load message history
        const { data: msgs } = await supabase
          .from("audit_messages")
          .select("role, content")
          .eq("session_id", existing[0].id)
          .order("created_at");
        setMessages((msgs as any) || []);
      } else {
        // Create new session
        const { data: newSession } = await supabase
          .from("audit_sessions")
          .insert({ client_id: user.id, title: `Аудит ${new Date().toLocaleDateString("ru")}`, status: "active" })
          .select().single();
        setSessionId(newSession?.id || null);
      }
    }
    init();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    if (!input.trim() || !clientId || !sessionId || loading) return;

    const userMsg: Message = { role: "user", content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    // Save user message
    await supabase.from("audit_messages").insert({
      session_id: sessionId, client_id: clientId,
      role: "user", content: input,
    });

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId, sessionId,
        messages: newMessages.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    const data = await res.json();
    if (data.message) {
      const assistantMsg: Message = {
        role: "assistant", content: data.message, costRub: data.costRub,
      };
      setMessages(prev => [...prev, assistantMsg]);
      setTotalCost(prev => prev + (data.costRub || 0));
    }
    setLoading(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 64px)" }}>
      {/* Header */}
      <div style={{ marginBottom: "16px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: "700", color: "#e8edf8", margin: 0 }}>
          ИИ Старший Аудитор
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
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "#3d4f7a", marginTop: "60px" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>◎</div>
            <div style={{ fontSize: "15px", marginBottom: "8px", color: "#7a90c0" }}>
              Начните аудит
            </div>
            <div style={{ fontSize: "13px" }}>
              Например: «Проверь транзакции за Q1 2024» или «Найди подозрительные платежи»
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
            {[0,1,2].map(i => (
              <div key={i} style={{
                width: "8px", height: "8px", borderRadius: "50%",
                background: "#1565e8", animation: `pulse 1.2s ${i * 0.2}s infinite`,
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