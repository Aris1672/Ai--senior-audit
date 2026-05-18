"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getRiskColor, getRiskBgColor, type RiskLevel } from "@/lib/billing";

const LOGO_BASE64 =
  "data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAAzAmsDASIAAhEBAxEB/8QAHAAAAgIDAQEAAAAAAAAAAAAAAAcFBgMECAIB/8QAWRAAAQMCAwEHDQsIBwUJAAAAAQACAwQFBgcREiExQVFhcRQXFzI2UnSBg6Gxs8HSFSIjN2ZykZOksuIzQlRVYsLD0RYkRYKElKI0RURW8SVDRlNjkqPh8P/EABsBAAIDAQEBAAAAAAAAAAAAAAUGAAQHAwIB/8QAQxEAAQMDAAQJBwsEAQUAAAAAAQACAwQFEQYhMXESIkFRYYGRsdEWNDVyocHhExQVMjNCUlOCsvAjNpLSoiRDYsLx/9oADAMBAAIRAxEAPwDjJCEKKITdyfwnFFQG+XOnZJJUN0po5GghrO60PGeLm6VSst8NOxFfWtmaeoafR9Q7l5GdJ82qfcskFJSulkcyGCFhLid5rGgeYBO+idoEhNbMOKPq55+U9XfuStpDcSwfNojrO3w6/wCbV4koqOSmkpn0sJhkaWPZsABwO8QkBj3Dc2G726n0c6kl1fTSHjbyHnHAfAeNMnB2YMV5xNVW2oa2GGZ/9Qcd4kAdi7nOmo8I5FZMZWCnxHZJaGbRso9/BKR+TeOA9HEeZG7lS01+ozJSnLmk46uTr2jqQuiqJrTU8CccV2M+PVyrnFCz3CkqKCtmoquMxTwvLHtPEQsCy5zS0kEawnwEOGQhCFlpKaerqY6alhfNNI7ZYxg1LioAXHAUJAGSsSEybJlPXzxNlutwjpCRruUTd0cOYnUAHo1U03KWz6e+udcTzBg9SP";

async function generatePDF(session: SessionDetail, findings: Finding[]) {
  const pdfMake  = (await import("pdfmake/build/pdfmake")).default;
  const pdfFonts = (await import("pdfmake/build/vfs_fonts")).default;
  (pdfMake as any).vfs = (pdfFonts as any).vfs;

  const RISK_ORDER_LOCAL = ["КРИТИЧНО", "СУЩЕСТВЕННО", "НЕСУЩЕСТВЕННО"] as const;
  const RISK_COLORS: Record<string, string> = {
    "КРИТИЧНО":      "#e84040",
    "СУЩЕСТВЕННО":   "#f59e0b",
    "НЕСУЩЕСТВЕННО": "#2ecc8f",
  };
  const colors = {
    mid: "#1e2d55", light: "#7a90c0", white: "#e8edf8",
    blue: "#4d91ff", green: "#2ecc8f", amber: "#f59e0b", red: "#e84040",
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
    const color = RISK_COLORS[level] || "#888";
    const rows: any[] = [{
      text: [
        { text: "● ", color, fontSize: 14 },
        { text: level, color, fontSize: 12, bold: true },
        { text: `  (${items.length} нарушени${items.length === 1 ? "е" : "й"})`, color: colors.light, fontSize: 11 },
      ],
      margin: [0, 16, 0, 12],
    }];
    items.forEach((f, i) => {
      rows.push({
        table: {
          widths: ["*"],
          body: [[{
            stack: [
              { text: `${i + 1}. ${f.title}`, bold: true, fontSize: 11, color: colors.white, margin: [0, 0, 0, 6] },
              ...(f.description    ? [{ text: f.description,    fontSize: 10, color: colors.light, margin: [0, 0, 0, 6] }] : []),
              ...(f.legal_basis    ? [{ text: `📋 ${f.legal_basis}`,    fontSize: 9, color: "#4d5f8a", margin: [0, 0, 0, 6] }] : []),
              ...(f.recommendation ? [{
                table: { widths: ["*"], body: [[{ text: `💡 ${f.recommendation}`, fontSize: 9, color: colors.blue, fillColor: "#080f1e", margin: [6, 4, 6, 4] }]] },
                layout: "noBorders", margin: [0, 2, 0, 0],
              }] : []),
            ],
            fillColor: "#0d1830", margin: [10, 10, 10, 10], border: [true, true, true, true],
          }]],
        },
        layout: { hLineColor: () => color, vLineColor: () => color, hLineWidth: () => 1, vLineWidth: () => 1 },
        margin: [0, 0, 0, 10],
      });
    });
    return rows;
  }

  const docDefinition: any = {
    pageSize: "A4",
    pageMargins: [40, 60, 40, 60],
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: "Сформировано системой Assistant24", fontSize: 8, color: colors.light, margin: [40, 0, 0, 0] },
        { text: `Стр. ${currentPage} из ${pageCount}`, fontSize: 8, color: colors.light, alignment: "right", margin: [0, 0, 40, 0] },
      ],
      margin: [0, 10, 0, 0],
    }),
    content: [
      { image: LOGO_BASE64, width: 180, margin: [0, 0, 0, 30] },
      { text: " ", margin: [0, 0, 0, 10] },
      { text: "ОТЧЁТ ОБ АУДИТЕ", fontSize: 28, bold: true, color: colors.white, margin: [0, 0, 0, 12] },
      { text: session.company_name, fontSize: 20, color: colors.blue, margin: [0, 0, 0, 8] },
      ...(validPeriod ? [{ text: `Период: ${validPeriod}`, fontSize: 12, color: colors.light, margin: [0, 0, 0, 6] }] : []),
      { text: `Дата аудита: ${auditDate}`,   fontSize: 12, color: colors.light, margin: [0, 0, 0, 6] },
      { text: `Дата отчёта: ${reportDate}`,  fontSize: 12, color: colors.light, margin: [0, 0, 0, 40] },
      { text: "Сводная информация", fontSize: 14, bold: true, color: colors.white, margin: [0, 0, 0, 12] },
      {
        table: {
          widths: ["*", "*"],
          body: [
            [{ text: "Параметр", bold: true, color: colors.light, fillColor: "#1a2340", margin: [8,6,8,6] }, { text: "Значение", bold: true, color: colors.light, fillColor: "#1a2340", margin: [8,6,8,6] }],
            [{ text: "Транзакций проверено", color: colors.light, margin: [8,6,8,6] }, { text: session.transactions_ct?.toString() || "—", color: colors.blue,  bold: true, margin: [8,6,8,6] }],
            [{ text: "Всего нарушений",      color: colors.light, margin: [8,6,8,6] }, { text: allFindings.length.toString(), color: allFindings.length > 0 ? colors.red : colors.green, bold: true, margin: [8,6,8,6] }],
            [{ text: "Критичных",            color: colors.light, margin: [8,6,8,6] }, { text: criticalCt.toString(), color: colors.red,   bold: true, margin: [8,6,8,6] }],
            [{ text: "Существенных",          color: colors.light, margin: [8,6,8,6] }, { text: majorCt.toString(),   color: colors.amber, bold: true, margin: [8,6,8,6] }],
            [{ text: "Несущественных",        color: colors.light, margin: [8,6,8,6] }, { text: minorCt.toString(),   color: colors.green, bold: true, margin: [8,6,8,6] }],
            [{ text: "Стоимость аудита",      color: colors.light, margin: [8,6,8,6] }, { text: session.cost_rub ? session.cost_rub.toLocaleString("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }) : "—", color: colors.amber, bold: true, margin: [8,6,8,6] }],
          ],
        },
        layout: { fillColor: (r: number) => r % 2 === 0 ? "#0c1220" : "#0d1830", hLineColor: () => colors.mid, vLineColor: () => colors.mid, hLineWidth: () => 1, vLineWidth: () => 1 },
        margin: [0, 0, 0, 40],
      },
      ...(allFindings.length === 0 ? [{ text: "Нарушений не обнаружено", fontSize: 13, color: colors.green, margin: [0,0,0,20] }] : [
        { text: "Выявленные нарушения", fontSize: 14, bold: true, color: colors.white, margin: [0,0,0,8], pageBreak: "before" },
        ...RISK_ORDER_LOCAL.flatMap(level => findingsSection(level)),
      ]),
      { text: " ", margin: [0, 24, 0, 24] },
      { text: "Заключение", fontSize: 14, bold: true, color: colors.white, margin: [0, 0, 0, 8] },
      {
        text: criticalCt > 0
          ? `По результатам аудита выявлено ${criticalCt} критичных нарушений, требующих немедленного устранения.`
          : allFindings.length > 0
            ? "По результатам аудита серьёзных нарушений не выявлено. Обнаруженные замечания носят устранимый характер."
            : "По результатам аудита нарушений не выявлено. Финансовая отчётность соответствует требованиям законодательства.",
        fontSize: 11, color: colors.light, lineHeight: 1.5,
      },
    ],
    defaultStyle: { font: "Roboto", fontSize: 11, color: colors.white },
  };

  await new Promise<void>((resolve, reject) => {
    try {
      const doc = pdfMake.createPdf(docDefinition);
      const safeName = session.company_name.replace(/[^а-яёА-ЯЁa-zA-Z0-9]/g, "_");
      const fileName = `Аудит_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`;
      doc.download(fileName, resolve);
    } catch (e) { reject(e); }
  });
}

interface Finding {
  id:             string;
  risk_level:     RiskLevel;
  title:          string;
  description:    string;
  legal_basis:    string;
  recommendation: string;
  created_at:     string;
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

  // Group findings by risk level
  const grouped = RISK_ORDER.reduce<Record<string, Finding[]>>((acc, level) => {
    const items = findings.filter(f => f.risk_level === level);
    if (items.length) acc[level] = items;
    return acc;
  }, {});

  return (
    <div style={{ maxWidth: "1100px" }}>

      {/* Back button */}
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

      {/* Header card */}
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

        {/* Stats row */}
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
      </div>

      {/* Tabs */}
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

      {/* Findings tab */}
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
                {/* Risk group header */}
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

                {/* Finding cards */}
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

      {/* Chat history tab */}
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
