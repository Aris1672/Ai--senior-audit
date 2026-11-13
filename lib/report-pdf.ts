/**
 * lib/report-pdf.ts — the audit report (PDF), as a pdfmake document definition.
 * Pure: no pdfmake import, no browser API. The audit page renders it with
 * pdfmake in the browser; scripts/render-report-sample.ts renders it in Node
 * for checking the layout.
 *
 * Design (Nov 13, 2026, user brief):
 *   · page 1 — executive summary: header, audit details bar, four KPIs,
 *     the conclusion in its own section, a one-line-per-finding register;
 *   · then one finding per card, full width, always the same structure:
 *     number and title · severity · type · description · financial impact ·
 *     legal basis · recommendation · resolution status and evidence;
 *   · one colour language everywhere: red — critical, orange — significant,
 *     blue — insignificant, green — closed, grey — neutral information;
 *   · "violation corrected" (it existed and was put right) is shown apart
 *     from "closed on supporting documents" (the documents remove the basis).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- pdfmake definitions are untyped object trees */

export interface ReportSession {
  company_name: string;
  period?: string | null;
  created_at: string;
  transactions_ct?: number | null;
  cost_rub?: number | null;
}

export interface ReportFinding {
  id: string;
  title: string;
  risk_level: string;                 // КРИТИЧНО | СУЩЕСТВЕННО | НЕСУЩЕСТВЕННО
  evidence_status?: string | null;    // confirmed | risk_flag | indirect
  description?: string | null;
  legal_basis?: string | null;
  recommendation?: string | null;
  financial_impact?: string | null;
  status: string;                     // open | resolved
  proposed_at?: string | null;
  proposal_basis?: string | null;
  agent_note?: string | null;
  resolved_at?: string | null;
  resolution_basis?: string | null;
  resolution_documents?: string | null;
  resolution_kind?: "corrected" | "documented" | null;
  revision_proposed_at?: string | null;
  revision_summary?: string | null;
}

// ─── Colour language ─────────────────────────────────────────────────────────
export const C = {
  navy: "#16244a", navySoft: "#2b3d6b", ink: "#1a1f2e", muted: "#555e70", light: "#8a93a6",
  line: "#dfe4ec", bg: "#f5f7fa", white: "#ffffff",
  red: "#c62828", redBg: "#fdecea",
  orange: "#d9730d", orangeBg: "#fff1e0",
  blue: "#1f6fd1", blueBg: "#e7f0fc",
  green: "#2e7d32", greenBg: "#e6f4e7", greenDark: "#1f5f24",
  grey: "#5b6475", greyBg: "#eef1f5",
};

const LEVELS = ["КРИТИЧНО", "СУЩЕСТВЕННО", "НЕСУЩЕСТВЕННО"] as const;
const LEVEL_COLOR: Record<string, [string, string]> = {
  "КРИТИЧНО": [C.red, C.redBg], "СУЩЕСТВЕННО": [C.orange, C.orangeBg], "НЕСУЩЕСТВЕННО": [C.blue, C.blueBg],
};
const EVIDENCE: Record<string, string> = {
  confirmed: "Подтверждённое нарушение", risk_flag: "Признак риска", indirect: "Косвенный признак",
};

// ─── Small helpers ───────────────────────────────────────────────────────────
function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}
export function rubles(n: number): string {
  const v = Number(n) || 0;
  const whole = Math.abs(v * 100 - Math.round(v) * 100) < 0.5;
  return v.toLocaleString("ru-RU", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).replace(/[  ]/g, " ");
}
const ruDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" }) : "");
const ruLongDate = (d: Date) => d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" });
export const ruPeriod = (p: string) => p.replace(/(\d{4})-(\d{2})-(\d{2})/g, "$3.$2.$1");

/**
 * Text the agent or the client wrote may hold characters the report font
 * (Roboto in pdfmake) has no glyph for — they would print as empty boxes.
 */
export function pdfText(v: string | null | undefined): string {
  return String(v ?? "")
    .replace(/→|⟶|➝|➔/g, "›").replace(/[✓✔☑]/g, "").replace(/⚠/g, "!").replace(/∙/g, "·")
    .replace(/[\u2600-\u27BF\uFE0F]|[\uD800-\uDFFF]/g, "")
    .replace(/[ \t]{2,}/g, " ").trim();
}

/** A coloured label with padding (a one-cell table). */
function badge(text: string, color: string, bg: string, opts: { solid?: boolean; size?: number } = {}): any {
  return {
    table: { body: [[{
      text: text.toUpperCase(), bold: true, fontSize: opts.size ?? 7.5, characterSpacing: 0.3,
      color: opts.solid ? C.white : color, fillColor: opts.solid ? color : bg, margin: [5, 2, 5, 1.5],
    }]] },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
    width: "auto",
  };
}

// ─── Icons (vector, so they print sharp) ─────────────────────────────────────
const LOGO_SVG = `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 37 L17 3 L24.5 3 L12 37 Z" fill="${C.navy}"/>
  <path d="M21.5 16 L26 5 L37 37 L29.5 37 Z" fill="${C.blue}"/>
  <path d="M14 27 L31 27 L32.8 32 L12.2 32 Z" fill="${C.navySoft}"/>
</svg>`;
const ICONS = {
  ops: (c: string) => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="4" width="14" height="17" rx="2" fill="none" stroke="${c}" stroke-width="1.8"/><rect x="9" y="2.5" width="6" height="3.5" rx="1" fill="${c}"/><path d="M8.5 11h7M8.5 14.5h7M8.5 18h4" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  critical: (c: string) => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 3 L22 20.5 L2 20.5 Z" fill="none" stroke="${c}" stroke-width="1.9" stroke-linejoin="round"/><path d="M12 9.5v5" stroke="${c}" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.6" r="1.2" fill="${c}"/></svg>`,
  material: (c: string) => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9.5" fill="none" stroke="${c}" stroke-width="1.9"/><path d="M12 7v6.5" stroke="${c}" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.8" r="1.2" fill="${c}"/></svg>`,
  closed: (c: string) => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9.5" fill="none" stroke="${c}" stroke-width="1.9"/><path d="M7.5 12.3 L10.7 15.4 L16.8 9" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  check: (c: string) => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="11" fill="${c}"/><path d="M7 12.4 L10.4 15.6 L17 8.8" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  doc: (c: string) => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="11" fill="${c}"/><path d="M8.5 6.5h5l2.5 2.5v8.5h-7.5z" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M10.3 12.5l1.4 1.4 2.6-2.8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

// ─── Counts and the conclusion ───────────────────────────────────────────────
export interface ReportCounts {
  total: number; open: number; critical: number; material: number; minor: number;
  closed: number; corrected: number; documented: number;
}
export function reportCounts(findings: ReportFinding[]): ReportCounts {
  const open = findings.filter(f => f.status !== "resolved");
  const closed = findings.filter(f => f.status === "resolved");
  return {
    total: findings.length, open: open.length, closed: closed.length,
    critical: open.filter(f => f.risk_level === "КРИТИЧНО").length,
    material: open.filter(f => f.risk_level === "СУЩЕСТВЕННО").length,
    minor: open.filter(f => f.risk_level === "НЕСУЩЕСТВЕННО").length,
    corrected: closed.filter(f => f.resolution_kind === "corrected").length,
    documented: closed.filter(f => f.resolution_kind !== "corrected").length,
  };
}

/** The verdict line and the conclusion. Says no more than the findings do. */
export function conclusion(c: ReportCounts): { verdict: string; color: string; bg: string; text: string } {
  const closedNote = c.closed > 0
    ? ` Закрыто ${c.closed} из ${c.total}` + (c.corrected > 0 ? `: нарушение устранено — ${c.corrected}, по подтверждающим документам — ${c.documented}.` : " по подтверждающим документам.")
    : "";
  if (c.critical > 0) return { verdict: "Выявлены критичные нарушения", color: C.red, bg: C.redBg,
    text: `По результатам проверки выявлено критичных нарушений: ${c.critical}` + (c.material > 0 ? `, существенных нарушений и признаков риска: ${c.material}` : "") +
      (c.minor > 0 ? `, несущественных замечаний: ${c.minor}` : "") + `. Критичные нарушения требуют незамедлительного исправления — см. реестр.${closedNote}` };
  if (c.material > 0) return { verdict: "Требуются исправления", color: C.orange, bg: C.orangeBg,
    text: `Критичных нарушений не выявлено. Выявлено существенных нарушений и признаков риска: ${c.material}` + (c.minor > 0 ? `; несущественных замечаний: ${c.minor}` : "") +
      `. Существенные нарушения требуют исправления и могут повлечь налоговые доначисления, штрафы и пени — см. реестр.${closedNote}` };
  if (c.minor > 0) return { verdict: "Только несущественные замечания", color: C.blue, bg: C.blueBg,
    text: `Критичных и существенных нарушений не выявлено. Несущественных замечаний: ${c.minor} — см. реестр.${closedNote}` };
  if (c.total > 0) return { verdict: "Все нарушения закрыты", color: C.green, bg: C.greenBg,
    text: `Все выявленные нарушения закрыты (${c.closed})` + (c.corrected > 0 ? `: нарушение устранено — ${c.corrected}, по подтверждающим документам — ${c.documented}` : " по подтверждающим документам") + ". Основания — в реестре." };
  return { verdict: "Нарушений не выявлено", color: C.green, bg: C.greenBg,
    text: "В пределах проверенных данных нарушений не выявлено. Вывод относится только к представленным документам и периоду." };
}

/** Status of a finding as shown in the badges, the register and the card. */
export function findingState(f: ReportFinding): { label: string; color: string; bg: string; solid: boolean } {
  if (f.status === "resolved") return f.resolution_kind === "corrected"
    ? { label: "Нарушение устранено", color: C.green, bg: C.greenBg, solid: true }
    : { label: "Закрыто по документам", color: C.green, bg: C.greenBg, solid: false };
  if (f.proposed_at) return { label: "Ожидает решения", color: C.grey, bg: C.greyBg, solid: false };
  return { label: "Открыто", color: LEVEL_COLOR[f.risk_level]?.[0] ?? C.grey, bg: LEVEL_COLOR[f.risk_level]?.[1] ?? C.greyBg, solid: false };
}

// ─── Pieces of the page ──────────────────────────────────────────────────────
function sectionTitle(text: string, margin: number[] = [0, 18, 0, 8]): any {
  return {
    columns: [
      { canvas: [{ type: "rect", x: 0, y: 1, w: 3.5, h: 14, color: C.blue }], width: 10 },
      { text, fontSize: 12.5, bold: true, color: C.navy, characterSpacing: 0.4 },
    ],
    margin, headlineLevel: 3,
  };
}

function kpiCard(icon: string, label: string, value: string, sub: string, color: string, bg: string): any {
  return {
    table: {
      widths: ["*"],
      body: [[{
        stack: [
          { columns: [
            { table: { body: [[{ svg: icon, width: 18, height: 18, fillColor: bg, margin: [6, 6, 6, 5] }]] },
              layout: "noBorders", width: "auto" },
            { text: value, fontSize: value.length > 5 ? 17 : 21, bold: true, color, alignment: "right", margin: [0, value.length > 5 ? 4 : 2, 0, 0] },
          ] },
          { text: label, fontSize: 7.4, bold: true, color: C.ink, characterSpacing: 0.3, margin: [0, 9, 0, 0] },
          { text: sub, fontSize: 7.3, color: C.light, margin: [0, 2, 0, 0] },
        ],
        margin: [10, 10, 10, 10],
      }]],
    },
    layout: {
      hLineWidth: (i: number) => (i === 0 ? 3 : 0.8), vLineWidth: () => 0.8,
      hLineColor: (i: number) => (i === 0 ? color : C.line), vLineColor: () => C.line,
      paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
    },
  };
}

function labelled(label: string, content: any): any[] {
  return [
    { text: label.toUpperCase(), fontSize: 7, bold: true, color: C.light, characterSpacing: 0.4, margin: [0, 1.5, 0, 0] },
    content,
  ];
}

function findingCard(f: ReportFinding, code: string): any {
  const [lc, lbg] = LEVEL_COLOR[f.risk_level] ?? [C.grey, C.greyBg];
  const state = findingState(f);
  const closed = f.status === "resolved";
  const stripe = closed ? C.green : lc;
  const text = (t: string, extra: any = {}) => ({ text: t, fontSize: 9.3, color: C.ink, lineHeight: 1.25, ...extra });

  const header = {
    columns: [
      { table: { body: [[{ text: code, bold: true, fontSize: 12, color: C.white, fillColor: C.navy, alignment: "center", margin: [7, 6, 7, 5] }]] },
        layout: "noBorders", width: "auto" },
      { stack: [
        { columns: [
          badge(f.risk_level, lc, lbg, { solid: true }),
          ...(f.evidence_status && EVIDENCE[f.evidence_status] ? [badge(EVIDENCE[f.evidence_status], C.grey, C.greyBg)] : []),
          badge(state.label, state.color, state.bg, { solid: state.solid }),
        ], columnGap: 5 },
        { text: f.title, fontSize: 12.5, bold: true, color: closed ? C.muted : C.ink, margin: [0, 5, 0, 0], lineHeight: 1.1 },
      ], margin: [10, 0, 0, 0] },
    ],
  };

  // Fixed order of the body rows; a row with no data is left out.
  const rows: any[][] = [];
  if (f.description) rows.push(labelled("Описание", text(f.description)));
  if (f.financial_impact) rows.push(labelled("Финансовое влияние", text(f.financial_impact, { bold: true })));
  if (f.legal_basis) rows.push(labelled("Правовое основание", text(f.legal_basis, { color: C.muted })));
  if (f.recommendation) rows.push(labelled("Рекомендация", {
    table: { widths: ["*"], body: [[{ text: f.recommendation, fontSize: 9.3, color: C.navy, lineHeight: 1.25, fillColor: C.blueBg, margin: [8, 5, 8, 5] }]] },
    layout: "noBorders",
  }));
  if (f.revision_summary) rows.push(labelled("Оценка исправлена", text(f.revision_summary, { color: C.grey, fontSize: 8.5 })));

  // Resolution status and evidence — always the last row.
  let resolution: any;
  if (closed) {
    const corrected = f.resolution_kind === "corrected";
    resolution = {
      table: { widths: [18, "*"], body: [[
        { svg: corrected ? ICONS.check(C.green) : ICONS.doc(C.green), width: 15, height: 15, margin: [0, 1, 0, 0] },
        { stack: [
          { text: `${corrected ? "НАРУШЕНИЕ УСТРАНЕНО" : "ЗАКРЫТО ПО ПОДТВЕРЖДАЮЩИМ ДОКУМЕНТАМ"} · ${ruDate(f.resolved_at)}, по решению клиента`,
            bold: true, fontSize: 8.5, color: C.greenDark },
          ...(f.resolution_basis ? [{ text: f.resolution_basis, fontSize: 8.8, color: C.ink, lineHeight: 1.2, margin: [0, 3, 0, 0] }] : []),
          ...(f.resolution_documents ? [{ text: [{ text: "Документы: ", bold: true }, f.resolution_documents], fontSize: 8, color: C.muted, margin: [0, 3, 0, 0] }] : []),
        ] },
      ]] },
      layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => C.greenBg,
        paddingLeft: (i: number) => (i === 0 ? 8 : 4), paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 },
    };
  } else {
    const parts: any[] = [];
    if (f.proposed_at) {
      parts.push({ text: "ПРЕДЛОЖЕНО К ЗАКРЫТИЮ — ожидает решения клиента", bold: true, fontSize: 8.5, color: C.grey });
      if (f.proposal_basis) parts.push({ text: f.proposal_basis, fontSize: 8.8, color: C.ink, lineHeight: 1.2, margin: [0, 3, 0, 0] });
    } else {
      parts.push({ text: "ОТКРЫТО", bold: true, fontSize: 8.5, color: lc });
      if (f.agent_note) parts.push({ text: f.agent_note, fontSize: 8.8, color: C.ink, lineHeight: 1.2, margin: [0, 3, 0, 0] });
      else parts.push({ text: "Подтверждающие документы не представлены.", fontSize: 8.8, color: C.muted, margin: [0, 3, 0, 0] });
    }
    if (f.revision_proposed_at) parts.push({ text: "Предложено исправить оценку — ожидает решения клиента.", fontSize: 8, color: C.grey, margin: [0, 3, 0, 0] });
    resolution = { table: { widths: ["*"], body: [[{ stack: parts }]] },
      layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => C.greyBg,
        paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 } };
  }
  rows.push(labelled("Статус", resolution));

  const body: any[] = [
    [{ ...header, colSpan: 2, margin: [12, 12, 12, 8] }, {}],
    ...rows.map(([l, c], i) => [
      { ...l, margin: [12, i === 0 ? 2 : 4, 0, 4] },
      { ...c, margin: [0, i === 0 ? 2 : 4, 12, i === rows.length - 1 ? 12 : 4] },
    ]),
  ];
  return {
    table: { widths: [104, "*"], body, headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true },
    layout: {
      hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 0.8 : i === 1 ? 0.5 : 0),
      vLineWidth: (i: number, node: any) => (i === 0 ? 4 : i === node.table.widths.length ? 0.8 : 0),
      hLineColor: () => C.line,
      vLineColor: (i: number) => (i === 0 ? stripe : C.line),
      paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
    },
    margin: [0, 0, 0, 12],
  };
}

function registerTable(findings: ReportFinding[], codes: Map<string, string>): any {
  const head = ["№", "Нарушение", "Уровень", "Тип", "Статус"].map(t => ({
    text: t.toUpperCase(), fontSize: 7, bold: true, color: C.white, fillColor: C.navy, margin: [4, 4, 4, 3], characterSpacing: 0.3 }));
  const rows = findings.map((f, i) => {
    const [lc] = LEVEL_COLOR[f.risk_level] ?? [C.grey];
    const st = findingState(f);
    const fill = i % 2 ? C.bg : C.white;
    return [
      { text: codes.get(f.id) ?? "", bold: true, fontSize: 8.5, color: C.navy, fillColor: fill, margin: [4, 4, 2, 3] },
      { text: f.title, fontSize: 8.5, color: f.status === "resolved" ? C.muted : C.ink, fillColor: fill, margin: [4, 4, 4, 3] },
      { text: f.risk_level, fontSize: 7.5, bold: true, color: lc, fillColor: fill, margin: [4, 4.5, 4, 3] },
      { text: f.evidence_status ? EVIDENCE[f.evidence_status] ?? "" : "", fontSize: 7.5, color: C.grey, fillColor: fill, margin: [4, 4.5, 4, 3] },
      { text: st.label, fontSize: 7.5, bold: true, color: st.color, fillColor: fill, margin: [4, 4.5, 4, 3] },
    ];
  });
  return {
    table: { widths: [26, "*", 74, 86, 78], headerRows: 1, dontBreakRows: true, body: [head, ...rows] },
    layout: { hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 0 : 0.5), vLineWidth: () => 0,
      hLineColor: () => C.line, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
  };
}

// ─── The document ────────────────────────────────────────────────────────────
export function buildReportDefinition(session: ReportSession, rawFindings: ReportFinding[], now = new Date()): any {
  const TEXT_FIELDS = ["title", "description", "legal_basis", "recommendation", "financial_impact", "proposal_basis",
    "agent_note", "resolution_basis", "resolution_documents", "revision_summary"] as const;
  const findings: ReportFinding[] = rawFindings.map(f => {
    const g: any = { ...f };
    for (const k of TEXT_FIELDS) if (g[k] != null) g[k] = pdfText(g[k]);
    return g;
  });
  const codes = new Map(findings.map((f, i) => [f.id, `Н-${i + 1}`]));   // same codes as in the chat
  const c = reportCounts(findings);
  const concl = conclusion(c);
  const period = session.period && session.period !== "All periods" ? ruPeriod(session.period) : "—";

  // transactions_ct may be 0 in old audits — then the count named in a finding is used.
  const tx = session.transactions_ct || (() => {
    for (const f of findings) {
      const m = `${f.description ?? ""} ${f.title}`.match(/(\d+)\s*(финансов|транзакц|операци)/i);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  })();

  const infoCell = (label: string, value: string) => ({ stack: [
    { text: label, fontSize: 7, bold: true, color: "#9fb2d9", characterSpacing: 0.5 },
    { text: value, fontSize: value.length > 18 ? 9 : 10, bold: true, color: C.white, margin: [0, 3, 0, 0], noWrap: value.length <= 24 },
  ], margin: [12, 10, 8, 10] });

  const closedSub = c.closed === 0 ? "пока ни одного"
    : c.corrected > 0 ? `устранено ${c.corrected} · документы ${c.documented}` : "по подтверждающим документам";

  const register = findings.length === 0 ? [] : [
    sectionTitle("СВОДНЫЙ РЕЕСТР НАРУШЕНИЙ"),
    registerTable(findings, codes),
  ];

  const detail = findings.length === 0 ? [] : [
    { table: { widths: ["*", "auto"], body: [[
        { text: "ПОДРОБНЫЙ РЕЕСТР НАРУШЕНИЙ", fontSize: 11, bold: true, color: C.white, characterSpacing: 0.6, margin: [12, 9, 0, 8] },
        { text: `${c.total} ${plural(c.total, "нарушение", "нарушения", "нарушений")}: открыто ${c.open}, закрыто ${c.closed}`,
          fontSize: 9.5, color: "#c9d6f2", margin: [0, 10, 12, 8] },
      ]] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => C.navy },
      headlineLevel: 1, margin: [0, 22, 0, 6] },
    ...LEVELS.flatMap(level => {
      const items = findings.filter(f => f.risk_level === level);
      if (!items.length) return [];
      const [lc] = LEVEL_COLOR[level];
      const closedHere = items.filter(f => f.status === "resolved").length;
      return [
        { columns: [
            { canvas: [{ type: "ellipse", x: 4, y: 6.5, r1: 4, r2: 4, color: lc }], width: 14 },
            { text: [{ text: level, bold: true, color: lc }, { text: `   ${items.length} ${plural(items.length, "нарушение", "нарушения", "нарушений")}: открыто ${items.length - closedHere}, закрыто ${closedHere}`, color: C.muted }], fontSize: 9.5 },
          ], margin: [0, 12, 0, 8], headlineLevel: 2 },
        // A card that fits on a page is never split; a very long one may be
        // (its header row repeats on the next page).
        ...items.map(f => {
          const card = findingCard(f, codes.get(f.id) ?? "");
          const size = [f.title, f.description, f.financial_impact, f.legal_basis, f.recommendation, f.revision_summary,
            f.resolution_basis, f.resolution_documents, f.proposal_basis, f.agent_note].reduce((n, t) => n + (t?.length ?? 0), 0);
          return size < 1900 ? { stack: [card], unbreakable: true } : card;
        }),
      ];
    }),
  ];

  return {
    pageSize: "A4",
    pageMargins: [40, 52, 40, 52],
    // A heading never stays alone at the bottom of a page: it moves to the next
    // page when less than a card's opening fits under it.
    pageBreakBefore: (node: any, following: any[]) =>
      !!node.headlineLevel && (following.length === 0 || (node.startPosition?.top ?? 0) > 842 - 52 - 170),
    info: { title: `Отчёт об аудите — ${session.company_name}`, author: "Assistant24", subject: "Отчёт об аудите" },
    header: (page: number) => page === 1 ? null : {
      columns: [
        { columns: [{ svg: LOGO_SVG, width: 13, height: 13 }, { text: [{ text: "Assistant", bold: true, color: C.navy }, { text: "24", bold: true, color: C.blue }], fontSize: 9, margin: [4, 1, 0, 0] }], width: "auto" },
        { text: `Отчёт об аудите · ${session.company_name} · ${period}`, fontSize: 8, color: C.light, alignment: "right", margin: [0, 2, 0, 0] },
      ],
      margin: [40, 22, 40, 0],
    },
    footer: (page: number, pages: number) => ({
      stack: [
        { canvas: [{ type: "line", x1: 40, y1: 0, x2: 555, y2: 0, lineWidth: 0.6, lineColor: C.line }] },
        { columns: [
          { text: "Автоматический аудит платформы Assistant24 · сформирован по данным, представленным клиентом", fontSize: 7.5, color: C.light },
          { text: `Страница ${page} из ${pages}`, fontSize: 7.5, color: C.light, alignment: "right", width: "auto" },
        ], margin: [40, 7, 40, 0] },
      ],
      margin: [0, 14, 0, 0],
    }),

    content: [
      // Header
      { columns: [
          { columns: [{ svg: LOGO_SVG, width: 34, height: 34 },
            { text: [{ text: "Assistant", bold: true, color: C.navy }, { text: "24", bold: true, color: C.blue }], fontSize: 15, margin: [7, 8, 0, 0] }], width: "auto" },
          { canvas: [{ type: "line", x1: 14, y1: 0, x2: 14, y2: 42, lineWidth: 0.8, lineColor: C.line }], width: 30 },
          { stack: [
            { text: "ОТЧЁТ ОБ АУДИТЕ", fontSize: 24, bold: true, color: C.navy, characterSpacing: 0.5 },
            { text: `Проверяемый период: ${period}   ·   Дата отчёта: ${ruLongDate(now)}`, fontSize: 8.5, color: C.muted, margin: [1, 3, 0, 0] },
          ] },
        ], margin: [0, -8, 0, 16] },

      // Audit details bar
      { table: { widths: ["*", "*", "*", "*"], body: [[
          infoCell("ОБЪЕКТ АУДИТА", session.company_name),
          infoCell("ПРОВЕРЯЕМЫЙ ПЕРИОД", period),
          infoCell("ДАТА ПРОВЕРКИ", ruLongDate(new Date(session.created_at))),
          infoCell("СТОИМОСТЬ АУДИТА", session.cost_rub ? `${rubles(session.cost_rub)} ₽` : "—"),
        ]] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => C.navy, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
        margin: [0, 0, 0, 14] },

      // Four KPIs
      { columns: [
          kpiCard(ICONS.ops(C.navy), "ПРОВЕРЕНО ОПЕРАЦИЙ", tx ? rubles(tx) : "—", "за проверяемый период", C.navy, C.greyBg),
          kpiCard(ICONS.critical(c.critical > 0 ? C.red : C.grey), "КРИТИЧНЫЕ РИСКИ", String(c.critical),
            c.critical > 0 ? "открытые, срочно" : "открытых нет", c.critical > 0 ? C.red : C.grey, c.critical > 0 ? C.redBg : C.greyBg),
          kpiCard(ICONS.material(c.material > 0 ? C.orange : C.grey), "СУЩЕСТВЕННЫЕ РИСКИ", String(c.material),
            c.material > 0 ? "открытые, к исправлению" : "открытых нет", c.material > 0 ? C.orange : C.grey, c.material > 0 ? C.orangeBg : C.greyBg),
          kpiCard(ICONS.closed(C.green), "ЗАКРЫТО НАРУШЕНИЙ", `${c.closed} из ${c.total}`, closedSub, C.green, C.greenBg),
        ], columnGap: 9 },

      // Conclusion — its own section
      sectionTitle("ИТОГОВОЕ ЗАКЛЮЧЕНИЕ", [0, 20, 0, 8]),
      { table: { widths: ["*"], body: [[{ stack: [
          { columns: [badge(concl.verdict, concl.color, concl.bg, { solid: true, size: 8.5 })] },
          { text: concl.text, fontSize: 10.3, color: C.ink, lineHeight: 1.35, margin: [0, 8, 0, 0] },
          { text: "Вывод относится только к представленным данным и проверяемому периоду. Коды Н-1, Н-2 … совпадают с кодами в чате аудита.",
            fontSize: 8, color: C.light, margin: [0, 8, 0, 0] },
        ], margin: [14, 12, 14, 12] }]] },
        layout: { hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 4 : 0), vLineColor: () => concl.color, fillColor: () => C.bg } },

      ...register,
      ...detail,
    ],
    defaultStyle: { font: "Roboto", fontSize: 9.5, color: C.ink },
  };
}

export function reportFileName(companyName: string, now = new Date()): string {
  const safe = companyName.replace(/[^а-яёА-ЯЁa-zA-Z0-9]/g, "_");
  return `Аудит_${safe}_${now.toISOString().slice(0, 10)}.pdf`;
}
