"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getRiskColor, getRiskBgColor, type RiskLevel,
  getEvidenceStatusLabel, getEvidenceStatusColor, getEvidenceStatusBgColor, type EvidenceStatus,
} from "@/lib/billing";

const LOGO_BASE64 =
  "data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAAzAmsDASIAAhEBAxEB/8QAHAAAAgIDAQEAAAAAAAAAAAAAAAcFBgMECAIB/8QAWRAAAQMCAwEHDQsIBwUJAAAAAQACAwQFBgcREiExQVFhcRQXFzI2UnSBg6Gxs8HSFSIjN2ZykZOksuIzUkRUYsLD0RYkRYKElKI0RURW8SVDRlNjkqPh8P/EABsBAAIDAQEBAAAAAAAAAAAAAAUGAAQHAwIB/8QAQxEAAQMDAAQJBwsEAQUAAAAAAQACAwQFEQYhMXESIkFRYYGRsdEWNDZyocHhExQVMjNCUlOCsvAjNpLSoiRDYsLx/9oADAMBAAIRAxEAPwDjJCEKKITdyfwnFFQG+XOnZJJUN0po5GghrO60PGeLm6VSst8NOxFfWtmaeoafR9Q7l5GdJ82qfcskFJSulkcyGCFhLid5rGgeYBO+idoEhNbMOKPq55+U9XfuStpDcSwfNojrO3w6/wCbV4koqOSmkpn0sJhkaWPZsABwO8QkBj3Dc2G726n0c6kl1fTSHjbyHnHAfAeNMnB2YMV5xNVW2oa2GGZ/9Qcd4kAdi7nOmo8I5FZMZWCnxHZJaGbRso9/BKR+TeOA9HEeZG7lS01+ozJSnLmk46uTr2jqQuiqJrTU8CccV2M+PVyrnFCz3CkqKCtmoquMxTwvли9HEeZG7lS01+ozJSnLmk46uTr2jqQuiqJrTU8CccV2M+PVyrnFCz3CkqKCtmoquMxTwvли9/BKR+TeOA9HEeZG7lS01+ozJSnLmk46uTr2jqQuiqJrTU8CccV2M+PVyrnFCz3CkqKCtmoquMxTwvMnEWsGAoUXHEUJAGSsSEybJlPXzxNlutwjpCRruUTd0cOYnUAHo1U03KWz6e+udcTzBg9SP";

async function generatePDF(session: SessionDetail, findings: Finding[]) {
  const pdfMake  = (await import("pdfmake/build/pdfmake")).default;
  const pdfFonts = (await import("pdfmake/build/vfs_fonts")).default;
  (pdfMake as any).vfs = (pdfFonts as any).vfs;

  const RISK_ORDER_LOCAL = ["КРИТИЧНО", "СУЩЕСТВЕННО", "НЕСУЩЕСТВЕННО"] as const;

  // transactions_ct is often 0 in DB — extract real count from findings text
  const txFromFindings = (() => {
    for (const f of findings) {
      const m = (f.description + " " + f.title).match(/(\d+)\s*(финансов|транзакц|операци)/i);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  })();
  const transactionCount = session.transactions_ct || txFromFindings;

  // Executive Premium Light Palette
  const colors = {
    textMain: "#1a1a1a",
    textMuted: "#555555",
    textLight: "#888888",
    bgCard: "#f8f9fa",
    primary: "#1e2d55",
    accentBlue: "#1565e8",   // Matches your specific brand color '24'
    brandDark: "#0c1220",    // Premium dark color for clean typography contrast
    red: "#c0392b",          // Critical
    amber: "#d35400",        // Significant
    green: "#27ae60",        // Minor / Safe
  };

  const RISK_COLORS: Record<string, string> = {
    "КРИТИЧНО":      colors.red,
    "СУЩЕСТВЕННО":   colors.amber,
    "НЕСУЩЕСТВЕННО": colors.green,
  };

  // Evidence-confidence labels for the PDF — distinct axis from risk level,
  // so a reader never mistakes a weak signal for a proven violation.
  const EVIDENCE_LABELS: Record<EvidenceStatus, string> = {
    confirmed: "Подтверждённое нарушение",
    risk_flag:  "Признак риска",
    indirect:   "Косвенный признак",
  };

  const allFindings  = findings;
  const criticalCt   = allFindings.filter(f => f.risk_level === "КРИТИЧНО").length;
  const majorCt      = allFindings.filter(f => f.risk_level === "СУЩЕСТВЕННО").length;
  const minorCt      = allFindings.filter(f => f.risk_level === "НЕСУЩЕСТВЕННО").length;
  const validPeriod  = session.period && session.period !== "All periods" ? session.period : null;
  const auditDate    = new Date(session.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const reportDate   = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

  function findingsSection(level: string): any[] {
    const items = allFindings.filter(f => f.risk_level === level);
    if (!items.length) return [];
    const color = RISK_COLORS[level] || colors.textLight;
    
    const rows: any[] = [{
      text: [
        { text: `■ ${level}`, color, fontSize: 13, bold: true },
        { text: `  (${items.length} нарушени${items.length === 1 ? "е" : "й"})`, color: colors.textLight, fontSize: 11, bold: false },
      ],
      margin: [0, 20, 0, 10],
    }];

    items.forEach((f, i) => {
      const evidenceLabel = f.evidence_status ? EVIDENCE_LABELS[f.evidence_status] : null;

      rows.push({
        table: {
          dontBreakRows: true,
          widths: ["*"],
          body: [[{
            stack: [
              {
                columns: [
                  { text: `${i + 1}. ${f.title}`, bold: true, fontSize: 12, color: colors.textMain, width: "*" },
                  { text: level, bold: true, fontSize: 9, color: color, alignment: "right", width: "auto" }
                ],
                margin: [0, 0, 0, 4]
              },
              ...(evidenceLabel ? [{
                text: evidenceLabel,
                fontSize: 8.5,
                italics: true,
                color: colors.textLight,
                margin: [0, 0, 0, 8],
              }] : []),
              ...(f.description ? [{ text: f.description, fontSize: 10, color: colors.textMuted, margin: [0, 0, 0, 8], lineHeight: 1.3 }] : []),
              ...(f.legal_basis ? [{ 
                text: [
                  { text: "Основание: ", bold: true, color: colors.textMain },
                  { text: f.legal_basis }
                ], 
                fontSize: 9, 
                color: colors.textMuted, 
                margin: [0, 0, 0, 8] 
              }] : []),
              ...(f.recommendation ? [{
                table: {
                  widths: ["*"],
                  body: [[{
                    text: `💡 Рекомендация: ${f.recommendation}`,
                    fontSize: 9.5,
                    color: colors.primary,
                    lineHeight: 1.3
                  }]]
                },
                layout: "noBorders",
                fillColor: "#eef3f9",
                margin: [0, 4, 0, 0]
              }] : []),
            ],
            fillColor: colors.bgCard,
            padding: [12, 12, 12, 12],
            border: [true, false, false, false],
          }]],
        },
        layout: {
          vLineColor: () => color,
          vLineWidth: () => 4,
        },
        margin: [0, 0, 0, 12],
      });
    });
    return rows;
  }

  const docDefinition: any = {
    pageSize: "A4",
    pageMargins: [45, 45, 45, 55],
    
    footer: (currentPage: number, pageCount: number) => ({
      stack: [
        {
          canvas: [{ type: "line", x1: 45, y1: 0, x2: 550, y2: 0, lineWidth: 0.5, strokeColor: "#e0e0e0" }],
          margin: [0, 0, 0, 8]
        },
        {
          columns: [
            { text: "Автоматический аудит платформы Assistant24", fontSize: 8, color: colors.textLight, margin: [45, 0, 0, 0] },
            { text: `Страница ${currentPage} из ${pageCount}`, fontSize: 8, color: colors.textLight, alignment: "right", margin: [0, 0, 45, 0] },
          ]
        }
      ]
    }),

    content: [
      // Clean Minimalist Header Layout
      {
        columns: [
          {
            text: [
              { text: "Assistant", bold: true, color: colors.brandDark, fontSize: 22 },
              { text: "24", bold: true, color: colors.accentBlue, fontSize: 22 }
            ],
            margin: [0, 0, 0, 0],
            width: "*"
          },
          { 
            text: "ОТЧЁТ ОБ АУДИТЕ СИСТЕМЫ", 
            fontSize: 10, 
            bold: true, 
            color: colors.textLight, 
            alignment: "right" as const, 
            margin: [0, 12, 0, 0],
            width: "auto"
          }
        ],
        margin: [0, 5, 0, 15]
      },

      // Thin Elegant Top Dividing Ruler Line
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 505, y2: 0, lineWidth: 1, strokeColor: "#e2e8f0" }], margin: [0, 0, 0, 20] },

      // Metadata Block
      {
        columns: [
          {
            stack: [
              { text: "Объект аудита:", fontSize: 9, color: colors.textLight },
              { text: session.company_name, fontSize: 18, bold: true, color: colors.primary, margin: [0, 2, 0, 12] },
              ...(validPeriod ? [{ text: `Проверяемый период: ${validPeriod}`, fontSize: 10, color: colors.textMuted }] : []),
            ],
            width: "*"
          },
          {
            stack: [
              { text: `Дата проверки: ${auditDate}`, fontSize: 10, color: colors.textMuted, alignment: "right" },
              { text: `Дата отчёта: ${reportDate}`, fontSize: 10, color: colors.textMuted, alignment: "right", margin: [0, 4, 0, 0] },
            ],
            width: "auto"
          }
        ],
        margin: [0, 0, 0, 25]
      },

      { text: "Сводные показатели", fontSize: 13, bold: true, color: colors.primary, margin: [0, 10, 0, 10] },
      
      // Horizontal KPI Dashboard Metrics Grid
      {
        columns: [
          {
            stack: [
              { text: "Проверено транзакций", fontSize: 9, color: colors.textLight, alignment: "center" },
              { text: transactionCount?.toLocaleString("ru-RU") || "—", fontSize: 18, bold: true, color: colors.accentBlue, alignment: "center", margin: [0, 4, 0, 0] }
            ],
            fillColor: colors.bgCard,
            margin: [0, 0, 6, 0],
            padding: [10, 10, 10, 10]
          },
          {
            stack: [
              { text: "Критичные риски", fontSize: 9, color: colors.textLight, alignment: "center" },
              { text: criticalCt.toString(), fontSize: 18, bold: true, color: criticalCt > 0 ? colors.red : colors.green, alignment: "center", margin: [0, 4, 0, 0] }
            ],
            fillColor: colors.bgCard,
            margin: [3, 0, 3, 0],
            padding: [10, 10, 10, 10]
          },
          {
            stack: [
              { text: "Существенные риски", fontSize: 9, color: colors.textLight, alignment: "center" },
              { text: majorCt.toString(), fontSize: 18, bold: true, color: majorCt > 0 ? colors.amber : colors.textMuted, alignment: "center", margin: [0, 4, 0, 0] }
            ],
            fillColor: colors.bgCard,
            margin: [3, 0, 3, 0],
            padding: [10, 10, 10, 10]
          },
          {
            stack: [
              { text: "Стоимость аудита", fontSize: 9, color: colors.textLight, alignment: "center" },
              { text: session.cost_rub ? `${session.cost_rub.toLocaleString("ru-RU")} ₽` : "—", fontSize: 15, bold: true, color: colors.primary, alignment: "center", margin: [0, 6, 0, 0] }
            ],
            fillColor: colors.bgCard,
            margin: [6, 0, 0, 0],
            padding: [10, 10, 10, 10]
          }
        ],
        margin: [0, 0, 0, 25]
      },

      // Executive Summary Panel
      {
        table: {
          widths: ["*"],
          body: [[{
            stack: [
              { text: "Итоговое заключение", fontSize: 11, bold: true, color: colors.primary, margin: [0, 0, 0, 4] },
              {
                text: criticalCt > 0
                  ? `Внимание: По результатам автоматизированного анализа financial активности компании выявлено ${criticalCt} критичных нарушений требований законодательства РФ. Рекомендуется инициировать корректирующие мероприятия незамедлительно для минимизации налоговых и административных рисков.`
                  : allFindings.length > 0
                    ? "По результатам аудита критических системных несоответствий не обнаружено. Выявленные замечания носят локальный характер и подлежат штатному исправлению."
                    : "По результатам комплексного аудита нарушений нормативных регламентов не выявлено. Финансовые транзакции полностью соответствуют действующим стандартам бухгалтерского учёта.",
                fontSize: 10, color: colors.textMain, lineHeight: 1.4
              }
            ],
            fillColor: criticalCt > 0 ? "#fdf2f2" : "#f0f9f4",
            padding: [12, 12, 12, 12],
            border: [true, true, true, true]
          }]]
        },
        layout: {
          hLineColor: () => criticalCt > 0 ? "#f5c6cb" : "#c3e6cb",
          vLineColor: () => criticalCt > 0 ? "#f5c6cb" : "#c3e6cb",
          hLineWidth: () => 1, vLineWidth: () => 1
        },
        margin: [0, 0, 0, 30]
      },

      // Detailed Registry of Findings Breakdown
      ...(allFindings.length === 0 ? [] : [
        { text: "Подробный реестр выявленных нарушений", fontSize: 14, bold: true, color: colors.primary, margin: [0, 10, 0, 5], pageBreak: "before" as const },
        ...RISK_ORDER_LOCAL.flatMap(level => findingsSection(level)),
      ]),
    ],
    defaultStyle: { font: "Roboto", fontSize: 10, color: colors.textMain },
  };

  const doc = pdfMake.createPdf(docDefinition);
  const safeName = session.company_name.replace(/[^а-яёА-ЯЁa-zA-Z0-9]/g, "_");
  const fileName = `Аудит_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.download(fileName);
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
}

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
                Период: {session.period}
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
                  await generatePDF(session, findings);
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
                ? session.cost_rub.toLocaleString("ru", { style: "currency", currency: "RUB", maximumFractionDigits: 0 })
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
                      <div style={{ fontSize: "14px", fontWeight: "600", color: "#e8edf8", flex: 1 }}>
                        {i + 1}. {f.title}
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
