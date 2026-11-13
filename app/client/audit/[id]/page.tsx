"use client";

import { useEffect, useRef, useState } from "react";

// The recorded amount, exactly: kopecks are shown whenever there are any
// ("7 969,50", not "7 969,5" or a rounded "7 970") — it is what gets invoiced.
function rubles(n: number): string {
  const v = Number(n) || 0;
  const whole = Math.abs(v * 100 - Math.round(v) * 100) < 0.5;
  return v.toLocaleString("ru-RU", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}
import { useParams, useRouter } from "next/navigation";
import { buildReportDefinition, reportFileName } from "@/lib/report-pdf";
import {
  getRiskColor, getRiskBgColor, type RiskLevel,
  getEvidenceStatusLabel, getEvidenceStatusColor, getEvidenceStatusBgColor, type EvidenceStatus,
} from "@/lib/billing";


// "2025-01-01 – 2025-12-31" (as stored) → "01.01.2025 – 31.12.2025".
function ruPeriod(period: string): string {
  return period.replace(/(\d{4})-(\d{2})-(\d{2})/g, "$3.$2.$1");
}

// The PDF report: layout in lib/report-pdf.ts (Nov 13, 2026 redesign), rendered here with pdfmake.
async function generatePDF(session: SessionDetail, findings: Finding[]) {
  const pdfMake  = (await import("pdfmake/build/pdfmake")).default;
  const pdfFonts = (await import("pdfmake/build/vfs_fonts")).default;
  (pdfMake as unknown as { vfs: unknown }).vfs = (pdfFonts as unknown as { vfs: unknown }).vfs;
  const definition = buildReportDefinition(session, findings);
  pdfMake.createPdf(definition).download(reportFileName(session.company_name));
}

interface Finding {
  id:              string;
  risk_level:      RiskLevel;
  title:           string;
  description:     string;
  legal_basis:     string;
  recommendation:  string;
  status:          string;
  // Evidence-confidence tier — separate from `status` (workflow: open/
  // resolved/disputed) and from `risk_level` (severity). Optional on the
  // type because findings created before this column existed will come
  // back from the DB default ("risk_flag"), but older cached/local data
  // shapes might still omit it — render defensively wherever it's used.
  evidence_status?: EvidenceStatus;
  created_at:      string;
  // Stage 2 (closing with supporting documents) — present after migration 006.
  proposed_at?:          string | null;   // the agent proposes closing; waits for the client
  proposal_basis?:       string | null;
  proposal_documents?:   string | null;
  agent_note?:           string | null;   // what the agent says is still missing
  resolved_at?:          string | null;
  resolution_basis?:     string | null;
  resolution_documents?: string | null;
  // Correcting an assessment (migration 007).
  revision_proposed_at?: string | null;   // the agent proposes a corrected version; waits for the client
  proposed_revision?:    { risk_level?: string; evidence_status?: string; title?: string; description?: string; legal_basis?: string; recommendation?: string; financial_impact?: string } | null;
  revision_basis?:       string | null;
  revised_at?:           string | null;   // last confirmed correction
  revision_summary?:     string | null;
  // Report fields (migration 008).
  financial_impact?:     string | null;
  proposal_kind?:        "corrected" | "documented" | null;
  resolution_kind?:      "corrected" | "documented" | null;
}

const EVIDENCE_RU: Record<string, string> = { confirmed: "Подтверждённое нарушение", risk_flag: "Признак риска", indirect: "Косвенный признак" };
const REVISION_TEXT_FIELDS: [("title" | "description" | "financial_impact" | "legal_basis" | "recommendation"), string][] = [
  ["title", "Название"], ["description", "Описание"], ["financial_impact", "Финансовое влияние"], ["legal_basis", "Правовое основание"], ["recommendation", "Рекомендация"],
];

const ruDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" }) : "");

interface Message {
  role:    "user" | "assistant";
  content: string;
}

interface SessionDetail {
  id:              string;
  title:           string;
  status:          string;
  transactions_ct: number;
  findings_ct:     number;
  cost_rub:        number;
  created_at:      string;
  company_name:    string;
  period:          string;
}

interface AuditDetailData {
  session:  SessionDetail;
  findings: Finding[];
  messages: Message[];
}

const RISK_ORDER: RiskLevel[] = ["КРИТИЧНО", "СУЩЕСТВЕННО", "НЕСУЩЕСТВЕННО"];

const RISK_CHART_CONFIG: Record<string, { color: string; label: string }> = {
  "КРИТИЧНО":      { color: "#e84040", label: "Критично" },
  "СУЩЕСТВЕННО":   { color: "#f59e0b", label: "Существенно" },
  "НЕСУЩЕСТВЕННО": { color: "#2ecc8f", label: "Несущественно" },
};

// Must live at module level so React never remounts it mid-animation
function DonutCanvas({ segments, mounted }: {
  segments: { color: string; fraction: number }[];
  mounted: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cx = 75, cy = 75, r = 58, lw = 16;
    const START    = -Math.PI / 2; // 12 o'clock
    const GAP      = 0.03;         // gap between arcs in radians
    const duration = 1200;
    let startTime: number | null = null;

    const ease = (t: number) => 1 - Math.pow(1 - t, 3);

    const draw = (progress: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Track ring
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.strokeStyle = "#1a2340";
      ctx.lineWidth = lw;
      ctx.stroke();

      // All segments drawn in one loop per frame — no separate state per arc
      const totalSwept = 2 * Math.PI * progress;
      let cursor = 0; // how many radians we've "consumed" across segments

      segments.forEach((seg) => {
        const segAngle = 2 * Math.PI * seg.fraction;
        const segStart = cursor;
        const segEnd   = cursor + segAngle;

        // How much of this segment is visible at current progress?
        const visibleEnd   = Math.min(totalSwept, segEnd);
        const visibleStart = Math.min(totalSwept, segStart + GAP);
        const swept        = Math.max(0, visibleEnd - visibleStart);

        if (swept > 0) {
          ctx.beginPath();
          ctx.arc(cx, cy, r, START + visibleStart, START + visibleStart + swept);
          ctx.strokeStyle = seg.color;
          ctx.lineWidth   = lw;
          ctx.lineCap     = "butt";
          ctx.stroke();
        }
        cursor = segEnd;
      });
    };

    const animate = (ts: number) => {
      if (!startTime) startTime = ts;
      const p = ease(Math.min((ts - startTime) / duration, 1));
      draw(p);
      if (p < 1) animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [mounted, segments]);

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  return (
    <canvas
      ref={canvasRef}
      width={150 * dpr}
      height={150 * dpr}
      style={{ width: 150, height: 150, transform: `scale(${1.1 / dpr})`, transformOrigin: "center" }}
    />
  );
}

function ViolationsDonut({ findings, mounted }: { findings: Finding[]; mounted: boolean }) {
  const total = findings.length;
  if (total === 0) return null;

  const segments = RISK_ORDER
    .map(level => ({
      level,
      count:    findings.filter(f => f.risk_level === level).length,
      color:    RISK_CHART_CONFIG[level].color,
      label:    RISK_CHART_CONFIG[level].label,
      fraction: findings.filter(f => f.risk_level === level).length / total,
    }))
    .filter(s => s.count > 0);

  return (
    <div style={{
      background: "#080f1e",
      border: "1px solid #1a2340",
      borderRadius: "12px",
      padding: "20px 24px",
      display: "flex",
      alignItems: "center",
      gap: "28px",
      flexWrap: "wrap",
    }}>
      {/* Canvas donut */}
      <div style={{ position: "relative", width: 150, height: 150, flexShrink: 0 }}>
        <DonutCanvas segments={segments} mounted={mounted} />
        {/* Centre label */}
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <div style={{ fontSize: "26px", fontWeight: "700", color: "#e8edf8", lineHeight: 1 }}>
            {total}
          </div>
          <div style={{ fontSize: "10px", color: "#3d4f7a", marginTop: "3px" }}>
            нарушений
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1, minWidth: "160px" }}>
        {segments.map(seg => (
          <div key={seg.level} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{
              width: "8px", height: "8px", borderRadius: "2px",
              background: seg.color, flexShrink: 0,
            }} />
            <span style={{ fontSize: "12px", color: "#7a90c0", flex: 1 }}>{seg.label}</span>            
            <span style={{ fontSize: "14px", fontWeight: "700", color: seg.color }}>{seg.count}</span>
            <span style={{ fontSize: "11px", color: "#3d4f7a", minWidth: "34px", textAlign: "right" }}>
              {Math.round(seg.fraction * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResolutionDonut({ findings, mounted }: { findings: Finding[]; mounted: boolean }) {
  const total    = findings.length;
  const resolved = findings.filter(f => f.status === "resolved").length;
  const open     = total - resolved;

  if (total === 0) return null;

  const segments = [
    { color: "#2ecc8f", label: "Решено",  count: resolved, fraction: resolved / total },
    { color: "#f59e0b", label: "Открыто", count: open,     fraction: open     / total },
  ].filter(s => s.count > 0);

  return (
    <div style={{
      background: "#080f1e",
      border: "1px solid #1a2340",
      borderRadius: "12px",
      padding: "20px 24px",
      display: "flex",
      alignItems: "center",
      gap: "28px",
      flexWrap: "wrap",
    }}>
      {/* Canvas donut */}
      <div style={{ position: "relative", width: 150, height: 150, flexShrink: 0 }}>
        <DonutCanvas segments={segments} mounted={mounted} />
        {/* Centre label */}
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <div style={{ fontSize: "26px", fontWeight: "700", color: resolved === total ? "#2ecc8f" : "#e8edf8", lineHeight: 1 }}>
            {resolved === total ? "✓" : `${Math.round((resolved / total) * 100)}%`}
          </div>
          <div style={{ fontSize: "10px", color: "#3d4f7a", marginTop: "3px" }}>
            {resolved === total ? "всё решено" : "решено"}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1, minWidth: "160px" }}>
        {segments.map(seg => (
          <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{
              width: "8px", height: "8px", borderRadius: "2px",
              background: seg.color, flexShrink: 0,
            }} />
            <span style={{ fontSize: "12px", color: "#7a90c0", flex: 1 }}>{seg.label}</span>
            <span style={{ fontSize: "14px", fontWeight: "700", color: seg.color }}>{seg.count}</span>
            <span style={{ fontSize: "11px", color: "#3d4f7a", minWidth: "34px", textAlign: "right" }}>
              {Math.round(seg.fraction * 100)}%
            </span>
          </div>
        ))}
        {/* Progress bar */}
        <div style={{ marginTop: "4px" }}>
          <div style={{
            height: "4px", borderRadius: "2px",
            background: "#1a2340", overflow: "hidden",
          }}>
            <div style={{
              height: "100%", borderRadius: "2px",
              background: "#2ecc8f",
              width: `${Math.round((resolved / total) * 100)}%`,
              transition: "width 1.2s cubic-bezier(0.16, 1, 0.3, 1)",
            }} />
          </div>
          <div style={{ fontSize: "10px", color: "#3d4f7a", marginTop: "4px" }}>
            {resolved} из {total} нарушений устранено
          </div>
        </div>
      </div>
    </div>
  );
}

const SESSION_STATUS: Record<string, { label: string; color: string }> = {
  active:    { label: "Активна",   color: "#2ecc8f" },
  completed: { label: "Завершена", color: "#7a90c0" },
  archived:  { label: "Архив",     color: "#3d4f7a" },
};

export default function AuditDetailPage() {
  const params   = useParams();
  const router   = useRouter();
  const sessionId = params?.id as string;

  const [data,    setData]    = useState<AuditDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [tab,     setTab]     = useState<"findings" | "chat">("findings");
  const [deciding, setDeciding] = useState<string | null>(null);
  const [decideError, setDecideError] = useState("");

  // Stage 2: the client's decision on a finding (confirm / decline the
  // agent's proposal, or reopen a closed finding).
  async function decide(findingId: string, decision: "confirm" | "decline" | "reopen" | "confirm_revision" | "decline_revision") {
    if (deciding) return;
    setDeciding(findingId); setDecideError("");
    try {
      const res = await fetch("/api/findings/decide", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, findingId, decision }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) setDecideError(out.error || "Не удалось записать решение");
      const fresh = await fetch("/api/data", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "audit_detail", payload: { sessionId } }),
      });
      const json = await fresh.json();
      if (json.session) setData(json);
    } catch {
      setDecideError("Не удалось записать решение");
    } finally {
      setDeciding(null);
    }
  }

  useEffect(() => {
    if (!sessionId) return;
    async function load() {
      const res  = await fetch("/api/data", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "audit_detail", payload: { sessionId } }),
      });
      const json = await res.json();
      if (json.session) setData(json);
      setLoading(false);
    }
    load();
  }, [sessionId]);

  useEffect(() => {
    if (!loading) {
      requestAnimationFrame(() => requestAnimationFrame(() => setMounted(true)));
    }
  }, [loading]);

  if (loading) return (
    <div style={{ color: "#7a90c0", fontFamily: "system-ui, sans-serif", padding: "40px" }}>
      Загрузка аудита...
    </div>
  );
  if (!data) return (
    <div style={{ color: "#e84040", padding: "40px" }}>Аудит не найден.</div>
  );

  const { session, findings, messages } = data;
  const st = SESSION_STATUS[session.status] || SESSION_STATUS.active;

  // The code the agent and the chat use for a finding (Н-1, Н-2 …): its
  // position in order of creation.
  const codeOf = new Map(findings.map((f, i) => [f.id, `Н-${i + 1}`]));

  const grouped = RISK_ORDER.reduce<Record<string, Finding[]>>((acc, level) => {
    const items = findings.filter(f => f.risk_level === level);
    if (items.length) acc[level] = items;
    return acc;
  }, {});

  return (
    <div style={{ maxWidth: "1100px" }}>
      <button
        onClick={() => router.push("/client/dashboard")}
        style={{
          background: "none", border: "none", color: "#7a90c0",
          fontSize: "13px", cursor: "pointer", padding: "0 0 20px 0",
          display: "flex", alignItems: "center", gap: "6px",
        }}
      >
        ← Назад к дашборду
      </button>

      <div style={{
        background: "#0c1220", border: "1px solid #1e2d55",
        borderRadius: "12px", padding: "24px", marginBottom: "24px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: "700", color: "#e8edf8", margin: "0 0 6px 0" }}>
              {session.company_name}
            </h1>
            {session.period && session.period !== "All periods" && (
              <div style={{ fontSize: "13px", color: "#7a90c0", marginBottom: "12px" }}>
                Период: {ruPeriod(session.period)}
              </div>
            )}
            <span style={{
              fontSize: "11px", padding: "4px 10px", borderRadius: "12px",
              color: st.color, background: st.color + "22", fontWeight: "600",
            }}>
              {st.label}
            </span>
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            {session.status === "active" && (
              <a href={`/client/chat?session=${session.id}`} style={{
                padding: "10px 20px", background: "#1565e8",
                borderRadius: "8px", color: "#fff",
                fontSize: "13px", fontWeight: "600",
                textDecoration: "none",
              }}>
                Открыть чат →
              </a>
            )}
            <button
              onClick={async () => {
                try {
                  // Built from the audit as it is NOW on the server: a closure
                  // confirmed in the chat (another tab) after this page was
                  // opened must be in the report.
                  let current: AuditDetailData = data;
                  try {
                    const res = await fetch("/api/data", {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "audit_detail", payload: { sessionId } }),
                    });
                    const json = await res.json();
                    if (res.ok && json.session) { current = json; setData(json); }
                  } catch { /* offline — use what the page shows */ }
                  await generatePDF(current.session, current.findings);
                } catch (e) {
                  console.error("[PDF] Exception:", e);
                  alert("Не удалось сформировать PDF. Попробуйте ещё раз.");
                }
              }}
              style={{
                padding: "10px 20px", background: "#0d1f3e",
                border: "1px solid #1e2d55",
                borderRadius: "8px", color: "#e8edf8",
                fontSize: "13px", fontWeight: "600",
                cursor: "pointer",
                display: "flex", alignItems: "center", gap: "6px",
              }}
            >
              ↓ Скачать PDF
            </button>
          </div>
        </div>

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: "12px", marginTop: "20px",
        }}>
          {[
            { label: "Нарушений",  value: findings.length, color: findings.length > 0 ? "#e84040" : "#2ecc8f" },
            { label: "Транзакций", value: session.transactions_ct || "—", color: "#4d91ff" },
            { label: "Стоимость",  value: session.cost_rub
                ? `${rubles(session.cost_rub)} ₽`
                : "—", color: "#f59e0b" },
            { label: "Дата", value: new Date(session.created_at).toLocaleDateString("ru", { day: "numeric", month: "long", year: "numeric" }), color: "#7a90c0" },
          ].map((s, i) => (
            <div key={i} style={{
              background: "#080f1e", borderRadius: "8px", padding: "12px 14px",
              border: "1px solid #1a2340",
            }}>
              <div style={{ fontSize: "11px", color: "#3d4f7a", marginBottom: "4px" }}>{s.label}</div>
              <div style={{ fontSize: "15px", fontWeight: "700", color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{
          display: "flex",
          gap: "16px",
          marginTop: "16px",
          flexWrap: "wrap",
        }}>
          <div style={{ flex: 1, minWidth: "260px" }}>
            <ViolationsDonut findings={findings} mounted={mounted} />
          </div>
          <div style={{ flex: 1, minWidth: "260px" }}>
            <ResolutionDonut findings={findings} mounted={mounted} />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "4px", marginBottom: "20px" }}>
        {(["findings", "chat"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 20px", borderRadius: "8px", border: "none",
            cursor: "pointer", fontSize: "13px", fontWeight: "600",
            background: tab === t ? "#1565e8" : "#0c1220",
            color:      tab === t ? "#fff"     : "#7a90c0",
            transition: "all 0.15s",
          }}>
            {t === "findings"
              ? `Нарушения (${findings.length})`
              : `История чата (${messages.length})`}
          </button>
        ))}
      </div>

      {tab === "findings" && (
        <div>
          {findings.length === 0 ? (
            <div style={{
              background: "#0c1220", border: "1px solid #1e2d55",
              borderRadius: "12px", padding: "40px",
              textAlign: "center", color: "#3d4f7a", fontSize: "14px",
            }}>
              Нарушений не обнаружено
            </div>
          ) : (
            Object.entries(grouped).map(([level, items]) => (
              <div key={level} style={{ marginBottom: "24px" }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  marginBottom: "12px",
                }}>
                  <span style={{
                    fontSize: "11px", padding: "4px 12px", borderRadius: "10px",
                    fontWeight: "700",
                    color:      getRiskColor(level as RiskLevel),
                    background: getRiskBgColor(level as RiskLevel),
                  }}>
                    {level}
                  </span>
                  <span style={{ color: "#3d4f7a", fontSize: "12px" }}>
                    {items.length} нарушени{items.length === 1 ? "е" : "й"}
                  </span>
                </div>

                {items.map((f, i) => (
                  <div key={f.id} style={{
                    background: "#0c1220", border: "1px solid #1e2d55",
                    borderLeft: `3px solid ${getRiskColor(level as RiskLevel)}`,
                    borderRadius: "10px", padding: "16px 20px",
                    marginBottom: "10px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
                      <div style={{ fontSize: "14px", fontWeight: "600", color: f.status === "resolved" ? "#6b7fa8" : "#e8edf8", flex: 1,
                                    textDecoration: f.status === "resolved" ? "line-through" : "none" }}>
                        <span style={{ color: "#4d91ff", fontWeight: 600, textDecoration: "none", display: "inline-block", marginRight: "6px" }}>{codeOf.get(f.id)}</span>
                        {f.title}
                      </div>
                      {f.evidence_status && (
                        <span style={{
                          fontSize: "10px", padding: "3px 9px", borderRadius: "10px",
                          fontWeight: "600", whiteSpace: "nowrap",
                          color:      getEvidenceStatusColor(f.evidence_status),
                          background: getEvidenceStatusBgColor(f.evidence_status),
                        }}>
                          {getEvidenceStatusLabel(f.evidence_status)}
                        </span>
                      )}
                    </div>

                    {f.description && (
                      <div style={{ fontSize: "13px", color: "#7a90c0", marginTop: "8px", lineHeight: "1.5" }}>
                        {f.description}
                      </div>
                    )}

                    {f.financial_impact && (
                      <div style={{ fontSize: "12px", color: "#c9d4ee", marginTop: "6px" }}>
                        <strong>Финансовое влияние:</strong> {f.financial_impact}
                      </div>
                    )}

                    {f.legal_basis && (
                      <div style={{ fontSize: "12px", color: "#3d4f7a", marginTop: "6px" }}>
                        📋 {f.legal_basis}
                      </div>
                    )}

                    {f.recommendation && (
                      <div style={{
                        marginTop: "10px", padding: "10px 12px",
                        background: "#080f1e", borderRadius: "6px",
                        fontSize: "12px", color: "#4d91ff", lineHeight: "1.5",
                      }}>
                        💡 {f.recommendation}
                      </div>
                    )}

                    {/* Stage 2: a corrected assessment. The agent proposes, the client decides. */}
                    {f.revised_at && f.revision_summary && (
                      <div style={{ marginTop: "10px", fontSize: "12px", color: "#c9b27a", lineHeight: 1.5, whiteSpace: "pre-line" }}>
                        <strong style={{ color: "#e0b85a" }}>Оценка исправлена по вашему решению.</strong>{"\n"}{f.revision_summary}
                      </div>
                    )}
                    {f.status !== "resolved" && f.revision_proposed_at && f.proposed_revision && (
                      <div style={{ marginTop: "10px", padding: "12px", background: "#2a220c", border: "1px solid #8a6a1f", borderRadius: "6px", fontSize: "12px", color: "#a9b8dc", lineHeight: 1.55 }}>
                        <div style={{ color: "#e0b85a", marginBottom: "4px" }}>ИИ-аудитор предлагает исправить оценку этого вывода · решение принимаете вы</div>
                        {f.proposed_revision.risk_level && <div>Уровень: {f.risk_level} → <strong style={{ color: "#e8edf8" }}>{f.proposed_revision.risk_level}</strong></div>}
                        {f.proposed_revision.evidence_status && <div>Статус: {EVIDENCE_RU[f.evidence_status ?? ""] ?? "—"} → <strong style={{ color: "#e8edf8" }}>{EVIDENCE_RU[f.proposed_revision.evidence_status]}</strong></div>}
                        {REVISION_TEXT_FIELDS.filter(([k]) => f.proposed_revision?.[k]).map(([k, label]) => (
                          <div key={k}><strong style={{ color: "#c9d4ee" }}>{label} (новое):</strong> {f.proposed_revision?.[k]}</div>
                        ))}
                        {f.revision_basis && <div><strong style={{ color: "#c9d4ee" }}>Почему:</strong> {f.revision_basis}</div>}
                        <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                          <button disabled={deciding !== null} onClick={() => decide(f.id, "confirm_revision")} style={{
                            padding: "7px 14px", background: "#b8860b", border: "none", borderRadius: "6px", color: "#fff",
                            fontSize: "12px", fontWeight: 600, cursor: deciding ? "default" : "pointer", opacity: deciding ? 0.6 : 1,
                          }}>Подтвердить исправление</button>
                          <button disabled={deciding !== null} onClick={() => decide(f.id, "decline_revision")} style={{
                            padding: "7px 14px", background: "transparent", border: "1px solid #1e2d55", borderRadius: "6px", color: "#7a90c0",
                            fontSize: "12px", cursor: deciding ? "default" : "pointer", opacity: deciding ? 0.6 : 1,
                          }}>Оставить как есть</button>
                        </div>
                        {decideError && deciding === null && (
                          <div style={{ marginTop: "6px", fontSize: "12px", color: "#e84040" }}>{decideError}</div>
                        )}
                      </div>
                    )}

                    {/* Stage 2: closing. The agent proposes, the client decides. */}
                    {f.status === "resolved" ? (
                      <div style={{ marginTop: "10px", padding: "10px 12px", background: "#0c2a22", border: "1px solid #1f7a5c", borderRadius: "6px", fontSize: "12px", color: "#a9d9c5", lineHeight: 1.55 }}>
                        <strong style={{ color: "#2ecc8f" }}>{f.resolution_kind === "corrected" ? "Нарушение устранено" : "Закрыто по подтверждающим документам"} · {ruDate(f.resolved_at)}, по вашему решению.</strong>{" "}
                        {f.resolution_basis && <>Основание: {f.resolution_basis} </>}
                        {f.resolution_documents && <span style={{ color: "#6fa893" }}>Документы: {f.resolution_documents}. </span>}
                        <button disabled={deciding !== null} onClick={() => decide(f.id, "reopen")} style={{
                          marginLeft: "6px", background: "transparent", border: "none", color: "#7a90c0", fontSize: "12px",
                          textDecoration: "underline", cursor: deciding ? "default" : "pointer", padding: 0,
                        }}>Открыть заново</button>
                      </div>
                    ) : f.proposed_at ? (
                      <div style={{ marginTop: "10px", padding: "12px", background: "#0c2a22", border: "1px solid #1f7a5c", borderRadius: "6px", fontSize: "12px", color: "#a9b8dc", lineHeight: 1.55 }}>
                        <div style={{ color: "#6fd3ad", marginBottom: "4px" }}>ИИ-аудитор предлагает закрыть этот вывод{f.proposal_kind === "corrected" ? " как устранённое нарушение" : f.proposal_kind === "documented" ? " по подтверждающим документам" : ""} · решение принимаете вы</div>
                        {f.proposal_basis && <div><strong style={{ color: "#c9d4ee" }}>Основание:</strong> {f.proposal_basis}</div>}
                        {f.proposal_documents && <div style={{ color: "#7a90c0" }}>Документы: {f.proposal_documents}</div>}
                        <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                          <button disabled={deciding !== null} onClick={() => decide(f.id, "confirm")} style={{
                            padding: "7px 14px", background: "#1f9d6f", border: "none", borderRadius: "6px", color: "#fff",
                            fontSize: "12px", fontWeight: 600, cursor: deciding ? "default" : "pointer", opacity: deciding ? 0.6 : 1,
                          }}>Подтвердить закрытие</button>
                          <button disabled={deciding !== null} onClick={() => decide(f.id, "decline")} style={{
                            padding: "7px 14px", background: "transparent", border: "1px solid #1e2d55", borderRadius: "6px", color: "#7a90c0",
                            fontSize: "12px", cursor: deciding ? "default" : "pointer", opacity: deciding ? 0.6 : 1,
                          }}>Оставить открытым</button>
                        </div>
                      </div>
                    ) : f.agent_note ? (
                      <div style={{ marginTop: "10px", fontSize: "12px", color: "#7a90c0", lineHeight: 1.5 }}>
                        <strong style={{ color: "#a9b8dc" }}>По загруженным документам вывод остаётся открытым.</strong> {f.agent_note}
                      </div>
                    ) : null}
                    {f.status !== "resolved" && !f.proposed_at && (
                      <div style={{ marginTop: "8px", fontSize: "11px", color: "#3d4f7a" }}>
                        Чтобы ИИ-аудитор оценил этот вывод заново по всем загруженным документам, напишите в чате аудита: «Пересмотри вывод {codeOf.get(f.id)}».
                      </div>
                    )}
                    {decideError && deciding === null && f.proposed_at && (
                      <div style={{ marginTop: "6px", fontSize: "12px", color: "#e84040" }}>{decideError}</div>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {tab === "chat" && (
        <div style={{
          background: "#0c1220", border: "1px solid #1e2d55",
          borderRadius: "12px", padding: "20px",
        }}>
          {messages.length === 0 ? (
            <div style={{ textAlign: "center", color: "#3d4f7a", fontSize: "14px", padding: "40px 0" }}>
              История сообщений пуста
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {messages.map((msg, i) => (
                <div key={i} style={{
                  display: "flex",
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                }}>
                  <div style={{
                    maxWidth: "75%",
                    padding: "12px 16px",
                    borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                    background: msg.role === "user" ? "#1565e8" : "#0d1f3e",
                    border: msg.role === "assistant" ? "1px solid #1e2d55" : "none",
                    fontSize: "13px", lineHeight: "1.6",
                    color: "#e8edf8",
                    whiteSpace: "pre-wrap",
                  }}>
                    {msg.role === "assistant" && (
                      <div style={{ fontSize: "10px", color: "#4d91ff", fontWeight: "700", marginBottom: "6px", letterSpacing: "0.05em" }}>
                        ИИ АУДИТОР
                      </div>
                    )}
                    {msg.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
