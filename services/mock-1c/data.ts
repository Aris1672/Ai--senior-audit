/**
 * services/mock-1c/data.ts — invented accounting data for the mock 1C server.
 *
 * One fictional company, ООО «Вектор-Трейд» (УСН «Доходы минус расходы»,
 * wholesale of office supplies), one calendar year. Every object carries ALL
 * fields of the real structure (structure.json, cut from a real
 * «Бухгалтерия предприятия» $metadata) — unset ones hold 1C's empty values —
 * so code written against the mock meets the same shapes as on a real base.
 *
 * The data is deterministic (seeded): the same year always gives the same
 * documents, so tests can assert on exact figures.
 *
 * PLANTED lists the errors put in on purpose, with the documents involved.
 * It is for tests and for judging audit results; it is never served.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

type Row = Record<string, unknown>;
interface TypeInfo { kind: string; keys: string[]; props: Record<string, string> }

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STRUCTURE: Record<string, TypeInfo> = JSON.parse(fs.readFileSync(path.join(HERE, "structure.json"), "utf8"));

export const ZERO_GUID = "00000000-0000-0000-0000-000000000000";
export const EMPTY_DATE = "0001-01-01T00:00:00";

function emptyValue(type: string): unknown {
  if (type.startsWith("Collection(")) return [];
  switch (type) {
    case "Edm.Guid": return ZERO_GUID;
    case "Edm.Boolean": return false;
    case "Edm.DateTime": return EMPTY_DATE;
    case "Edm.Double": case "Edm.Int16": case "Edm.Int32": case "Edm.Int64": case "Edm.Decimal": return 0;
    default: return "";
  }
}

/** An object of the given real type with every field present; `set` must use real field names. */
export function make(typeName: string, set: Row): Row {
  const info = STRUCTURE[typeName];
  if (!info) throw new Error(`mock-1c: type ${typeName} is not in structure.json`);
  const row: Row = {};
  for (const [name, type] of Object.entries(info.props)) row[name] = emptyValue(type);
  for (const [name, value] of Object.entries(set)) {
    if (!(name in info.props)) throw new Error(`mock-1c: ${typeName} has no field ${name}`);
    row[name] = value;
  }
  return row;
}

export function guid(seed: string): string {
  const h = createHash("sha1").update("mock-1c:" + seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function rng(seed: number) {            // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (y: number, m: number, d: number, h = 12, mi = 0, s = 0) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
const ru = (isoDate: string) => `${isoDate.slice(8, 10)}.${isoDate.slice(5, 7)}.${isoDate.slice(0, 4)}`;
const T = (name: string) => `StandardODATA.${name}`;

export interface Planted { id: string; title: string; detail: string; documents: string[]; amount: number }

export interface MockBase {
  year: number;
  organisationKey: string;
  sets: Record<string, Row[]>;          // entity set name → rows
  ledger: Row[];                        // AccountingRegister_Хозрасчетный_RecordsWithExtDimensions rows
  accounts: Map<string, { key: string; code: string; name: string; type: string }>;   // by code
  planted: Planted[];
}

export function buildBase(year = 2025, scale = 1, seed = 20251112): MockBase {
  const rand = rng(seed);
  const pick = <X,>(xs: X[]) => xs[Math.floor(rand() * xs.length)];
  const between = (a: number, b: number) => a + rand() * (b - a);
  const sets: Record<string, Row[]> = {};
  const add = (set: string, row: Row) => { (sets[set] ??= []).push(row); return row; };
  const planted: Planted[] = [];

  // ── Chart of accounts (a working subset of the standard chart) ────────────
  const accounts: MockBase["accounts"] = new Map();
  const chart: [string, string, string][] = [
    ["41.01", "Товары на складах", "Active"], ["44.01", "Издержки обращения в организациях, осуществляющих торговую деятельность", "Active"],
    ["50.01", "Касса организации", "Active"], ["51", "Расчетные счета", "Active"],
    ["58.03", "Предоставленные займы", "Active"],
    ["60.01", "Расчеты с поставщиками и подрядчиками", "Passive"], ["60.02", "Расчеты по авансам выданным", "Active"],
    ["62.01", "Расчеты с покупателями и заказчиками", "Active"], ["62.02", "Расчеты по авансам полученным", "Passive"],
    ["68.01", "НДФЛ при исполнении обязанностей налогового агента", "ActivePassive"], ["68.12", "Налог при упрощенной системе налогообложения", "ActivePassive"],
    ["69.09", "Страховые взносы по единому тарифу", "ActivePassive"],
    ["70", "Расчеты с персоналом по оплате труда", "Passive"], ["75.02", "Расчеты по выплате доходов", "Passive"],
    ["76.09", "Прочие расчеты с разными дебиторами и кредиторами", "ActivePassive"],
    ["84.01", "Прибыль, подлежащая распределению", "ActivePassive"],
    ["90.01.1", "Выручка по деятельности с основной системой налогообложения", "Passive"], ["90.02.1", "Себестоимость продаж по деятельности с основной системой налогообложения", "Active"],
    ["90.07.1", "Расходы на продажу по деятельности с основной системой налогообложения", "Active"], ["90.09", "Прибыль / убыток от продаж", "ActivePassive"],
    ["91.09", "Сальдо прочих доходов и расходов", "ActivePassive"],
    ["91.02", "Прочие расходы", "Active"], ["99.01", "Прибыли и убытки (налог при УСН)", "ActivePassive"],
  ];
  chart.forEach(([code, name, type], i) => {
    const key = guid("account:" + code);
    accounts.set(code, { key, code, name, type });
    add("ChartOfAccounts_Хозрасчетный", make("ChartOfAccounts_Хозрасчетный", {
      Ref_Key: key, Code: code, Description: name, Type: type, Order: String(i).padStart(4, "0"), Predefined: true,
      PredefinedDataName: name.replace(/[^А-Яа-яA-Za-z]/g, "").slice(0, 40),
    }));
  });
  const acc = (code: string) => accounts.get(code)!.key;

  // ── Catalogues ────────────────────────────────────────────────────────────
  const rub = guid("currency:RUB");
  add("Catalog_Валюты", make("Catalog_Валюты", { Ref_Key: rub, Code: "643", Description: "руб." }));

  const orgKey = guid("org");
  const orgAccount = guid("org-account");
  add("Catalog_Организации", make("Catalog_Организации", {
    Ref_Key: orgKey, Code: "00-000001", Description: "Вектор-Трейд ООО", НаименованиеПолное: 'Общество с ограниченной ответственностью "Вектор-Трейд"',
    НаименованиеСокращенное: 'ООО "Вектор-Трейд"', ИНН: "7700123456", КПП: "770001001", ОГРН: "1207700123456",
    ДатаРегистрации: iso(2020, 3, 16, 0), ОсновнойБанковскийСчет_Key: orgAccount, Префикс: "ВТ",
  }));
  add("Catalog_БанковскиеСчета", make("Catalog_БанковскиеСчета", {
    Ref_Key: orgAccount, Code: "000000001", Description: "40702810900000012345, АО «Тестовый Банк»", НомерСчета: "40702810900000012345",
    Owner: orgKey, Owner_Type: T("Catalog_Организации"), ВалютаДенежныхСредств_Key: rub, ДатаОткрытия: iso(2020, 4, 1, 0),
  }));

  interface Party { key: string; name: string; inn: string; contract: string; kind: "supplier" | "customer" | "other"; account: string }
  const parties: Record<string, Party> = {};
  const party = (id: string, name: string, inn: string, opts: { legal?: boolean; ip?: boolean; state?: boolean; kind?: Party["kind"]; contract?: [string, string, string] } = {}) => {
    const key = guid("party:" + id), accountKey = guid("party-account:" + id), contractKey = opts.contract ? guid("contract:" + id) : ZERO_GUID;
    const legal = opts.legal ?? true;
    add("Catalog_Контрагенты", make("Catalog_Контрагенты", {
      Ref_Key: key, Code: String(Object.keys(parties).length + 1).padStart(9, "0"), Description: name, НаименованиеПолное: name,
      ЮридическоеФизическоеЛицо: legal ? "ЮридическоеЛицо" : "ФизическоеЛицо", ИНН: inn, КПП: legal ? inn.slice(0, 4) + "01001" : "",
      ИндивидуальныйПредприниматель: !!opts.ip, ГосударственныйОрган: !!opts.state, ОсновнойБанковскийСчет_Key: accountKey,
      ИННВведенКорректно: true, ДатаСоздания: iso(year - 1, 12, 1, 9),
    }));
    add("Catalog_БанковскиеСчета", make("Catalog_БанковскиеСчета", {
      Ref_Key: accountKey, Code: String(sets["Catalog_БанковскиеСчета"].length + 1).padStart(9, "0"),
      НомерСчета: (legal && !opts.state ? "40702810" : opts.state ? "03100643" : opts.ip ? "40802810" : "40817810") + createHash("md5").update(id).digest("hex").replace(/\D/g, "").padEnd(12, "7").slice(0, 12),
      Description: "Основной счёт", Owner: key, Owner_Type: T("Catalog_Контрагенты"), ВалютаДенежныхСредств_Key: rub,
    }));
    if (opts.contract) {
      add("Catalog_ДоговорыКонтрагентов", make("Catalog_ДоговорыКонтрагентов", {
        Ref_Key: contractKey, Code: String((sets["Catalog_ДоговорыКонтрагентов"]?.length ?? 0) + 1).padStart(9, "0"),
        Description: `${opts.contract[0]} № ${opts.contract[1]} от ${ru(opts.contract[2])}`, Owner_Key: key, Организация_Key: orgKey,
        ВидДоговора: opts.kind === "customer" ? "СПокупателем" : opts.kind === "supplier" ? "СПоставщиком" : "Прочее",
        Номер: opts.contract[1], Дата: opts.contract[2], ВалютаВзаиморасчетов_Key: rub, ДоговорПодписан: true,
      }));
    }
    return (parties[id] = { key, name, inn, contract: contractKey, kind: opts.kind ?? "other", account: accountKey });
  };

  const suppliers = [
    party("s1", 'ООО "Канцопт-Север"', "7811000111", { kind: "supplier", contract: ["Договор поставки", "П-14/24", iso(year - 1, 11, 5, 0)] }),
    party("s2", 'ООО "Бумажный Двор"', "5024000222", { kind: "supplier", contract: ["Договор поставки", "112", iso(year - 1, 9, 20, 0)] }),
    party("s3", 'АО "Офис-Логистик"', "7722000333", { kind: "supplier", contract: ["Договор транспортной экспедиции", "ТЭ-7", iso(year, 1, 9, 0)] }),
    party("s4", 'ООО "Склад-Аренда"', "5003000444", { kind: "supplier", contract: ["Договор аренды", "А-3/2023", iso(year - 2, 6, 1, 0)] }),
  ];
  const customers = [
    party("c1", 'ООО "Школьный Мир"', "7733000555", { kind: "customer", contract: ["Договор поставки", "ШМ-21", iso(year - 1, 8, 12, 0)] }),
    party("c2", 'ООО "Проф-Офис"', "7806000666", { kind: "customer", contract: ["Договор поставки", "45/П", iso(year, 1, 15, 0)] }),
    party("c3", 'АО "Городские Аптеки"', "7714000777", { kind: "customer", contract: ["Договор поставки", "ГА-2025-018", iso(year, 2, 3, 0)] }),
    party("c4", "ИП Орехов Тимофей Ильич", "771400088899", { legal: false, ip: true, kind: "customer", contract: ["Договор поставки", "9", iso(year, 3, 1, 0)] }),
  ];
  const bank   = party("bank", 'АО "Тестовый Банк"', "7700999001");
  const fns    = party("fns", "Казначейство России (ФНС России)", "7727406020", { state: true });
  const noDocs = party("x1", 'ООО "Меридиан-Сервис"', "9705000112", { kind: "supplier" });                 // paid, never delivered anything
  const consult = party("x2", "ИП Глебов Арсений Маркович", "500300077766", { legal: false, ip: true, kind: "supplier" });
  const helper  = party("x3", "Сафонова Милена Робертовна", "772900055544", { legal: false });               // individual paid for "services"

  const person = (id: string, last: string, first: string, mid: string, born: string, inn: string, snils: string) => {
    const key = guid("person:" + id);
    add("Catalog_ФизическиеЛица", make("Catalog_ФизическиеЛица", {
      Ref_Key: key, Code: String((sets["Catalog_ФизическиеЛица"]?.length ?? 0) + 1).padStart(9, "0"),
      Description: `${last} ${first} ${mid}`, ФИО: `${last} ${first} ${mid}`, Фамилия: last, Имя: first, Отчество: mid,
      Инициалы: `${first[0]}. ${mid[0]}.`, ДатаРождения: born, ИНН: inn, СтраховойНомерПФР: snils, Пол: /а$/.test(first) ? "Женский" : "Мужской",
    }));
    return { key, name: `${last} ${first} ${mid}` };
  };
  const director   = person("p1", "Лаптев", "Родион", "Аркадьевич", iso(1981, 5, 14, 0), "773100011122", "112-233-445 95");
  const accountant = person("p2", "Жданова", "Таисия", "Львовна", iso(1989, 11, 2, 0), "772800033344", "134-556-778 12");
  const manager    = person("p3", "Ершов", "Демид", "Олегович", iso(1994, 7, 23, 0), "771900055566", "156-778-990 34");
  const staff = [director, accountant, manager];

  // ── Documents and their postings ──────────────────────────────────────────
  const ledger: Row[] = [];
  const counters: Record<string, number> = {};
  const nextNumber = (prefix: string) => `${prefix}-${String((counters[prefix] = (counters[prefix] ?? 0) + 1)).padStart(6, "0")}`;
  const lineNo: Record<string, number> = {};

  const post = (recorder: string, recorderType: string, period: string, dr: string, cr: string, amount: number, text: string,
                dims: { dr?: [string, string]; cr?: [string, string] } = {}) => {
    const n = (lineNo[recorder] = (lineNo[recorder] ?? 0) + 1);
    ledger.push(make("AccountingRegister_Хозрасчетный_RecordsWithExtDimensions", {
      Period: period, Recorder: recorder, Recorder_Type: T(recorderType), LineNumber: n, Active: true,
      AccountDr_Key: acc(dr), AccountCr_Key: acc(cr), Организация_Key: orgKey, Сумма: r2(amount), Содержание: text,
      СуммаНУDr: 0, СуммаНУCr: 0,
      ...(dims.dr ? { ExtDimensionDr1: dims.dr[0], ExtDimensionDr1_Type: T(dims.dr[1]) } : {}),
      ...(dims.cr ? { ExtDimensionCr1: dims.cr[0], ExtDimensionCr1_Type: T(dims.cr[1]) } : {}),
    }));
  };

  // Banks do not move money on Saturdays and Sundays: a bank document dated
  // on a weekend goes to the next Monday (or back to Friday at the year's end).
  const bankDay = (date: string): string => {
    const d = new Date(date.slice(0, 10) + "T00:00:00Z");
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) return date;
    d.setUTCDate(d.getUTCDate() + (wd === 6 ? 2 : 1));
    if (d.getUTCFullYear() !== Number(date.slice(0, 4))) d.setUTCDate(d.getUTCDate() - 3);
    return d.toISOString().slice(0, 10) + date.slice(10);
  };

  let incomingNo = 100;
  const moneyIn = (rawDate: string, p: Party, amount: number, purpose: string, opts: { cr?: string; operation?: string; posted?: boolean } = {}) => {
    const date = bankDay(rawDate);
    const key = guid("in:" + date + ":" + (counters["in"] = (counters["in"] ?? 0) + 1));
    const posted = opts.posted ?? true;
    add("Document_ПоступлениеНаРасчетныйСчет", make("Document_ПоступлениеНаРасчетныйСчет", {
      Ref_Key: key, Number: nextNumber("ВТБП"), Date: date, Posted: posted, Организация_Key: orgKey, СчетОрганизации_Key: orgAccount,
      ВидОперации: opts.operation ?? "ОплатаПокупателя", НомерВходящегоДокумента: String(++incomingNo), ДатаВходящегоДокумента: date.slice(0, 10) + "T00:00:00",
      Контрагент: p.key, Контрагент_Type: T("Catalog_Контрагенты"), СчетКонтрагента_Key: p.account, СуммаДокумента: r2(amount),
      СчетУчетаРасчетовСКонтрагентом_Key: acc(opts.cr ?? "62.01"), НазначениеПлатежа: purpose, ДоговорКонтрагента_Key: p.contract,
      ВалютаДокумента_Key: rub, СчетБанк_Key: acc("51"), Графа4_УСН: (opts.operation ?? "ОплатаПокупателя") === "ОплатаПокупателя" ? r2(amount) : 0,
    }));
    if (posted) post(key, "Document_ПоступлениеНаРасчетныйСчет", date, "51", opts.cr ?? "62.01", amount, purpose,
      { cr: [p.key, "Catalog_Контрагенты"] });
    return key;
  };

  let paymentNo = 0;
  const moneyOut = (rawDate: string, p: Party | null, amount: number, purpose: string,
                    opts: { dr?: string; operation?: string; person?: { key: string }; posted?: boolean; number?: string } = {}) => {
    const date = bankDay(rawDate);
    const key = guid("out:" + date + ":" + (counters["out"] = (counters["out"] ?? 0) + 1));
    const dr = opts.dr ?? "60.01";
    add("Document_СписаниеСРасчетногоСчета", make("Document_СписаниеСРасчетногоСчета", {
      Ref_Key: key, Number: nextNumber("ВТСП"), Date: date, Posted: opts.posted ?? true, Организация_Key: orgKey, СчетОрганизации_Key: orgAccount,
      ВидОперации: opts.operation ?? "ОплатаПоставщику", НомерВходящегоДокумента: opts.number ?? String(++paymentNo), ДатаВходящегоДокумента: date.slice(0, 10) + "T00:00:00",
      ...(p ? { Контрагент: p.key, Контрагент_Type: T("Catalog_Контрагенты"), СчетКонтрагента_Key: p.account, ДоговорКонтрагента_Key: p.contract } : {}),
      ...(opts.person ? { Сотрудник_Key: opts.person.key } : {}),
      СуммаДокумента: r2(amount), СчетУчетаРасчетовСКонтрагентом_Key: acc(dr), НазначениеПлатежа: purpose,
      ВалютаДокумента_Key: rub, СчетБанк_Key: acc("51"),
    }));
    if (opts.posted ?? true) post(key, "Document_СписаниеСРасчетногоСчета", date, dr, "51", amount, purpose,
      p ? { dr: [p.key, "Catalog_Контрагенты"] } : opts.person ? { dr: [opts.person.key, "Catalog_ФизическиеЛица"] } : {});
    return key;
  };

  const purchase = (date: string, p: Party, amount: number, what: string, invoiceNo: string, dr = "41.01") => {
    const key = guid("buy:" + date + ":" + (counters["buy"] = (counters["buy"] ?? 0) + 1));
    add("Document_ПоступлениеТоваровУслуг", make("Document_ПоступлениеТоваровУслуг", {
      Ref_Key: key, Number: nextNumber("ВТПТ"), Date: date, Posted: true, Организация_Key: orgKey, ВидОперации: dr === "41.01" ? "Товары" : "Услуги",
      Контрагент_Key: p.key, ДоговорКонтрагента_Key: p.contract, СчетУчетаРасчетовСКонтрагентом_Key: acc("60.01"), СчетУчетаРасчетовПоАвансам_Key: acc("60.02"),
      ВалютаДокумента_Key: rub, НомерВходящегоДокумента: invoiceNo, ДатаВходящегоДокумента: date.slice(0, 10) + "T00:00:00",
      СуммаДокумента: r2(amount), СуммаВключаетНДС: true, Комментарий: what, КратностьВзаиморасчетов: 1, КурсВзаиморасчетов: 1,
    }));
    post(key, "Document_ПоступлениеТоваровУслуг", date, dr, "60.01", amount, what, { cr: [p.key, "Catalog_Контрагенты"] });
    return key;
  };

  const sale = (date: string, p: Party, amount: number, what: string, opts: { posted?: boolean; deleted?: boolean } = {}) => {
    const key = guid("sell:" + date + ":" + (counters["sell"] = (counters["sell"] ?? 0) + 1));
    const posted = opts.posted ?? true;
    add("Document_РеализацияТоваровУслуг", make("Document_РеализацияТоваровУслуг", {
      Ref_Key: key, Number: nextNumber("ВТРТ"), Date: date, Posted: posted, DeletionMark: !!opts.deleted, Организация_Key: orgKey, ВидОперации: "Товары",
      Контрагент_Key: p.key, ДоговорКонтрагента_Key: p.contract, СчетУчетаРасчетовСКонтрагентом_Key: acc("62.01"), СчетУчетаРасчетовПоАвансам_Key: acc("62.02"),
      ВалютаДокумента_Key: rub, СуммаДокумента: r2(amount), СуммаВключаетНДС: true, ДокументБезНДС: true, Комментарий: what,
      КратностьВзаиморасчетов: 1, КурсВзаиморасчетов: 1, БанковскийСчетОрганизации_Key: orgAccount,
    }));
    if (posted) {
      post(key, "Document_РеализацияТоваровУслуг", date, "62.01", "90.01.1", amount, what, { dr: [p.key, "Catalog_Контрагенты"] });
      post(key, "Document_РеализацияТоваровУслуг", date, "90.02.1", "41.01", r2(amount * 0.6), "Себестоимость проданных товаров");
    }
    return key;
  };

  const manual = (date: string, dr: string, cr: string, amount: number, text: string, dims: Parameters<typeof post>[7] = {}) => {
    const key = guid("manual:" + date + ":" + (counters["manual"] = (counters["manual"] ?? 0) + 1));
    add("Document_ОперацияБух", make("Document_ОперацияБух", {
      Ref_Key: key, Number: nextNumber("ВТОП"), Date: date, Posted: true, Организация_Key: orgKey, Содержание: text, СуммаОперации: r2(amount),
    }));
    post(key, "Document_ОперацияБух", date, dr, cr, amount, text, dims);
    return key;
  };

  // Opening balances, entered on the last day of the previous year.
  manual(iso(year - 1, 12, 31, 23, 59), "51", "84.01", 2_400_000, "Ввод начальных остатков: расчетный счет");
  manual(iso(year - 1, 12, 31, 23, 59, 1), "41.01", "84.01", 3_600_000, "Ввод начальных остатков: товары");

  const goods = ["бумага офисная А4", "папки-регистраторы", "ручки шариковые", "картриджи", "тетради", "скоросшиватели", "маркеры", "калькуляторы"];
  const workday = (m: number, d: number) => {                       // move weekends to Monday
    const dt = new Date(Date.UTC(year, m - 1, d));
    const wd = dt.getUTCDay();
    if (wd === 6) dt.setUTCDate(dt.getUTCDate() + 2);
    if (wd === 0) dt.setUTCDate(dt.getUTCDate() + 1);
    if (dt.getUTCMonth() !== m - 1) dt.setUTCDate(dt.getUTCDate() - 3);
    return dt.getUTCDate();
  };

  const salary = [120_000, 85_000, 70_000];
  let invoiceSeq = 500;

  for (let m = 1; m <= 12; m++) {
    const days = new Date(Date.UTC(year, m, 0)).getUTCDate();

    // Purchases of goods, each paid 5–20 days later by one payment order naming the invoice.
    for (let i = 0; i < Math.round(9 * scale); i++) {
      const s = pick(suppliers.slice(0, 2));
      const d = 1 + Math.floor(rand() * (days - 1));
      const amount = r2(between(18_000, 140_000));
      const inv = String(++invoiceSeq);
      const date = iso(year, m, d, 10, i);
      purchase(date, s, amount, `Поступление товаров: ${pick(goods)}, ${pick(goods)}`, inv);
      const pay = new Date(Date.UTC(year, m - 1, d + 5 + Math.floor(rand() * 15)));
      if (pay.getUTCFullYear() === year) {
        moneyOut(iso(year, pay.getUTCMonth() + 1, pay.getUTCDate(), 14, i), s, amount, `Оплата по счету № ${inv} от ${ru(date)} за товары. Без НДС`);
      }
    }
    // Delivery services and warehouse rent.
    const rentDate = iso(year, m, workday(m, 5), 11);
    purchase(iso(year, m, days, 18), suppliers[3], 95_000, `Аренда склада за ${String(m).padStart(2, "0")}.${year}`, `А-${m}`, "44.01");
    moneyOut(rentDate, suppliers[3], 95_000, `Арендная плата по договору А-3/2023 за ${String(m).padStart(2, "0")}.${year}. Без НДС`);
    for (let i = 0; i < Math.round(3 * scale); i++) {
      const amount = r2(between(6_000, 28_000));
      const d = 2 + Math.floor(rand() * (days - 3));
      const inv = `ТЭ-${++invoiceSeq}`;
      purchase(iso(year, m, d, 16, i), suppliers[2], amount, "Транспортно-экспедиционные услуги", inv, "44.01");
      moneyOut(iso(year, m, Math.min(days, d + 2), 15, i), suppliers[2], amount, `Оплата по счету ${inv} за доставку. Без НДС`);
    }

    // Sales, paid by the customer 3–25 days later.
    for (let i = 0; i < Math.round(14 * scale); i++) {
      const c = pick(customers);
      const d = 1 + Math.floor(rand() * (days - 1));
      const amount = r2(between(25_000, 190_000));
      const date = iso(year, m, d, 12, i);
      const key = sale(date, c, amount, `Реализация товаров: ${pick(goods)}`);
      const pay = new Date(Date.UTC(year, m - 1, d + 3 + Math.floor(rand() * 22)));
      if (pay.getUTCFullYear() === year) {
        const number = (sets["Document_РеализацияТоваровУслуг"].find(x => x.Ref_Key === key)!.Number as string);
        moneyIn(iso(year, pay.getUTCMonth() + 1, pay.getUTCDate(), 13, i), c, amount, `Оплата по УПД ${number} от ${ru(date)} по договору. НДС не облагается`);
      }
    }

    // Payroll: accrual on the last day, pay on the 10th of the next month, НДФЛ and contributions.
    const gross = salary.reduce((a, b) => a + b, 0);
    const accrual = iso(year, m, days, 19);
    const payroll = manual(accrual, "44.01", "70", gross, `Начисление заработной платы за ${String(m).padStart(2, "0")}.${year}`);
    post(payroll, "Document_ОперацияБух", accrual, "70", "68.01", r2(gross * 0.13), "НДФЛ с заработной платы");
    post(payroll, "Document_ОперацияБух", accrual, "44.01", "69.09", r2(gross * 0.30), "Страховые взносы");
    if (m < 12) {
      const payDay = iso(year, m + 1, workday(m + 1, 10), 10);
      staff.forEach((p, i) => moneyOut(payDay.replace("T10:00", `T10:0${i}`), null, r2(salary[i] * 0.87), `Заработная плата за ${String(m).padStart(2, "0")}.${year}`,
        { dr: "70", operation: "ПеречислениеЗаработнойПлатыРаботнику", person: p }));
      moneyOut(iso(year, m + 1, workday(m + 1, 28), 10), fns, r2(gross * 0.13), `Единый налоговый платеж (НДФЛ за ${String(m).padStart(2, "0")}.${year})`, { dr: "68.01", operation: "ПеречислениеНалога" });
      moneyOut(iso(year, m + 1, workday(m + 1, 28), 10, 5), fns, r2(gross * 0.30), `Единый налоговый платеж (страховые взносы за ${String(m).padStart(2, "0")}.${year})`, { dr: "69.09", operation: "ПеречислениеНалога" });
    }

    // Bank charges.
    moneyOut(iso(year, m, days, 20), bank, r2(between(1_800, 3_400)), `Комиссия за расчетное обслуживание за ${String(m).padStart(2, "0")}.${year}`, { dr: "91.02", operation: "КомиссияБанка" });
  }

  // УСН advance payments are accrued each quarter; Q1 and 9 months are paid,
  // the half-year one is NOT (planted) — its amount stays as a credit balance on 68.12.
  manual(iso(year, 3, 31, 21), "99.01", "68.12", 28_000, `Начислен авансовый платеж по УСН за 1 квартал ${year}`);
  manual(iso(year, 6, 30, 21), "99.01", "68.12", 30_000, `Начислен авансовый платеж по УСН за полугодие ${year}`);
  manual(iso(year, 9, 30, 21), "99.01", "68.12", 27_000, `Начислен авансовый платеж по УСН за 9 месяцев ${year}`);
  const usn = (m: number, d: number, amount: number, q: string) =>
    moneyOut(iso(year, m, workday(m, d), 11, 30), fns, amount, `Единый налоговый платеж (авансовый платеж по УСН за ${q} ${year})`, { dr: "68.12", operation: "ПеречислениеНалога" });
  usn(4, 28, 28_000, "1 квартал");
  usn(10, 28, 27_000, "9 месяцев");
  planted.push({ id: "usn-q2-missing", title: "Авансовый платёж по УСН за полугодие не уплачен",
    detail: "Авансы начислены за 1 квартал, полугодие и 9 месяцев; уплачены за 1 квартал (апрель) и 9 месяцев (октябрь). Аванс за полугодие 30 000 (срок 28 июля) не уплачен — в кредитовом сальдо 68.12 (вместе с налогом за год, срок которого ещё не наступил).", documents: [], amount: 30_000 });

  // PLANTED 1 — the same supplier invoice paid twice.
  {
    const s = suppliers[1], amount = 64_380.5, inv = "20781";
    const d1 = iso(year, 5, 14, 14, 40), d2 = iso(year, 5, 29, 14, 41);
    purchase(iso(year, 5, 6, 10, 40), s, amount, "Поступление товаров: бумага офисная А4", inv);
    const a = moneyOut(d1, s, amount, `Оплата по счету № ${inv} от 06.05.${year} за бумагу офисную. Без НДС`);
    const b = moneyOut(d2, s, amount, `Оплата по счету № ${inv} от 06.05.${year} за бумагу офисную. Без НДС`);
    planted.push({ id: "double-payment", title: "Счёт поставщика оплачен дважды", detail: `Счёт № ${inv} ООО "Бумажный Двор" оплачен 14.05 и 29.05, поступление товаров одно.`, documents: [a, b], amount });
  }
  // PLANTED 2 — payments to a supplier with no incoming documents at all (debit balance on 60.01 at year end).
  {
    const docs = [[3, 18, 150_000], [6, 20, 150_000], [9, 19, 180_000]].map(([m, d, sum]) =>
      moneyOut(iso(year, m, d, 15, 20), noDocs, sum, "Оплата по договору оказания услуг № 3 от 01.03." + year + ". Без НДС"));
    planted.push({ id: "no-documents", title: "Оплаты поставщику без закрывающих документов", detail: 'ООО "Меридиан-Сервис": три платежа на 480 000, ни одного акта или накладной, нет договора в базе.', documents: docs, amount: 480_000 });
  }
  // PLANTED 3 — round sums to a sole trader for "consulting", booked straight to expenses, no acts.
  {
    const docs = [2, 4, 6, 8, 10, 12].map(m => moneyOut(iso(year, m, workday(m, 15), 16, 10), consult, 100_000,
      "Оплата консультационных услуг. НДС не облагается", { dr: "44.01" }));
    planted.push({ id: "round-consulting", title: "Круглые суммы ИП за консультационные услуги без актов", detail: "Шесть платежей по 100 000 ИП Глебову А. М., отнесены на 44.01 напрямую со счёта 51, договора и актов в базе нет.", documents: docs, amount: 600_000 });
  }
  // PLANTED 4 — an individual paid for services each month: НДФЛ and contributions not accrued.
  {
    const docs = Array.from({ length: 6 }, (_, i) => moneyOut(iso(year, 7 + i, workday(7 + i, 20), 12, 15), helper, 40_000,
      "Оплата по договору оказания услуг (уборка помещений)", { dr: "76.09", operation: "ПрочееСписание" }));
    planted.push({ id: "individual-no-tax", title: "Выплаты физическому лицу без НДФЛ и взносов", detail: "Сафоновой М. Р. выплачено 240 000 за услуги; НДФЛ и страховые взносы с этих сумм не начислены и не уплачены.", documents: docs, amount: 240_000 });
  }
  // PLANTED 5 — interest-free loan to the director, not repaid.
  {
    const doc = moneyOut(iso(year, 4, 9, 12, 50), null, 900_000, "Выдача беспроцентного займа по договору № 1-З от 08.04." + year,
      { dr: "58.03", operation: "ВыдачаЗаймаРаботнику", person: director });
    planted.push({ id: "director-loan", title: "Беспроцентный заём директору не возвращён", detail: "900 000 выдано 09.04, возвратов нет; материальная выгода и НДФЛ с неё не отражены.", documents: [doc], amount: 900_000 });
  }
  // PLANTED 6 — dividends paid in full, НДФЛ not withheld or paid.
  {
    const accr = manual(iso(year, 6, 16, 9), "84.01", "75.02", 1_200_000, "Начисление дивидендов по решению участника от 16.06." + year, { cr: [director.key, "Catalog_ФизическиеЛица"] });
    const doc = moneyOut(iso(year, 6, 17, 12, 5), null, 1_200_000, "Выплата дивидендов по решению участника от 16.06." + year,
      { dr: "75.02", operation: "ПрочееСписание", person: director });
    planted.push({ id: "dividends-no-ndfl", title: "Дивиденды выплачены без удержания НДФЛ", detail: "Начислено и выплачено 1 200 000; НДФЛ налогового агента (13%) не удержан и не перечислен.", documents: [accr, doc], amount: 1_200_000 });
  }
  // PLANTED 7 — a shipment left unposted: goods paid for by the customer, no revenue in the ledger.
  {
    const c = customers[2], amount = 312_400;
    const s = sale(iso(year, 11, 12, 12, 55), c, amount, "Реализация товаров: картриджи", { posted: false });
    const number = sets["Document_РеализацияТоваровУслуг"].find(x => x.Ref_Key === s)!.Number as string;
    const p = moneyIn(iso(year, 11, 20, 13, 55), c, amount, `Оплата по УПД ${number} от 12.11.${year}. НДС не облагается`);
    sale(iso(year, 11, 13, 9), customers[0], 55_000, "Реализация товаров (ошибочный ввод)", { posted: false, deleted: true });   // marked for deletion: must be ignored
    planted.push({ id: "unposted-sale", title: "Реализация не проведена — выручка не отражена", detail: `УПД ${number} на 312 400 не проведён; оплата от покупателя поступила 20.11.`, documents: [s, p], amount });
  }

  // Month-end closing (done last, so that it sees every document of the month),
  // and the year-end closing of accounts 90, 91 and 99.
  {
    const turnover = (code: string, sideKey: "AccountDr_Key" | "AccountCr_Key", from: string, to: string) =>
      r2(ledger.filter(r => r[sideKey] === acc(code) && String(r.Period) >= from && String(r.Period) <= to).reduce((sum, r) => sum + Number(r.Сумма), 0));
    for (let m = 1; m <= 12; m++) {
      const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
      const from = iso(year, m, 1, 0), to = iso(year, m, days, 22, 59, 59), at = iso(year, m, days, 23, 30);
      const label = `${String(m).padStart(2, "0")}.${year}`;
      const costs = turnover("44.01", "AccountDr_Key", from, to);
      const profit = r2(turnover("90.01.1", "AccountCr_Key", from, to) - turnover("90.02.1", "AccountDr_Key", from, to) - costs);
      const other = turnover("91.02", "AccountDr_Key", from, to);
      const doc = manual(at, "90.07.1", "44.01", costs, `Закрытие месяца ${label}: списание издержек обращения`);
      if (profit >= 0) post(doc, "Document_ОперацияБух", at, "90.09", "99.01", profit, `Закрытие месяца ${label}: прибыль от продаж`);
      else post(doc, "Document_ОперацияБух", at, "99.01", "90.09", -profit, `Закрытие месяца ${label}: убыток от продаж`);
      post(doc, "Document_ОперацияБух", at, "99.01", "91.09", other, `Закрытие месяца ${label}: сальдо прочих расходов`);
    }
    const from = iso(year, 1, 1, 0), to = iso(year, 12, 31, 23, 45), at = iso(year, 12, 31, 23, 50);
    const net = (code: string) => r2(turnover(code, "AccountDr_Key", from, to) - turnover(code, "AccountCr_Key", from, to));
    // The year's tax is accrued before the books are closed: 15% of the profit,
    // but not less than the minimum tax (1% of the money received), less the
    // advances already accrued. It falls due the next March.
    {
      const accrued = turnover("68.12", "AccountCr_Key", from, to);
      const profit  = -net("99.01") + accrued;
      const income  = turnover("51", "AccountDr_Key", from, to);
      const minimum = Math.round(income * 0.01), regular = Math.round(Math.max(profit, 0) * 0.15);
      const yearTax = Math.max(minimum, regular);
      const what = minimum > regular ? "минимальный налог 1% от доходов" : "15% от разницы доходов и расходов";
      if (yearTax > accrued) {
        manual(iso(year, 12, 31, 23, 40), "99.01", "68.12", r2(yearTax - accrued), `Начислен налог по УСН за ${year} год (${what}) за вычетом авансовых платежей`);
      }
    }
    const doc = manual(at, "90.01.1", "90.09", -net("90.01.1"), `Реформация баланса ${year}: закрытие счета 90.01`);
    post(doc, "Document_ОперацияБух", at, "90.09", "90.02.1", net("90.02.1"), `Реформация баланса ${year}: закрытие счета 90.02`);
    post(doc, "Document_ОперацияБух", at, "90.09", "90.07.1", net("90.07.1"), `Реформация баланса ${year}: закрытие счета 90.07`);
    post(doc, "Document_ОперацияБух", at, "91.09", "91.02", net("91.02"), `Реформация баланса ${year}: закрытие счета 91.02`);
    const result = -net("99.01");                           // credit balance = profit after tax
    if (result >= 0) post(doc, "Document_ОперацияБух", at, "99.01", "84.01", result, `Реформация баланса ${year}: чистая прибыль`);
    else post(doc, "Document_ОперацияБух", at, "84.01", "99.01", -result, `Реформация баланса ${year}: убыток`);
  }

  ledger.sort((a, b) => String(a.Period).localeCompare(String(b.Period)) || String(a.Recorder).localeCompare(String(b.Recorder)) || Number(a.LineNumber) - Number(b.LineNumber));
  for (const rows of Object.values(sets)) {
    if (rows.length && "Date" in rows[0]) rows.sort((a, b) => String(a.Date).localeCompare(String(b.Date)));
  }
  return { year, organisationKey: orgKey, sets, ledger, accounts, planted };
}
