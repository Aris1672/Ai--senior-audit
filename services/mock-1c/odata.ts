/**
 * services/mock-1c/odata.ts — the part of 1C's standard OData interface that
 * the audit reader uses, over the invented base from data.ts.
 *
 * Follows what a real 1С:Предприятие 8.3 base does (OData 3, JSON):
 *   GET …/odata/standard.odata/$metadata
 *   GET …/odata/standard.odata/<EntitySet>?$format=json&$filter=…&$select=…&$orderby=…&$top=…&$skip=…&$inlinecount=allpages
 *   GET …/odata/standard.odata/<EntitySet>/$count
 *   GET …/odata/standard.odata/<EntitySet>(guid'…')
 *   GET …/odata/standard.odata/AccountingRegister_Хозрасчетный/RecordsWithExtDimensions(StartPeriod=datetime'…',EndPeriod=datetime'…')
 *   GET …/odata/standard.odata/AccountingRegister_Хозрасчетный/Balance(Period=datetime'…')
 *   GET …/odata/standard.odata/AccountingRegister_Хозрасчетный/Turnovers(StartPeriod=…,EndPeriod=…)
 *   GET …/odata/standard.odata/AccountingRegister_Хозрасчетный/BalanceAndTurnovers(StartPeriod=…,EndPeriod=…)
 * Balance / turnover rows are grouped by account and its first analytic
 * (ExtDimension1), like 1C's virtual tables with default dimensions.
 *
 * It is a stand-in written from the protocol description and a real
 * structure file — not a copy of 1C. Behaviour that only a real base shows
 * (timeouts, quirks of particular platform versions) has to be checked on one.
 */
import { STRUCTURE, ZERO_GUID, type MockBase } from "./data";

type Row = Record<string, unknown>;
export interface ODataResponse { status: number; contentType: string; body: string }

export class ODataError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

// ─── $filter ─────────────────────────────────────────────────────────────────
type Tok = { t: "id" | "str" | "num" | "op" | "lp" | "rp" | "comma" | "date" | "guid" | "bool"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^\s+/))) { i += m[0].length; continue; }
    if ((m = rest.match(/^datetime'([^']*)'/i))) { out.push({ t: "date", v: m[1] }); i += m[0].length; continue; }
    if ((m = rest.match(/^guid'([^']*)'/i)))     { out.push({ t: "guid", v: m[1].toLowerCase() }); i += m[0].length; continue; }
    if ((m = rest.match(/^'((?:[^']|'')*)'/)))   { out.push({ t: "str", v: m[1].replace(/''/g, "'") }); i += m[0].length; continue; }
    if ((m = rest.match(/^-?\d+(\.\d+)?/)))      { out.push({ t: "num", v: m[0] }); i += m[0].length; continue; }
    if (rest[0] === "(") { out.push({ t: "lp", v: "(" }); i++; continue; }
    if (rest[0] === ")") { out.push({ t: "rp", v: ")" }); i++; continue; }
    if (rest[0] === ",") { out.push({ t: "comma", v: "," }); i++; continue; }
    if ((m = rest.match(/^[\p{L}_][\p{L}\p{N}_]*/u))) {
      const w = m[0];
      if (/^(and|or|not|eq|ne|gt|ge|lt|le)$/.test(w)) out.push({ t: "op", v: w });
      else if (w === "true" || w === "false") out.push({ t: "bool", v: w });
      else out.push({ t: "id", v: w });
      i += w.length; continue;
    }
    throw new ODataError(400, "9", `Ошибка разбора опции запроса $filter: неожиданный символ в позиции ${i}`);
  }
  return out;
}

export function compileFilter(src: string, knownFields?: Set<string>): (row: Row) => boolean {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const take = () => toks[p++];
  const fail = (): never => { throw new ODataError(400, "9", "Ошибка разбора опции запроса $filter"); };

  type Ev = (row: Row) => unknown;
  const value = (): Ev => {
    const t = take() ?? fail();
    if (t.t === "str" || t.t === "date" || t.t === "guid") return () => t.v;
    if (t.t === "num") return () => Number(t.v);
    if (t.t === "bool") return () => t.v === "true";
    if (t.t === "id") {
      if (peek()?.t === "lp") {                       // function call
        take();
        const args: Ev[] = [];
        while (peek() && peek().t !== "rp") { args.push(value()); if (peek()?.t === "comma") take(); }
        take() ?? fail();
        const lower = (x: unknown) => String(x ?? "").toLowerCase();
        switch (t.v) {
          case "substringof": return row => lower(args[1](row)).includes(lower(args[0](row)));
          case "startswith":  return row => lower(args[0](row)).startsWith(lower(args[1](row)));
          case "endswith":    return row => lower(args[0](row)).endsWith(lower(args[1](row)));
          default: throw new ODataError(400, "9", `Функция ${t.v} не поддерживается`);
        }
      }
      if (knownFields && !knownFields.has(t.v)) throw new ODataError(400, "9", `Поле не найдено: ${t.v}`);
      return row => row[t.v];
    }
    return fail();
  };
  const cmp = (a: unknown, b: unknown): number => {
    if (typeof a === "number" || typeof b === "number") return Number(a) - Number(b);
    return String(a).localeCompare(String(b));
  };
  const primary = (): ((row: Row) => boolean) => {
    if (peek()?.t === "op" && peek().v === "not") { take(); const inner = primary(); return row => !inner(row); }
    if (peek()?.t === "lp") { take(); const inner = or(); (take()?.t === "rp") || fail(); return inner; }
    const left = value();
    const op = peek();
    if (!op || op.t !== "op" || /^(and|or|not)$/.test(op.v)) return row => !!left(row);      // boolean function call
    take();
    const right = value();
    return row => {
      const c = cmp(left(row), right(row));
      switch (op.v) { case "eq": return c === 0; case "ne": return c !== 0; case "gt": return c > 0;
                      case "ge": return c >= 0; case "lt": return c < 0; default: return c <= 0; }
    };
  };
  const and = (): ((row: Row) => boolean) => {
    let left = primary();
    while (peek()?.t === "op" && peek().v === "and") { take(); const l = left, r = primary(); left = row => l(row) && r(row); }
    return left;
  };
  const or = (): ((row: Row) => boolean) => {
    let left = and();
    while (peek()?.t === "op" && peek().v === "or") { take(); const l = left, r = and(); left = row => l(row) || r(row); }
    return left;
  };
  const fn = or();
  if (p < toks.length) fail();
  return fn;
}

// ─── Query options ───────────────────────────────────────────────────────────
function applyQuery(rows: Row[], q: URLSearchParams, fields: Set<string>): { rows: Row[]; total: number } {
  let out = rows;
  const filter = q.get("$filter");
  if (filter) out = out.filter(compileFilter(filter, fields));
  const total = out.length;

  const orderby = q.get("$orderby");
  if (orderby) {
    const keys = orderby.split(",").map(s => s.trim().split(/\s+/)).map(([f, dir]) => ({ f, desc: (dir ?? "").toLowerCase() === "desc" }));
    for (const k of keys) if (!fields.has(k.f)) throw new ODataError(400, "9", `Поле не найдено: ${k.f}`);
    out = [...out].sort((a, b) => {
      for (const k of keys) {
        const x = a[k.f], y = b[k.f];
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        if (c !== 0) return k.desc ? -c : c;
      }
      return 0;
    });
  }
  const skip = Number(q.get("$skip") ?? 0), top = q.get("$top");
  if (!Number.isInteger(skip) || skip < 0 || (top !== null && (!Number.isInteger(Number(top)) || Number(top) < 0))) {
    throw new ODataError(400, "9", "Неверное значение опции $top или $skip");
  }
  out = out.slice(skip, top !== null ? skip + Number(top) : undefined);

  const select = q.get("$select");
  if (select) {
    const cols = select.split(",").map(s => s.trim()).filter(Boolean);
    for (const c of cols) if (!fields.has(c)) throw new ODataError(400, "9", `Поле не найдено: ${c}`);
    out = out.map(row => Object.fromEntries(cols.map(c => [c, row[c]])));
  }
  return { rows: out, total };
}

function collection(base: string, name: string, rows: Row[], total: number, q: URLSearchParams): ODataResponse {
  const body: Row = { "odata.metadata": `${base}/$metadata#${name}` };
  if (q.get("$inlinecount") === "allpages") body["odata.count"] = String(total);
  body.value = rows;
  return { status: 200, contentType: "application/json;charset=utf-8", body: JSON.stringify(body) };
}

// ─── Ledger virtual tables ───────────────────────────────────────────────────
function functionArgs(src: string): Record<string, string> {
  const args: Record<string, string> = {};
  const re = /([\p{L}_][\p{L}\p{N}_]*)\s*=\s*(datetime'[^']*'|guid'[^']*'|'(?:[^']|'')*'|[^,]+)/gu;
  for (const m of src.matchAll(re)) args[m[1]] = m[2].trim().replace(/^datetime'|^guid'|^'|'$/g, "").replace(/''/g, "'");
  return args;
}

interface Side { account: string; dim: string; dimType: string }
const side = (r: Row, s: "Dr" | "Cr"): Side => ({
  account: String(r[`Account${s}_Key`]), dim: String(r[`ExtDimension${s}1`] ?? ""), dimType: String(r[`ExtDimension${s}1_Type`] ?? ""),
});

function balanceAndTurnovers(base: MockBase, start: string | null, end: string | null, accountFilter: ((k: string) => boolean) | null) {
  const cell = new Map<string, { s: Side; open: number; dr: number; cr: number }>();
  const at = (s: Side) => {
    const k = s.account + "|" + s.dim;
    let c = cell.get(k);
    if (!c) cell.set(k, (c = { s, open: 0, dr: 0, cr: 0 }));
    return c;
  };
  for (const r of base.ledger) {
    const period = String(r.Period), sum = Number(r.Сумма);
    if (end && period > end) continue;
    const before = start !== null && period < start;
    const dr = at(side(r, "Dr")), cr = at(side(r, "Cr"));
    if (before) { dr.open += sum; cr.open -= sum; } else { dr.dr += sum; cr.cr += sum; }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return [...cell.values()]
    .filter(c => !accountFilter || accountFilter(c.s.account))
    .map(c => ({ ...c, open: r2(c.open), dr: r2(c.dr), cr: r2(c.cr), close: r2(c.open + c.dr - c.cr) }));
}

function ledgerFunction(base: MockBase, url: string, name: string, argSrc: string, q: URLSearchParams): ODataResponse {
  const args = functionArgs(argSrc);
  const org = base.organisationKey;
  const typeName = { RecordsWithExtDimensions: "AccountingRegister_Хозрасчетный_RecordsWithExtDimensions", Balance: "AccountingRegister_Хозрасчетный_Balance",
    Turnovers: "AccountingRegister_Хозрасчетный_Turnover", BalanceAndTurnovers: "AccountingRegister_Хозрасчетный_BalanceAndTurnover" }[name];
  if (!typeName) throw new ODataError(404, "8", `Функция не найдена: ${name}`);
  const fields = new Set(Object.keys(STRUCTURE[typeName].props));
  const blank = (): Row => Object.fromEntries(Object.entries(STRUCTURE[typeName].props).map(([k, t]) =>
    [k, t === "Edm.Guid" ? ZERO_GUID : t === "Edm.Double" || t.startsWith("Edm.Int") ? 0 : t === "Edm.DateTime" ? "0001-01-01T00:00:00" : t === "Edm.Boolean" ? false : ""]));

  // Condition / AccountCondition use the same expression language as $filter.
  const accountCondition = args.AccountCondition ? compileFilter(args.AccountCondition) : null;
  const accountFilter = accountCondition ? (key: string) => accountCondition({ Account_Key: key, Account: key }) : null;

  let rows: Row[];
  if (name === "RecordsWithExtDimensions") {
    rows = base.ledger.filter(r => (!args.StartPeriod || String(r.Period) >= args.StartPeriod) && (!args.EndPeriod || String(r.Period) <= args.EndPeriod));
    if (args.Condition) rows = rows.filter(compileFilter(args.Condition, fields));
    if (args.Top) rows = rows.slice(0, Number(args.Top));
  } else if (name === "Balance") {
    rows = balanceAndTurnovers(base, null, args.Period ?? null, accountFilter).filter(c => c.close !== 0).map(c => ({
      ...blank(), Account_Key: c.s.account, ExtDimension1: c.s.dim, ExtDimension1_Type: c.s.dimType, Организация_Key: org,
      СуммаBalance: c.close, СуммаBalanceDr: c.close > 0 ? c.close : 0, СуммаBalanceCr: c.close < 0 ? -c.close : 0,
      СуммаSplittedBalanceDr: c.close > 0 ? c.close : 0, СуммаSplittedBalanceCr: c.close < 0 ? -c.close : 0,
    }));
  } else if (name === "Turnovers") {
    rows = balanceAndTurnovers(base, args.StartPeriod ?? "0001", args.EndPeriod ?? null, accountFilter).filter(c => c.dr !== 0 || c.cr !== 0).map(c => ({
      ...blank(), Account_Key: c.s.account, ExtDimension1: c.s.dim, ExtDimension1_Type: c.s.dimType, Организация_Key: org,
      СуммаTurnover: Math.round((c.dr - c.cr) * 100) / 100, СуммаTurnoverDr: c.dr, СуммаTurnoverCr: c.cr,
    }));
  } else {
    rows = balanceAndTurnovers(base, args.StartPeriod ?? "0001", args.EndPeriod ?? null, accountFilter).filter(c => c.open !== 0 || c.dr !== 0 || c.cr !== 0).map(c => ({
      ...blank(), Account_Key: c.s.account, ExtDimension1: c.s.dim, ExtDimension1_Type: c.s.dimType, Организация_Key: org,
      СуммаOpeningBalance: c.open, СуммаOpeningBalanceDr: c.open > 0 ? c.open : 0, СуммаOpeningBalanceCr: c.open < 0 ? -c.open : 0,
      СуммаTurnover: Math.round((c.dr - c.cr) * 100) / 100, СуммаTurnoverDr: c.dr, СуммаTurnoverCr: c.cr,
      СуммаClosingBalance: c.close, СуммаClosingBalanceDr: c.close > 0 ? c.close : 0, СуммаClosingBalanceCr: c.close < 0 ? -c.close : 0,
    }));
  }
  const res = applyQuery(rows, q, fields);
  return collection(url, `AccountingRegister_Хозрасчетный_${name}`, res.rows, res.total, q);
}

// ─── Entry point ─────────────────────────────────────────────────────────────
/**
 * @param resource the path after "/odata/standard.odata/", percent-decoded
 * @param serviceUrl absolute service root, for odata.metadata
 */
export function handleOData(base: MockBase, metadataXml: string, resource: string, q: URLSearchParams, serviceUrl: string): ODataResponse {
  try {
    const format = q.get("$format");
    if (resource === "$metadata") return { status: 200, contentType: "application/xml;charset=utf-8", body: metadataXml };
    if (resource === "" || resource === "/") {
      const names = [...Object.keys(base.sets), "AccountingRegister_Хозрасчетный"].sort();
      return { status: 200, contentType: "application/json;charset=utf-8",
        body: JSON.stringify({ "odata.metadata": `${serviceUrl}/$metadata`, value: names.map(n => ({ name: n, url: n })) }) };
    }
    // Real 1C answers in Atom XML unless JSON is asked for; the reader must ask.
    if (format !== null && !/^json/i.test(format) && format !== "application/json") {
      throw new ODataError(400, "6", `Формат не поддерживается: ${format}`);
    }

    let m = resource.match(/^AccountingRegister_Хозрасчетный\/([A-Za-z]+)(?:\(([\s\S]*)\))?$/);
    if (m) return ledgerFunction(base, serviceUrl, m[1], m[2] ?? "", q);

    m = resource.match(/^([\p{L}\p{N}_]+)(?:\(guid'([0-9a-fA-F-]{36})'\))?(\/\$count)?$/u);
    if (!m) throw new ODataError(404, "8", `Ресурс не найден: ${resource}`);
    const [, set, key, count] = m;
    const rows = base.sets[set];
    if (!rows || !STRUCTURE[set]) throw new ODataError(404, "8", `Сущность не найдена: ${set}`);
    const fields = new Set(Object.keys(STRUCTURE[set].props));

    if (key) {
      const row = rows.find(r => String(r.Ref_Key).toLowerCase() === key.toLowerCase());
      if (!row) throw new ODataError(404, "9", `Экземпляр сущности не найден: ${set}(guid'${key}')`);
      return { status: 200, contentType: "application/json;charset=utf-8", body: JSON.stringify({ "odata.metadata": `${serviceUrl}/$metadata#${set}/@Element`, ...row }) };
    }
    if (count) {
      const filter = q.get("$filter");
      const n = filter ? rows.filter(compileFilter(filter, fields)).length : rows.length;
      return { status: 200, contentType: "text/plain;charset=utf-8", body: String(n) };
    }
    const res = applyQuery(rows, q, fields);
    return collection(serviceUrl, set, res.rows, res.total, q);
  } catch (err) {
    const e = err instanceof ODataError ? err : new ODataError(500, "0", (err as Error).message);
    return { status: e.status, contentType: "application/json;charset=utf-8",
      body: JSON.stringify({ "odata.error": { code: e.code, message: { lang: "ru", value: e.message } } }) };
  }
}
