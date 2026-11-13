/**
 * lib/c1-reader.ts — reads one company-period from a 1C database over its
 * standard OData interface and turns it into a SNAPSHOT for the audit.
 *
 * Design (Nov 13, 2026):
 *  · The base is read ONCE, when the client connects it. The result is stored
 *    as a document of the audit and then goes through the same path as an
 *    uploaded file: quote → client confirms → analysis, volume check, coding
 *    of individuals. The 1C password is used for that one read and is NOT
 *    stored anywhere. An audit is of the books as they stood at that moment.
 *  · The model gets the ledger postings and the documents, plus totals that
 *    1C itself (balances, turnovers) and this code computed — it does not add
 *    up a year of postings on its own.
 *  · Priced per posted document of the period ("all documents": bank,
 *    purchases, sales, manual entries and any other document that made
 *    postings). Bank documents get the same billing key as a line of a bank
 *    statement file, so a statement uploaded next to the base is not charged
 *    twice.
 *  · Individuals are known here by FIELD (catalogue of individuals,
 *    counterparties flagged as natural persons), so their names are handed to
 *    the pseudonymizer as certain, not guessed from text.
 *
 * Written against the mock (services/mock-1c) built from a real structure
 * file. Behaviour on a real base — paging limits, time-outs, error wording —
 * still has to be confirmed on one.
 */
import dns from "node:dns/promises";
import net from "node:net";
import { numberedKey } from "./operation-keys";

export interface C1Config { url: string; base?: string; username: string; password: string }
export interface C1Period { from: string; to: string }   // "yyyy-mm-dd"

/** An error whose message is safe and meant for the client (Russian). */
export class C1Error extends Error {
  constructor(message: string, public detail?: string) { super(message); }
}

export interface C1Snapshot {
  kind: "1c_odata";
  takenAt: string;
  organisation: { name: string; inn: string };
  period: C1Period;
  text: string;
  operationKeys: string[];
  documentCount: number;
  personNames: string[];
  counts: Record<string, number>;
  warnings: string[];
}

type Row = Record<string, any>;
const ZERO = "00000000-0000-0000-0000-000000000000";
const r2 = (n: number) => Math.round(n * 100) / 100;
/** "17 811 995,61" — the way amounts are written in Russian reports (the model copies what it is shown). */
const money = (n: number) => {
  const [int, frac] = Math.abs(r2(n)).toFixed(2).split(".");
  return (r2(n) < 0 ? "-" : "") + int.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "," + frac;
};
/** Calendar day in Moscow of an ISO timestamp. */
export const moscowDay = (isoTime: string) => new Date(isoTime).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
const day = (iso: string) => (iso && !iso.startsWith("0001") ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "");
const cell = (v: unknown) => String(v ?? "").replace(/[\r\n;]+/g, " ").replace(/\s+/g, " ").trim();

// ─── Where the server is allowed to connect ──────────────────────────────────
// The address comes from the client, and the request is made from our server:
// without this check it could be pointed at our own internal services.
function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
           (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("ff");
}

if (process.env.C1_ALLOW_PRIVATE_HOSTS === "true") {
  console.warn("[1c] ⚠ C1_ALLOW_PRIVATE_HOSTS=true — connections to local and internal addresses are ALLOWED. " +
    "For tests with the mock base only; remove before real clients use the app.");
}

export async function assertAllowedC1Address(rawUrl: string): Promise<URL> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new C1Error("Адрес базы 1С указан неверно. Пример: https://1c.example.ru"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new C1Error("Адрес базы 1С должен начинаться с https:// или http://");
  if (url.username || url.password) throw new C1Error("Логин и пароль указываются в отдельных полях, а не в адресе.");
  if (process.env.C1_ALLOW_PRIVATE_HOSTS === "true") return url;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (net.isIP(host)) addresses = [host];
  else {
    try { addresses = (await dns.lookup(host, { all: true })).map(a => a.address); }
    catch { throw new C1Error(`Сервер «${host}» не найден. Проверьте адрес базы 1С.`); }
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new C1Error("Этот адрес недоступен для подключения: база 1С должна быть опубликована в интернете (внутренние и локальные адреса не принимаются).");
  }
  return url;
}

// ─── HTTP ────────────────────────────────────────────────────────────────────
class C1Client {
  readonly root: string;
  private auth: string;
  requests = 0;

  constructor(config: C1Config, private timeoutMs = 120_000) {
    const base = (config.base ?? "").replace(/^\/+|\/+$/g, "");
    this.root = config.url.replace(/\/+$/, "") + (base ? "/" + base : "") + "/odata/standard.odata";
    this.auth = "Basic " + Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64");
  }

  /** Returns the rows, or null when the object is not published in the base's OData composition. */
  async rows(resource: string, query: Record<string, string> = {}): Promise<Row[] | null> {
    const qs = Object.entries({ $format: "json", ...query }).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    const url = `${this.root}/${resource.split("/").map(s => encodeURIComponent(s).replace(/%3D/g, "=").replace(/%2C/g, ",").replace(/%28/g, "(").replace(/%29/g, ")")).join("/")}?${qs}`;
    this.requests++;
    let res: Response;
    try {
      res = await fetch(url, { headers: { authorization: this.auth, accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") throw new C1Error("База 1С не ответила вовремя. Попробуйте ещё раз или выберите более короткий период.");
      throw new C1Error("Не удалось соединиться с базой 1С. Проверьте адрес и что база доступна из интернета.", (err as Error)?.message);
    }
    if (res.status === 401 || res.status === 403) throw new C1Error("1С не приняла логин или пароль. Проверьте пользователя, созданного в «Настройках стандартного интерфейса OData».");
    if (res.status >= 300 && res.status < 400) throw new C1Error("База 1С перенаправляет на другой адрес. Укажите окончательный адрес базы.");
    if (res.status === 404) return null;
    const text = await res.text();
    if (!res.ok) throw new C1Error("База 1С вернула ошибку при чтении данных. Попробуйте ещё раз позже.", `HTTP ${res.status} ${resource}: ${text.slice(0, 300)}`);
    let body: any;
    try { body = JSON.parse(text); } catch { throw new C1Error("По этому адресу отвечает не интерфейс OData базы 1С. Проверьте адрес и имя базы.", text.slice(0, 200)); }
    if (!Array.isArray(body?.value)) throw new C1Error("База 1С вернула ответ в неожиданном виде.", text.slice(0, 200));
    return body.value;
  }
}

/** Month-sized pieces of the period: each request stays small, and no $skip paging is needed. */
export function monthsOf(period: C1Period): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  const from = new Date(period.from + "T00:00:00Z"), to = new Date(period.to + "T00:00:00Z");
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) throw new C1Error("Период аудита указан неверно.");
  let y = from.getUTCFullYear(), m = from.getUTCMonth();
  while (y < to.getUTCFullYear() || (y === to.getUTCFullYear() && m <= to.getUTCMonth())) {
    const first = new Date(Date.UTC(y, m, 1)), last = new Date(Date.UTC(y, m + 1, 0));
    const s = first < from ? from : first, e = last > to ? to : last;
    out.push({ start: s.toISOString().slice(0, 10) + "T00:00:00", end: e.toISOString().slice(0, 10) + "T23:59:59" });
    if (++m > 11) { m = 0; y++; }
  }
  return out;
}

// ─── What is read ────────────────────────────────────────────────────────────
interface DocKind { set: string; label: string; select: string[]; bank?: "in" | "out"; party: "composite" | "key" | "none" }
const DOC_KINDS: DocKind[] = [
  { set: "Document_ПоступлениеНаРасчетныйСчет", label: "Поступление на расчетный счет", bank: "in", party: "composite",
    select: ["Ref_Key", "Number", "Date", "Posted", "DeletionMark", "ВидОперации", "НомерВходящегоДокумента", "ДатаВходящегоДокумента", "Контрагент", "СуммаДокумента", "НазначениеПлатежа"] },
  { set: "Document_СписаниеСРасчетногоСчета", label: "Списание с расчетного счета", bank: "out", party: "composite",
    select: ["Ref_Key", "Number", "Date", "Posted", "DeletionMark", "ВидОперации", "НомерВходящегоДокумента", "ДатаВходящегоДокумента", "Контрагент", "Сотрудник_Key", "СуммаДокумента", "НазначениеПлатежа"] },
  { set: "Document_ПоступлениеТоваровУслуг", label: "Поступление товаров и услуг", party: "key",
    select: ["Ref_Key", "Number", "Date", "Posted", "DeletionMark", "ВидОперации", "НомерВходящегоДокумента", "ДатаВходящегоДокумента", "Контрагент_Key", "СуммаДокумента", "Комментарий"] },
  { set: "Document_РеализацияТоваровУслуг", label: "Реализация товаров и услуг", party: "key",
    select: ["Ref_Key", "Number", "Date", "Posted", "DeletionMark", "ВидОперации", "Контрагент_Key", "СуммаДокумента", "Комментарий"] },
  { set: "Document_ОперацияБух", label: "Операция, введенная вручную", party: "none",
    select: ["Ref_Key", "Number", "Date", "Posted", "DeletionMark", "Содержание", "СуммаОперации"] },
];
const SETTLEMENT_ACCOUNTS = /^(58|60|62|66|67|71|73|75|76)(\.|$)/;

export async function readC1Snapshot(config: C1Config, period: C1Period, opts: { timeoutMs?: number } = {}): Promise<C1Snapshot> {
  if (!config.url || !config.username || !config.password) throw new C1Error("Заполните адрес, логин и пароль для подключения к 1С.");
  await assertAllowedC1Address(config.url);
  const c1 = new C1Client(config, opts.timeoutMs);
  const months = monthsOf(period);
  const warnings: string[] = [];
  const need = async (resource: string, query: Record<string, string>, what: string): Promise<Row[]> => {
    const rows = await c1.rows(resource, query);
    if (rows === null) throw new C1Error(`В базе 1С не открыт доступ к объекту «${what}». Включите его в «Настройках стандартного интерфейса OData» (вкладка «Состав») и повторите.`);
    return rows;
  };

  // Catalogues.
  const orgs = await c1.rows("Catalog_Организации", { $select: "Ref_Key,Description,НаименованиеСокращенное,ИНН,DeletionMark" });
  if (orgs === null) throw new C1Error("По этому адресу не найдена база 1С с включённым интерфейсом OData. Проверьте адрес, имя базы и «Настройки стандартного интерфейса OData».");
  const liveOrgs = orgs.filter(o => !o.DeletionMark);
  if (liveOrgs.length === 0) throw new C1Error("В базе 1С нет ни одной организации.");
  if (liveOrgs.length > 1) warnings.push(`В базе ${liveOrgs.length} организации: ${liveOrgs.map(o => cell(o.Description)).join(", ")}. Данные прочитаны по всем — аудит одной организации из многофирменной базы пока не поддерживается.`);
  const org = liveOrgs[0];

  const chart = await need("ChartOfAccounts_Хозрасчетный", { $select: "Ref_Key,Code,Description" }, "План счетов «Хозрасчетный»");
  const account = new Map(chart.map(a => [a.Ref_Key, { code: cell(a.Code), name: cell(a.Description) }]));
  const code = (key: string) => account.get(key)?.code ?? "?";

  const partyRows = (await c1.rows("Catalog_Контрагенты", { $select: "Ref_Key,Description,ИНН,ЮридическоеФизическоеЛицо,ИндивидуальныйПредприниматель,IsFolder" })) ?? [];
  if (partyRows.length === 0) warnings.push("Справочник «Контрагенты» недоступен или пуст — контрагенты в данных показаны без названий.");
  const personRows = (await c1.rows("Catalog_ФизическиеЛица", { $select: "Ref_Key,Description,ФИО,ИНН,IsFolder" })) ?? [];
  const party = new Map(partyRows.map(p => [p.Ref_Key, { name: cell(p.Description), inn: cell(p.ИНН), natural: p.ЮридическоеФизическоеЛицо === "ФизическоеЛицо", ip: !!p.ИндивидуальныйПредприниматель }]));
  const person = new Map(personRows.filter(p => !p.IsFolder).map(p => [p.Ref_Key, cell(p.ФИО || p.Description)]));
  const nameOf = (key: unknown): string => {
    const k = String(key ?? "");
    if (!k || k === ZERO) return "";
    return party.get(k)?.name ?? person.get(k) ?? "";
  };

  // Names of individuals, known by field.
  const personNames = new Set<string>();
  for (const n of person.values()) if (n) personNames.add(n);
  for (const p of party.values()) if (p.natural && p.name) personNames.add(p.name.replace(/^\s*(ИП|Индивидуальный предприниматель)\s+/i, ""));

  // Documents, month by month.
  interface Doc { kind: DocKind; row: Row; partyKey: string; amount: number }
  const docs: Doc[] = [];
  const counts: Record<string, number> = {};
  for (const kind of DOC_KINDS) {
    let available = true;
    for (const m of months) {
      const rows = await c1.rows(kind.set, { $filter: `Date ge datetime'${m.start}' and Date le datetime'${m.end}'`, $select: kind.select.join(","), $orderby: "Date" });
      if (rows === null) { available = false; break; }
      for (const row of rows) {
        if (row.DeletionMark) continue;
        const partyKey = kind.party === "composite" ? String(row.Контрагент || "") || String(row.Сотрудник_Key ?? "") : kind.party === "key" ? String(row.Контрагент_Key ?? "") : "";
        docs.push({ kind, row, partyKey: partyKey === ZERO ? "" : partyKey, amount: Number(row.СуммаДокумента ?? row.СуммаОперации ?? 0) });
      }
    }
    if (!available) warnings.push(`Документы «${kind.label}» не открыты в составе OData базы — в снимок не вошли.`);
    else counts[kind.label] = docs.filter(d => d.kind === kind && d.row.Posted).length;
  }
  const byKey = new Map(docs.map(d => [String(d.row.Ref_Key), d]));
  const posted = docs.filter(d => d.row.Posted);
  const unposted = docs.filter(d => !d.row.Posted);

  // Ledger: postings month by month, and balances / turnovers computed by 1C.
  const postings: Row[] = [];
  for (const m of months) {
    postings.push(...await need(`AccountingRegister_Хозрасчетный/RecordsWithExtDimensions(StartPeriod=datetime'${m.start}',EndPeriod=datetime'${m.end}')`, {}, "Регистр бухгалтерии «Журнал проводок»"));
  }
  const active = postings.filter(p => p.Active !== false);
  const span = `StartPeriod=datetime'${months[0].start}',EndPeriod=datetime'${months[months.length - 1].end}'`;
  const totals = await need(`AccountingRegister_Хозрасчетный/BalanceAndTurnovers(${span})`, {}, "Регистр бухгалтерии «Журнал проводок»");

  // ── Billing: one operation per posted document of the period ──────────────
  const operationKeys: string[] = [];
  const counted = new Set<string>();
  for (const d of posted) {
    counted.add(String(d.row.Ref_Key));
    operationKeys.push(d.kind.bank && cell(d.row.НомерВходящегоДокумента)
      ? numberedKey(d.row.НомерВходящегоДокумента, day(String(d.row.ДатаВходящегоДокумента || d.row.Date)) || day(String(d.row.Date)), d.amount)
      : `1c|${d.row.Ref_Key}`);
  }
  const otherTypes = new Map<string, number>();
  for (const p of active) {                       // documents of kinds we do not read still made postings
    const k = String(p.Recorder);
    if (!k || counted.has(k)) continue;
    counted.add(k);
    operationKeys.push(`1c|${k}`);
    const t = String(p.Recorder_Type ?? "").replace(/^StandardODATA\.Document_/, "");
    otherTypes.set(t, (otherTypes.get(t) ?? 0) + 1);
  }
  for (const [t, n] of otherTypes) counts[`Прочие документы: ${t}`] = n;

  // ── Text for the model ────────────────────────────────────────────────────
  const L: string[] = [];
  const orgName = cell(org.НаименованиеСокращенное || org.Description);
  const takenAt = new Date().toISOString();
  L.push(`=== ИСТОЧНИК: БАЗА 1С (интерфейс OData), снимок данных от ${moscowDay(takenAt)} ===`);
  L.push(`Организация: ${orgName}, ИНН ${cell(org.ИНН)}`);
  L.push(`Период: ${day(period.from)} – ${day(period.to)}`);
  L.push(`Проведённых документов за период: ${operationKeys.length}; проводок: ${active.length}.`);
  L.push("Это данные бухгалтерского учёта самой организации (не банковская выписка): проводки, банковские документы, поступления, реализации.");
  for (const w of warnings) L.push(`[ВНИМАНИЕ: ${w}]`);

  L.push("", "=== РАСЧЁТНЫЕ ФАКТЫ (посчитаны базой 1С и программой, не моделью — используй их как итоги, не пересчитывай по списку) ===");
  L.push("Что по базе видно и чего не видно. Видно то, что записано в учёте: проводки, сальдо, проведённые и непроведённые документы, " +
    "начисления и платежи — выводы из этих записей могут быть подтверждёнными. НЕ видно бумажных и электронных первичных документов: " +
    "если в базе нет документа поступления, акта или договора, это значит только, что он не введён в учёт; есть ли он у организации — " +
    "по базе установить нельзя. Такой случай — признак риска (документ нужно запросить), а не подтверждённое нарушение.");

  // 1. Trial balance by account.
  const byAccount = new Map<string, { open: number; dr: number; cr: number; close: number }>();
  for (const t of totals) {
    const a = byAccount.get(t.Account_Key) ?? { open: 0, dr: 0, cr: 0, close: 0 };
    a.open += Number(t.СуммаOpeningBalance ?? 0); a.dr += Number(t.СуммаTurnoverDr ?? 0); a.cr += Number(t.СуммаTurnoverCr ?? 0); a.close += Number(t.СуммаClosingBalance ?? 0);
    byAccount.set(t.Account_Key, a);
  }
  const side = (n: number) => (r2(n) === 0 ? "0,00" : n > 0 ? `Дт ${money(n)}` : `Кт ${money(-n)}`);
  L.push("", "1. Оборотно-сальдовая ведомость за период (по данным 1С):", "Счет;Наименование;Сальдо на начало;Оборот Дт;Оборот Кт;Сальдо на конец");
  const sortedAccounts = [...byAccount.entries()].sort((x, y) => code(x[0]).localeCompare(code(y[0]), "ru", { numeric: true }));
  let sumDr = 0, sumCr = 0;
  for (const [key, a] of sortedAccounts) {
    sumDr += a.dr; sumCr += a.cr;
    L.push(`${code(key)};${account.get(key)?.name ?? ""};${side(a.open)};${money(a.dr)};${money(a.cr)};${side(a.close)}`);
  }
  L.push(`Итого обороты: Дт ${money(sumDr)}, Кт ${money(sumCr)} — ${r2(sumDr) === r2(sumCr) ? "РАВНЫ" : "НЕ РАВНЫ (расхождение " + money(sumDr - sumCr) + ")"}.`);

  // 2. Settlements by counterparty.
  const settle = totals.filter(t => SETTLEMENT_ACCOUNTS.test(code(t.Account_Key)) && t.ExtDimension1 && t.ExtDimension1 !== ZERO)
    .sort((x, y) => code(x.Account_Key).localeCompare(code(y.Account_Key), "ru", { numeric: true }) || nameOf(x.ExtDimension1).localeCompare(nameOf(y.ExtDimension1), "ru"));
  if (settle.length) {
    L.push("", "2. Расчёты по контрагентам и физическим лицам (счета 58, 60, 62, 66, 67, 71, 73, 75, 76; по данным 1С):", "Счет;Контрагент / лицо;ИНН;Сальдо на начало;Оборот Дт;Оборот Кт;Сальдо на конец");
    for (const t of settle) {
      L.push(`${code(t.Account_Key)};${nameOf(t.ExtDimension1) || "(без названия)"};${party.get(t.ExtDimension1)?.inn ?? ""};${side(Number(t.СуммаOpeningBalance ?? 0))};${money(Number(t.СуммаTurnoverDr ?? 0))};${money(Number(t.СуммаTurnoverCr ?? 0))};${side(Number(t.СуммаClosingBalance ?? 0))}`);
    }
  }

  // 3. Documents by kind.
  L.push("", "3. Проведённые документы за период по видам:", "Вид документа;Количество;Сумма");
  for (const kind of DOC_KINDS) {
    const list = posted.filter(d => d.kind === kind);
    if (list.length) L.push(`${kind.label};${list.length};${money(list.reduce((s, d) => s + d.amount, 0))}`);
  }
  for (const [t, n] of otherTypes) L.push(`${t} (вид документа в снимок не читается, есть только его проводки);${n};`);

  // 4. Bank account turnover against bank documents.
  const bankAccounts = [...byAccount.entries()].filter(([k]) => /^51(\.|$)/.test(code(k)));
  const bankIn = posted.filter(d => d.kind.bank === "in"), bankOut = posted.filter(d => d.kind.bank === "out");
  if (bankAccounts.length && (bankIn.length || bankOut.length)) {
    const dr = bankAccounts.reduce((s, [, a]) => s + a.dr, 0), cr = bankAccounts.reduce((s, [, a]) => s + a.cr, 0);
    const inSum = bankIn.reduce((s, d) => s + d.amount, 0), outSum = bankOut.reduce((s, d) => s + d.amount, 0);
    L.push("", "4. Сверка счёта 51 с банковскими документами:",
      `- Оборот Дт 51: ${money(dr)}; сумма документов поступления на расчётный счёт: ${money(inSum)} — ${r2(dr) === r2(inSum) ? "СОВПАДАЕТ" : "НЕ СОВПАДАЕТ (разница " + money(dr - inSum) + ")"}.`,
      `- Оборот Кт 51: ${money(cr)}; сумма документов списания с расчётного счёта: ${money(outSum)} — ${r2(cr) === r2(outSum) ? "СОВПАДАЕТ" : "НЕ СОВПАДАЕТ (разница " + money(cr - outSum) + ")"}.`);
  }

  // 5. Documents entered but not posted.
  L.push("", `5. Непроведённые документы за период (введены в базу, но проводок не дали): ${unposted.length}.`);
  for (const d of unposted) L.push(`- ${d.kind.label} № ${cell(d.row.Number)} от ${day(String(d.row.Date))}; ${nameOf(d.partyKey) || "без контрагента"}; ${money(d.amount)}; ${cell(d.row.Комментарий ?? d.row.НазначениеПлатежа ?? d.row.Содержание ?? "")}`);

  // 6. Outgoing payments identical in counterparty, amount and purpose.
  const groups = new Map<string, Doc[]>();
  for (const d of bankOut) {
    if (!d.partyKey) continue;
    const k = `${d.partyKey}|${money(d.amount)}|${cell(d.row.НазначениеПлатежа).toLowerCase()}`;
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  const repeated = [...groups.values()].filter(g => g.length > 1);
  L.push("", `6. Списания с одинаковыми контрагентом, суммой и назначением платежа (кандидаты для проверки на повторную оплату; сами по себе нарушением не являются): ${repeated.length} групп.`);
  for (const g of repeated) {
    L.push(`- ${nameOf(g[0].partyKey)}; ${money(g[0].amount)} × ${g.length}; даты: ${g.map(d => day(String(d.row.Date))).join(", ")}; назначение: ${cell(g[0].row.НазначениеПлатежа)}`);
  }

  // 7. Paid counterparties with no incoming documents.
  const paidTo = new Map<string, number>(), received = new Set(posted.filter(d => d.kind.set === "Document_ПоступлениеТоваровУслуг").map(d => d.partyKey));
  const purchasesRead = counts["Поступление товаров и услуг"] !== undefined;
  for (const d of bankOut) {
    if (d.row.ВидОперации === "ОплатаПоставщику" && d.partyKey) paidTo.set(d.partyKey, (paidTo.get(d.partyKey) ?? 0) + d.amount);
  }
  const noReceipts = [...paidTo.entries()].filter(([k]) => !received.has(k));
  if (purchasesRead) {
    L.push("", `7. Контрагенты, которым за период перечислена оплата поставщику, но от которых нет ни одного документа поступления товаров и услуг: ${noReceipts.length}.`);
    for (const [k, sum] of noReceipts) L.push(`- ${nameOf(k) || "(без названия)"}; ИНН ${party.get(k)?.inn ?? ""}; оплачено ${money(sum)}`);
  }

  // 8. Payments to individuals; 9. tax payments.
  const toPeople = new Map<string, { sum: number; n: number; kinds: Set<string> }>();
  for (const d of bankOut) {
    const natural = party.get(d.partyKey)?.natural || person.has(d.partyKey);
    if (!natural) continue;
    const e = toPeople.get(d.partyKey) ?? { sum: 0, n: 0, kinds: new Set<string>() };
    e.sum += d.amount; e.n++; e.kinds.add(cell(d.row.ВидОперации));
    toPeople.set(d.partyKey, e);
  }
  L.push("", `8. Списания с расчётного счёта в пользу физических лиц и ИП (по признаку в справочниках 1С): ${toPeople.size} получателей.`, "Получатель;ИП;Платежей;Сумма;Виды операций");
  for (const [k, e] of toPeople) L.push(`${nameOf(k)};${party.get(k)?.ip ? "да" : "нет"};${e.n};${money(e.sum)};${[...e.kinds].join(", ")}`);
  const taxes = bankOut.filter(d => d.row.ВидОперации === "ПеречислениеНалога");
  L.push("", `9. Перечисления налогов и взносов за период: ${taxes.length} платежей на ${money(taxes.reduce((s, d) => s + d.amount, 0))}.`, "Дата;Сумма;Назначение платежа");
  for (const d of taxes) L.push(`${day(String(d.row.Date))};${money(d.amount)};${cell(d.row.НазначениеПлатежа)}`);

  // ── Data ──────────────────────────────────────────────────────────────────
  const docRef = (key: unknown, type: unknown) => {
    const d = byKey.get(String(key));
    return d ? `${d.kind.label} № ${cell(d.row.Number)}` : String(type ?? "").replace(/^StandardODATA\.Document_/, "");
  };
  L.push("", "=== ПРОВОДКИ ЗА ПЕРИОД ===", "Дата;Документ;Дт;Кт;Сумма;Аналитика Дт;Аналитика Кт;Содержание");
  for (const p of active) {
    L.push(`${day(String(p.Period))};${docRef(p.Recorder, p.Recorder_Type)};${code(p.AccountDr_Key)};${code(p.AccountCr_Key)};${money(Number(p.Сумма ?? 0))};${nameOf(p.ExtDimensionDr1)};${nameOf(p.ExtDimensionCr1)};${cell(p.Содержание)}`);
  }
  if (bankIn.length || bankOut.length) {
    L.push("", "=== БАНКОВСКИЕ ДОКУМЕНТЫ (проведённые) ===", "Дата;Направление;Номер в 1С;Номер платёжного документа;Контрагент;ИНН;Сумма;Вид операции;Назначение платежа");
    for (const d of [...bankIn, ...bankOut].sort((x, y) => String(x.row.Date).localeCompare(String(y.row.Date)))) {
      L.push(`${day(String(d.row.Date))};${d.kind.bank === "in" ? "поступление" : "списание"};${cell(d.row.Number)};${cell(d.row.НомерВходящегоДокумента)};${nameOf(d.partyKey)};${party.get(d.partyKey)?.inn ?? ""};${money(d.amount)};${cell(d.row.ВидОперации)};${cell(d.row.НазначениеПлатежа)}`);
    }
  }
  for (const [set, title] of [["Document_ПоступлениеТоваровУслуг", "ПОСТУПЛЕНИЯ ТОВАРОВ И УСЛУГ"], ["Document_РеализацияТоваровУслуг", "РЕАЛИЗАЦИИ ТОВАРОВ И УСЛУГ"]] as const) {
    const list = posted.filter(d => d.kind.set === set);
    if (!list.length) continue;
    L.push("", `=== ${title} (проведённые) ===`, "Дата;Номер в 1С;Номер документа контрагента;Контрагент;ИНН;Сумма;Вид операции;Комментарий");
    for (const d of list) {
      L.push(`${day(String(d.row.Date))};${cell(d.row.Number)};${cell(d.row.НомерВходящегоДокумента ?? "")};${nameOf(d.partyKey)};${party.get(d.partyKey)?.inn ?? ""};${money(d.amount)};${cell(d.row.ВидОперации)};${cell(d.row.Комментарий)}`);
    }
  }
  L.push("", "=== КОНЕЦ СНИМКА БАЗЫ 1С ===");

  console.log(`[1c] snapshot — requests: ${c1.requests} | documents: ${operationKeys.length} | postings: ${active.length} | individuals: ${personNames.size} | warnings: ${warnings.length}`);
  return {
    kind: "1c_odata", takenAt, organisation: { name: orgName, inn: cell(org.ИНН) }, period,
    text: L.join("\n"), operationKeys, documentCount: operationKeys.length, personNames: [...personNames], counts, warnings,
  };
}
