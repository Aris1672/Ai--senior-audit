import { createAdminClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

const LOGO_BASE64 = "data:image/png;base64,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";

const RISK_ORDER = ["КРИТИЧНО", "СУЩЕСТВЕННО", "НЕСУЩЕСТВЕННО"] as const;

const RISK_COLORS: Record<string, string> = {
  "КРИТИЧНО":      "#e84040",
  "СУЩЕСТВЕННО":   "#f59e0b",
  "НЕСУЩЕСТВЕННО": "#2ecc8f",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
  const { id: sessionId } = await params;
  const supabase  = createAdminClient();

  // ── 1. Fetch all data ────────────────────────────────────────────────────
  const [
    { data: sessionRaw },
    { data: findings },
    { data: messages },
  ] = await Promise.all([
    supabase
      .from("audit_sessions")
      .select("id, title, status, transactions_ct, findings_ct, cost_rub, created_at")
      .eq("id", sessionId)
      .single(),
    supabase
      .from("findings")
      .select("id, risk_level, title, description, legal_basis, recommendation, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true }),
    supabase
      .from("audit_messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true }),
  ]);

  if (!sessionRaw) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Parse company name and period from title
  const title        = sessionRaw.title || "";
  const companyMatch = title.match(/Аудит:\s*(.+?)(?:\s*\(|$)/);
  const periodMatch  = title.match(/\((.+?)\)/);
  const companyName  = companyMatch?.[1]?.trim() || title;
  const period       = periodMatch?.[1]?.trim() || "";
  const validPeriod  = period && period !== "All periods" ? period : null;

  const allFindings = findings || [];
  const criticalCt  = allFindings.filter(f => f.risk_level === "КРИТИЧНО").length;
  const majorCt     = allFindings.filter(f => f.risk_level === "СУЩЕСТВЕННО").length;
  const minorCt     = allFindings.filter(f => f.risk_level === "НЕСУЩЕСТВЕННО").length;

  const auditDate = new Date(sessionRaw.created_at).toLocaleDateString("ru-RU", {
    day: "numeric", month: "long", year: "numeric",
  });
  const reportDate = new Date().toLocaleDateString("ru-RU", {
    day: "numeric", month: "long", year: "numeric",
  });

  // ── 2. Build pdfmake document definition ────────────────────────────────
  // Dynamically import pdfmake (server-side only)
  const pdfMake  = (await import("pdfmake/build/pdfmake")).default;
  const pdfFonts = (await import("pdfmake/build/vfs_fonts")).default;
  (pdfMake as any).vfs = (pdfFonts as any).vfs;

  const colors = {
    dark:   "#0c1220",
    mid:    "#1e2d55",
    light:  "#7a90c0",
    white:  "#e8edf8",
    blue:   "#4d91ff",
    green:  "#2ecc8f",
    amber:  "#f59e0b",
    red:    "#e84040",
  };

  // Helper: findings section for one risk level
  function findingsSection(level: string): any[] {
    const items = allFindings.filter(f => f.risk_level === level);
    if (!items.length) return [];

    const color = RISK_COLORS[level] || "#888";

    const rows: any[] = [
      // Section header
      {
        text: [
          { text: "● ", color, fontSize: 14 },
          { text: level, color, fontSize: 12, bold: true },
          { text: `  (${items.length} нарушени${items.length === 1 ? "е" : "й"})`, color: colors.light, fontSize: 11 },
        ],
        margin: [0, 16, 0, 12],
        background: "#1a2340",
        padding: [4, 4, 4, 4],
      },
    ];

    items.forEach((f, i) => {
      rows.push(
        // Finding card background
        {
          table: {
            widths: ["*"],
            body: [[
              {
                stack: [
                  // Title
                  {
                    text: `${i + 1}. ${f.title}`,
                    bold: true,
                    fontSize: 11,
                    color: colors.white,
                    margin: [0, 0, 0, 6],
                  },
                  // Description
                  ...(f.description ? [{
                    text: f.description,
                    fontSize: 10,
                    color: colors.light,
                    margin: [0, 0, 0, 6],
                  }] : []),
                  // Legal basis
                  ...(f.legal_basis ? [{
                    text: `📋 ${f.legal_basis}`,
                    fontSize: 9,
                    color: "#4d5f8a",
                    margin: [0, 0, 0, 6],
                  }] : []),
                  // Recommendation
                  ...(f.recommendation ? [{
                    table: {
                      widths: ["*"],
                      body: [[{
                        text: `💡 ${f.recommendation}`,
                        fontSize: 9,
                        color: colors.blue,
                        fillColor: "#080f1e",
                        margin: [6, 4, 6, 4],
                      }]],
                    },
                    layout: "noBorders",
                    margin: [0, 2, 0, 0],
                  }] : []),
                ],
                fillColor: "#0d1830",
                margin: [10, 10, 10, 10],
                border: [true, true, true, true],
              },
            ]],
          },
          layout: {
            hLineColor: () => color,
            vLineColor: () => color,
            hLineWidth: (i: number) => (i === 0 || i === 1) ? 1 : 0,
            vLineWidth: (i: number) => (i === 0 || i === 1) ? 1 : 0,
          },
          margin: [0, 0, 0, 10],
        }
      );
    });

    return rows;
  }

  const docDefinition: any = {
    pageSize:    "A4",
    pageMargins: [40, 60, 40, 60],

    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        {
          text: "Сформировано системой Assistant24",
          fontSize: 8,
          color: colors.light,
          margin: [40, 0, 0, 0],
        },
        {
          text: `Стр. ${currentPage} из ${pageCount}`,
          fontSize: 8,
          color: colors.light,
          alignment: "right",
          margin: [0, 0, 40, 0],
        },
      ],
      margin: [0, 10, 0, 0],
    }),

    content: [
      // ── COVER ────────────────────────────────────────────────────────────
      {
        image: LOGO_BASE64,
        width:  180,
        margin: [0, 0, 0, 40],
      },
      {
        text: " ",
        margin: [0, 0, 0, 30],
      },
      {
        text:   "ОТЧЁТ ОБ АУДИТЕ",
        fontSize: 28,
        bold:   true,
        color:  colors.white,
        margin: [0, 0, 0, 12],
      },
      {
        text:   companyName,
        fontSize: 20,
        color:  colors.blue,
        margin: [0, 0, 0, 8],
      },
      ...(validPeriod ? [{
        text:   `Период: ${validPeriod}`,
        fontSize: 12,
        color:  colors.light,
        margin: [0, 0, 0, 6],
      }] : []),
      {
        text:   `Дата аудита: ${auditDate}`,
        fontSize: 12,
        color:  colors.light,
        margin: [0, 0, 0, 6],
      },
      {
        text:   `Дата отчёта: ${reportDate}`,
        fontSize: 12,
        color:  colors.light,
        margin: [0, 0, 0, 40],
      },

      // ── SUMMARY TABLE ────────────────────────────────────────────────────
      {
        text:   "Сводная информация",
        fontSize: 14,
        bold:   true,
        color:  colors.white,
        margin: [0, 0, 0, 12],
      },
      {
        table: {
          widths: ["*", "*"],
          body: [
            [
              { text: "Параметр",   bold: true, color: colors.light, fillColor: "#1a2340", margin: [8, 6, 8, 6] },
              { text: "Значение",   bold: true, color: colors.light, fillColor: "#1a2340", margin: [8, 6, 8, 6] },
            ],
            [
              { text: "Транзакций проверено", color: colors.light, margin: [8, 6, 8, 6] },
              { text: sessionRaw.transactions_ct?.toString() || "—", color: colors.blue, bold: true, margin: [8, 6, 8, 6] },
            ],
            [
              { text: "Всего нарушений",      color: colors.light, margin: [8, 6, 8, 6] },
              { text: allFindings.length.toString(), color: allFindings.length > 0 ? colors.red : colors.green, bold: true, margin: [8, 6, 8, 6] },
            ],
            [
              { text: "Критичных нарушений",  color: colors.light, margin: [8, 6, 8, 6] },
              { text: criticalCt.toString(),  color: colors.red,   bold: true, margin: [8, 6, 8, 6] },
            ],
            [
              { text: "Существенных",         color: colors.light, margin: [8, 6, 8, 6] },
              { text: majorCt.toString(),     color: colors.amber, bold: true, margin: [8, 6, 8, 6] },
            ],
            [
              { text: "Несущественных",       color: colors.light, margin: [8, 6, 8, 6] },
              { text: minorCt.toString(),     color: colors.green, bold: true, margin: [8, 6, 8, 6] },
            ],
            /*[
              { text: "Стоимость аудита",     color: colors.light, margin: [8, 6, 8, 6] },
              {
                text: sessionRaw.cost_rub
                  ? sessionRaw.cost_rub.toLocaleString("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 })
                  : "—",
                color: colors.amber, bold: true, margin: [8, 6, 8, 6],
              },
            ],*/
          ],
        },
        layout: {
          fillColor:  (rowIndex: number) => rowIndex % 2 === 0 ? "#0c1220" : "#0d1830",
          hLineColor: () => colors.mid,
          vLineColor: () => colors.mid,
          hLineWidth: () => 1,
          vLineWidth: () => 1,
        },
        margin: [0, 0, 0, 40],
      },

      // ── FINDINGS ─────────────────────────────────────────────────────────
      ...(allFindings.length === 0 ? [{
        text:   "Нарушений не обнаружено",
        fontSize: 13,
        color:  colors.green,
        margin: [0, 0, 0, 20],
      }] : [
        {
          text:   "Выявленные нарушения",
          fontSize: 14,
          bold:   true,
          color:  colors.white,
          margin: [0, 0, 0, 8],
          pageBreak: "before",
        },
        ...RISK_ORDER.flatMap(level => findingsSection(level)),
      ]),

      // ── CONCLUSION ───────────────────────────────────────────────────────
      {
        text: " ",
        margin: [0, 24, 0, 24],
      },
      {
        text:   "Заключение",
        fontSize: 14,
        bold:   true,
        color:  colors.white,
        margin: [0, 0, 0, 8],
      },
      {
        text: criticalCt > 0
          ? `По результатам аудита выявлено ${criticalCt} критичных нарушени${criticalCt === 1 ? "е" : "й"}, требующих немедленного устранения. Рекомендуется незамедлительно принять меры по исправлению указанных нарушений и провести повторный аудит после их устранения.`
          : allFindings.length > 0
            ? `По результатам аудита серьёзных нарушений не выявлено. Обнаруженные замечания носят устранимый характер. Рекомендуется устранить выявленные нарушения в плановом порядке.`
            : "По результатам аудита нарушений не выявлено. Финансовая отчётность соответствует требованиям законодательства.",
        fontSize: 11,
        color:   colors.light,
        lineHeight: 1.5,
      },
    ],

    defaultStyle: {
      font:     "Roboto",
      fontSize: 11,
      color:    colors.white,
    },
  };

  // ── 3. Generate and stream PDF ───────────────────────────────────────────
  const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = pdfMake.createPdf(docDefinition);
      (doc as any).getBuffer((buffer: Uint8Array) => resolve(Buffer.from(buffer)));
    } catch (e) {
      reject(e);
    }
  });

  const safeName = companyName.replace(/[^а-яёА-ЯЁa-zA-Z0-9]/g, "_");
  const fileName = `Аудит_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`;

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
  } catch (err: any) {
    console.error("[report] PDF generation error:", err?.message || err);
    return NextResponse.json({ error: "PDF generation failed", detail: err?.message }, { status: 500 });
  }
}
