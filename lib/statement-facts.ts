/**
 * lib/statement-facts.ts — facts computed in code from a 1C bank statement.
 *
 * Why (Nov 12, 2026): the model re-derived totals and own-account movements
 * differently on every run. In one regression run it treated a 1 137 ₽
 * transfer to the client's own tax-reserve account as an unrelated "own
 * transfer" and then reported the tax reserve as missing. Arithmetic and
 * grouping are deterministic, so they are done here once and handed to the
 * model as a "РАСЧЁТНЫЕ ФАКТЫ" block placed before the operation list.
 *
 * Deliberately NARROW — only what is unambiguous for any bank's export:
 *   1. totals and their match to the statement's own totals / balances
 *   2. transfers between the client's OWN accounts (same ИНН on both sides),
 *      as a ledger per counter-account
 *   3. inflows from / outflows to third parties, grouped by counterparty
 *   4. repeated-payment candidates (same receiver + document number + amount)
 * No bank-specific wording rules and no economic interpretation: what an
 * operation MEANS (revenue, own funds, tax reserve…) stays with the model.
 * Pure functions, covered by scripts/test-statement-facts.ts.
 */

// Structural subset of C1Transaction / C1AccountSummary (lib/file-parser.ts).
export interface FactsTx {
  number: string; date: string; amount: number; direction: "credit" | "debit";
  payerAccount?: string; payerInn?: string; payerName?: string;
  receiverAccount?: string; receiverInn?: string; receiverName?: string;
  purpose?: string;
}
export interface FactsSummary {
  account: string; openingBalance: number; totalCredits: number; totalDebits: number; closingBalance: number;
}

export interface OwnAccountLedger {
  account: string;
  toKop: number; fromKop: number;          // moved to that account / returned from it
  ops: { date: string; direction: "to" | "from"; kop: number; number: string; purpose: string }[];
}
export interface PartyTotal { name: string; inn: string; kop: number; count: number; }
export interface RepeatGroup { receiver: string; docRef: string; kop: number;
  ops: { date: string; number: string }[]; }

export interface StatementFacts {
  count: number; creditsKop: number; debitsKop: number; creditCount: number; debitCount: number;
  firstDate: string; lastDate: string;
  summary?: FactsSummary;
  totalsMatch?: boolean; balanceMatch?: boolean;
  ownInn?: string;
  ownAccounts: OwnAccountLedger[];
  thirdPartyInKop: number; thirdPartyOutKop: number;
  payers: PartyTotal[]; receivers: PartyTotal[];
  repeats: RepeatGroup[];
}

const kop = (n: number) => Math.round(n * 100);
const sortKey = (d: string) => { const [dd, mm, yy] = d.split("."); return `${yy}${mm}${dd}`; };

// Document references in a payment purpose: "№ 83973/007", "N 15", "No. A-12".
function docRefs(purpose: string): string[] {
  const out = new Set<string>();
  for (const m of purpose.matchAll(/(?:№|N°|No\.?|#)\s*([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9/\-_.]*)/g)) {
    out.add(m[1].replace(/[.\-_]+$/, "").toLowerCase());
  }
  return [...out];
}

export function computeStatementFacts(txs: FactsTx[], summary?: FactsSummary): StatementFacts {
  const credits = txs.filter(t => t.direction === "credit");
  const debits  = txs.filter(t => t.direction === "debit");
  const sum = (xs: FactsTx[]) => xs.reduce((s, t) => s + kop(t.amount), 0);
  const dates = txs.map(t => t.date).filter(Boolean).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  // The client's own ИНН: the ИНН on "our" side of the operations (most frequent).
  const innVotes = new Map<string, number>();
  for (const t of txs) {
    const inn = t.direction === "debit" ? t.payerInn : t.receiverInn;
    if (inn) innVotes.set(inn, (innVotes.get(inn) ?? 0) + 1);
  }
  const ownInn = [...innVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  // Own transfer = the other side has the same ИНН and a different account.
  const other = (t: FactsTx) => t.direction === "debit"
    ? { inn: t.receiverInn, account: t.receiverAccount, name: t.receiverName }
    : { inn: t.payerInn,    account: t.payerAccount,    name: t.payerName };
  const mine = (t: FactsTx) => t.direction === "debit" ? t.payerAccount : t.receiverAccount;
  const isOwn = (t: FactsTx) => {
    const o = other(t);
    return !!ownInn && o.inn === ownInn && !!o.account && o.account !== mine(t);
  };

  const ledgers = new Map<string, OwnAccountLedger>();
  for (const t of txs.filter(isOwn)) {
    const acc = other(t).account!;
    const l = ledgers.get(acc) ?? { account: acc, toKop: 0, fromKop: 0, ops: [] };
    const dir = t.direction === "debit" ? "to" : "from";
    if (dir === "to") l.toKop += kop(t.amount); else l.fromKop += kop(t.amount);
    l.ops.push({ date: t.date, direction: dir, kop: kop(t.amount), number: t.number, purpose: (t.purpose ?? "").trim() });
    ledgers.set(acc, l);
  }

  const group = (xs: FactsTx[]): PartyTotal[] => {
    const m = new Map<string, PartyTotal>();
    for (const t of xs) {
      const o = other(t);
      const key = o.inn || o.name || "—";
      const p = m.get(key) ?? { name: o.name || "(без наименования)", inn: o.inn || "", kop: 0, count: 0 };
      p.kop += kop(t.amount); p.count++;
      m.set(key, p);
    }
    return [...m.values()].sort((a, b) => b.kop - a.kop);
  };
  const thirdIn  = credits.filter(t => !isOwn(t));
  const thirdOut = debits.filter(t => !isOwn(t));

  // Repeated payments: same receiver + same document number + same amount.
  const rep = new Map<string, RepeatGroup>();
  for (const t of thirdOut) {
    const o = other(t);
    for (const ref of docRefs(t.purpose ?? "")) {
      const key = `${o.inn || o.name}|${ref}|${kop(t.amount)}`;
      const g = rep.get(key) ?? { receiver: o.name || o.inn || "—", docRef: ref, kop: kop(t.amount), ops: [] };
      g.ops.push({ date: t.date, number: t.number });
      rep.set(key, g);
    }
  }

  const creditsKop = sum(credits), debitsKop = sum(debits);
  return {
    count: txs.length, creditsKop, debitsKop, creditCount: credits.length, debitCount: debits.length,
    firstDate: dates[0] ?? "", lastDate: dates[dates.length - 1] ?? "",
    summary,
    totalsMatch:  summary ? kop(summary.totalCredits) === creditsKop && kop(summary.totalDebits) === debitsKop : undefined,
    balanceMatch: summary ? kop(summary.openingBalance) + creditsKop - debitsKop === kop(summary.closingBalance) : undefined,
    ownInn,
    ownAccounts: [...ledgers.values()].sort((a, b) => (b.toKop + b.fromKop) - (a.toKop + a.fromKop)),
    thirdPartyInKop: sum(thirdIn), thirdPartyOutKop: sum(thirdOut),
    payers: group(thirdIn), receivers: group(thirdOut),
    repeats: [...rep.values()].filter(g => g.ops.length > 1),
  };
}

// ── Text block for the model ─────────────────────────────────────────────────
const MAX_LEDGER_OPS = 80, MAX_PARTIES = 12, MAX_REPEATS = 15;
const rub = (k: number) => {
  const s = (Math.abs(k) / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (k < 0 ? "−" : "") + s;
};
const pct = (part: number, whole: number) => whole > 0 ? `${(part / whole * 100).toFixed(1).replace(".", ",")}%` : "—";

export function formatStatementFacts(f: StatementFacts): string {
  const L: string[] = [];
  L.push("=== РАСЧЁТНЫЕ ФАКТЫ (вычислены программой по ВСЕМ операциям файла; арифметика точная) ===");
  L.push("Используй эти числа как проверенные. Это только арифметика и группировка — экономический");
  L.push("смысл операций (выручка, собственные средства, налоговый резерв и т.д.) определяешь ты по");
  L.push("списку операций ниже.");
  L.push("");
  L.push("1. ИТОГИ");
  L.push(`- Операций: ${f.count}; фактические даты: ${f.firstDate} – ${f.lastDate}.`);
  L.push(`- Поступления: ${rub(f.creditsKop)} (${f.creditCount} оп.); списания: ${rub(f.debitsKop)} (${f.debitCount} оп.).`);
  if (f.summary) {
    L.push(`- Итоги самой выписки: поступило ${rub(kop(f.summary.totalCredits))}, списано ${rub(kop(f.summary.totalDebits))} — ` +
      (f.totalsMatch ? "СОВПАДАЮТ с суммой операций." : "НЕ СОВПАДАЮТ с суммой операций (в файле могут быть не все операции)."));
    L.push(`- Остатки: начальный ${rub(kop(f.summary.openingBalance))} + поступления − списания = ` +
      `${rub(kop(f.summary.openingBalance) + f.creditsKop - f.debitsKop)}; конечный по выписке ${rub(kop(f.summary.closingBalance))} — ` +
      (f.balanceMatch ? "СХОДИТСЯ." : "НЕ СХОДИТСЯ."));
  }

  L.push("");
  L.push("2. ПЕРЕВОДЫ МЕЖДУ СОБСТВЕННЫМИ СЧЕТАМИ КЛИЕНТА (на обеих сторонах один и тот же ИНН" + (f.ownInn ? ` ${f.ownInn}` : "") + ")");
  if (f.ownAccounts.length === 0) {
    L.push("- Не найдено.");
  } else {
    L.push("Это не выручка и не расчёты с контрагентами. Каждый такой счёт — отдельная ведомость;");
    L.push("сверяй резервы, накопления и возвраты по ведомости целиком, а не по формулировке назначения.");
    for (const a of f.ownAccounts) {
      L.push(`- Счёт ${a.account}: переведено на него ${rub(a.toKop)}, возвращено с него ${rub(a.fromKop)}, ` +
        `сальдо (осталось на нём из переводов периода) ${rub(a.toKop - a.fromKop)}; операций: ${a.ops.length}.`);
      for (const o of a.ops.slice(0, MAX_LEDGER_OPS)) {
        L.push(`    ${o.date} ${o.direction === "to" ? "→ на счёт " : "← со счёта"} ${rub(o.kop).padStart(12)} | №${o.number} | ${o.purpose.slice(0, 110)}`);
      }
      if (a.ops.length > MAX_LEDGER_OPS) L.push(`    … ещё ${a.ops.length - MAX_LEDGER_OPS} операций — см. список операций.`);
    }
  }

  const party = (title: string, total: number, all: number, xs: PartyTotal[], whose: string) => {
    L.push("");
    L.push(`${title}: ${rub(total)} (${pct(total, all)} ${whose})`);
    for (const p of xs.slice(0, MAX_PARTIES)) {
      L.push(`- ${p.name}${p.inn ? ` (ИНН ${p.inn})` : ""}: ${rub(p.kop)} — ${p.count} оп., ${pct(p.kop, total)} этой группы, ${pct(p.kop, all)} ${whose}`);
    }
    if (xs.length > MAX_PARTIES) L.push(`- … ещё ${xs.length - MAX_PARTIES} контрагент(ов).`);
  };
  party("3. ПОСТУПЛЕНИЯ ОТ ТРЕТЬИХ ЛИЦ (без переводов со своих счетов), по плательщику из файла", f.thirdPartyInKop, f.creditsKop, f.payers, "всех поступлений");
  L.push("  Плательщик в файле — тот, кто указан банком: при пополнении с карты или внесении наличных");
  L.push("  это сам банк, а не источник денег. Разделяй такие поступления по назначению платежа.");
  party("4. СПИСАНИЯ ТРЕТЬИМ ЛИЦАМ (без переводов на свои счета), по получателю из файла", f.thirdPartyOutKop, f.debitsKop, f.receivers, "всех списаний");

  L.push("");
  L.push("5. ПОВТОРНЫЕ ПЛАТЕЖИ — КАНДИДАТЫ В ДУБЛИ (тот же получатель + тот же номер документа в назначении + та же сумма)");
  if (f.repeats.length === 0) {
    L.push("- Не найдено.");
  } else {
    for (const g of f.repeats.slice(0, MAX_REPEATS)) {
      L.push(`- ${g.receiver}, документ № ${g.docRef}, ${rub(g.kop)} × ${g.ops.length}: ` +
        g.ops.map(o => `${o.date} (п/п ${o.number})`).join("; "));
    }
    if (f.repeats.length > MAX_REPEATS) L.push(`- … ещё ${f.repeats.length - MAX_REPEATS} групп(ы).`);
    L.push("  Это кандидаты: регулярные платежи по одному договору (аренда, абонентская плата) дублем не являются —");
    L.push("  смотри, на что ссылается номер (счёт / счёт-фактура или договор).");
  }
  L.push("=== КОНЕЦ РАСЧЁТНЫХ ФАКТОВ ===");
  return L.join("\n");
}

export function buildStatementFacts(txs: FactsTx[], summary?: FactsSummary): string {
  if (txs.length === 0) return "";
  return formatStatementFacts(computeStatementFacts(txs, summary));
}
