"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV_ITEMS = [
  { href: "/client/dashboard", label: "Дашборд",    icon: "▦" },
  { href: "/client/chat",      label: "ИИ Аудитор", icon: "◎" },
  //{ href: "/client/documents", label: "Документы",  icon: "↑" },
  { href: "/client/usage",     label: "Журнал действий",    icon: "₽" },
];

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const [checking,    setChecking]    = useState(true);
  const [companyName, setCompanyName] = useState("");
  const [hasAudit,    setHasAudit]    = useState(false);
  const router   = useRouter();
  const pathname = usePathname();

 useEffect(() => {
  async function checkClient() {
    const res = await fetch("/api/auth/me");
    const { user } = await res.json();

    if (!user) { router.push("/login"); return; }

    const profileRes = await fetch("/api/auth/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });
    const profile = await profileRes.json();

    if (profile?.role !== "client") { router.push("/login"); return; }
    if (profile?.status === "paused") { router.push("/login"); return; }

    setCompanyName(profile?.company_name || "");

    // Check if user has any audit sessions
    const auditRes = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "get_client_sessions",
        payload: { clientId: user.id, limit: 1 },
      }),
    });
    const auditData = await auditRes.json();
    setHasAudit(Array.isArray(auditData) && auditData.length > 0);

    setChecking(false);
  }
  checkClient();
}, []);

  async function handleLogout() {
    // All auth goes through Vercel → Supabase, never direct from browser
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  if (checking) {
    return (
      <div style={{
        minHeight: "100vh", background: "#050810",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#7a90c0", fontFamily: "system-ui, sans-serif",
      }}>
        Загрузка...
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh", background: "#050810",
      display: "flex", fontFamily: "system-ui, sans-serif",
    }}>
      {/* Sidebar */}
      <aside style={{
        width: "240px", minHeight: "100vh",
        background: "#080c18", borderRight: "1px solid #1a2340",
        display: "flex", flexDirection: "column",
        position: "fixed", top: 0, left: 0,
      }}>
        {/* Logo */}
        <div style={{ padding: "24px 20px", borderBottom: "1px solid #1a2340" }}>
          <div style={{ fontSize: "18px", fontWeight: "700", color: "#e8edf8" }}>
            Assistant<span style={{ color: "#1565e8" }}>24</span>
          </div>
          <div style={{
            fontSize: "11px", color: "#3d4f7a",
            marginTop: "4px", letterSpacing: "0.05em",
          }}>
            {companyName || "КЛИЕНТСКИЙ ПОРТАЛ"}
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: "16px 12px", flex: 1 }}>
          {NAV_ITEMS.map(item => {
            const active  = pathname === item.href;
            const locked  = item.href === "/client/chat" && !hasAudit;
            return locked ? (
              <div
                key={item.href}
                title="ИИ Аудитор доступен после создания первого аудита"
                style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "10px 12px", borderRadius: "8px",
                  marginBottom: "4px", cursor: "not-allowed",
                  background: "transparent", opacity: 0.4,
                  color: "#7a90c0", fontSize: "14px",
                  borderLeft: "2px solid transparent",
                  position: "relative",
                }}
              >
                <span>{item.icon}</span>
                {item.label}
                <span style={{
                  marginLeft: "auto", fontSize: "10px",
                  color: "#3d4f7a", letterSpacing: "0.02em",
                }}>🔒</span>
              </div>
            ) : (
              <a key={item.href} href={item.href} style={{
                display: "flex", alignItems: "center", gap: "10px",
                padding: "10px 12px", borderRadius: "8px",
                marginBottom: "4px", textDecoration: "none",
                background:  active ? "#0d1f3e" : "transparent",
                color:       active ? "#4d91ff" : "#7a90c0",
                fontSize:    "14px", fontWeight: active ? "600" : "400",
                borderLeft:  active ? "2px solid #1565e8" : "2px solid transparent",
                transition:  "all 0.15s",
              }}>
                <span>{item.icon}</span>
                {item.label}
              </a>
            );
          })}
        </nav>

        {/* Logout */}
        <div style={{ padding: "16px 12px", borderTop: "1px solid #1a2340" }}>
          <button onClick={handleLogout} style={{
            width: "100%", padding: "10px 12px",
            background: "transparent", border: "1px solid #1a2340",
            borderRadius: "8px", color: "#7a90c0",
            fontSize: "13px", cursor: "pointer", textAlign: "left",
          }}>
            ← Выйти
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ marginLeft: "240px", flex: 1, padding: "32px" }}>
        {children}
      </main>
    </div>
  );
}
