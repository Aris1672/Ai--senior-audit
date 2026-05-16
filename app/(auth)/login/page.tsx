"use client";

import { createClient } from "@/lib/supabase-client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const router  = useRouter();
  const supabase = createClient();

  async function handleLogin() {
  setLoading(true);
  setError("");

  const { data, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError || !data.user) {
    setError("Неверный email или пароль");
    setLoading(false);
    return;
  }

  // Use service role via API route to get profile
  const res = await fetch("/api/auth/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: data.user.id }),
  });

  const profile = await res.json();

  if (profile?.status === "paused") {
    setError("Ваш аккаунт приостановлен. Обратитесь к администратору.");
    await supabase.auth.signOut();
    setLoading(false);
    return;
  }

  if (profile?.role === "admin") {
    router.push("/admin");
  } else {
    router.push("/client/dashboard");
  }
}

  return (
    <div style={{
      minHeight:       "100vh",
      background:      "#050810",
      display:         "flex",
      alignItems:      "center",
      justifyContent:  "center",
      fontFamily:      "system-ui, sans-serif",
    }}>
      <div style={{
        background:   "#0c1220",
        border:       "1px solid #1e2d55",
        borderRadius: "12px",
        padding:      "48px",
        width:        "100%",
        maxWidth:     "420px",
      }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{
            fontSize:     "22px",
            fontWeight:   "700",
            color:        "#e8edf8",
            marginBottom: "6px",
          }}>
            Assistant<span style={{ color: "#1565e8" }}>24</span>
          </div>
          <div style={{ fontSize: "13px", color: "#7a90c0" }}>
            ИИ Старший Аудитор
          </div>
        </div>

        {/* Title */}
        <h1 style={{
          fontSize:     "20px",
          fontWeight:   "600",
          color:        "#e8edf8",
          marginBottom: "24px",
          textAlign:    "center",
        }}>
          Вход в систему
        </h1>

        {/* Error */}
        {error && (
          <div style={{
            background:   "#3d1515",
            border:       "1px solid #e84040",
            borderRadius: "8px",
            padding:      "12px 16px",
            marginBottom: "20px",
            fontSize:     "13px",
            color:        "#e84040",
          }}>
            {error}
          </div>
        )}

        {/* Email */}
        <div style={{ marginBottom: "16px" }}>
          <label style={{
            display:      "block",
            fontSize:     "13px",
            color:        "#7a90c0",
            marginBottom: "8px",
          }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@company.ru"
            onKeyDown={e => e.key === "Enter" && handleLogin()}
            style={{
              width:        "100%",
              padding:      "12px 16px",
              background:   "#101828",
              border:       "1px solid #1e2d55",
              borderRadius: "8px",
              color:        "#e8edf8",
              fontSize:     "14px",
              outline:      "none",
              boxSizing:    "border-box",
            }}
          />
        </div>

        {/* Password */}
        <div style={{ marginBottom: "24px" }}>
          <label style={{
            display:      "block",
            fontSize:     "13px",
            color:        "#7a90c0",
            marginBottom: "8px",
          }}>
            Пароль
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            onKeyDown={e => e.key === "Enter" && handleLogin()}
            style={{
              width:        "100%",
              padding:      "12px 16px",
              background:   "#101828",
              border:       "1px solid #1e2d55",
              borderRadius: "8px",
              color:        "#e8edf8",
              fontSize:     "14px",
              outline:      "none",
              boxSizing:    "border-box",
            }}
          />
        </div>

        {/* Submit */}
        <button
          onClick={handleLogin}
          disabled={loading}
          style={{
            width:        "100%",
            padding:      "13px",
            background:   loading ? "#0d3a8a" : "#1565e8",
            border:       "none",
            borderRadius: "8px",
            color:        "#ffffff",
            fontSize:     "15px",
            fontWeight:   "600",
            cursor:       loading ? "not-allowed" : "pointer",
            transition:   "background 0.2s",
          }}
        >
          {loading ? "Вход..." : "Войти"}
        </button>

        <div style={{
          marginTop:  "24px",
          textAlign:  "center",
          fontSize:   "12px",
          color:      "#3d4f7a",
        }}>
          Проблемы со входом? Обратитесь к администратору.
        </div>
      </div>
    </div>
  );
}