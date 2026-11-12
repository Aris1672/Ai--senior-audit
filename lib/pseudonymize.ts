/**
 * lib/pseudonymize.ts — reversible pseudonymization at the LLM boundary (Step C).
 *
 * Everything we store (documents, chat messages, findings) stays REAL in our
 * own database in Russia. Coding happens only on the way out to the LLM and
 * is undone on the way back:
 *
 *   real text ──encode──▶ coded text ──▶ DeepSeek ──▶ coded reply ──restore──▶ real reply
 *
 * Scope (decided Nov 12, 2026): INDIVIDUALS ONLY — natural persons and
 * individual entrepreneurs. Company names, 10-digit company ИНН and company
 * accounts stay readable; amounts, dates and document numbers are never coded.
 *
 * What is coded:
 *   [ФЛ_n]           person's name in any detected form (ФИО, Фамилия И.О.,
 *                    case forms of a known surname). "ИП" / "Индивидуальный
 *                    предприниматель" stays outside the token — audit signal.
 *   [ИНН_ФЛ_n]       12-digit ИНН            [ОГРНИП_n]  15-digit ОГРНИП
 *   [СЧЕТ_n:40802]   20-digit account of an individual / ИП — the first five
 *                    digits (account type) are kept, they are an audit signal
 *   [КАРТА_n]        card number, full or masked
 *   [СНИЛС_n] [ПАСПОРТ_n] [ТЕЛ_n] [EMAIL_n]
 *
 * No stored token map: the map lives only for one request. Each request
 * re-codes the documents and the (real) chat history from scratch, in the
 * same order, so tokens are consistent within a request — which is all the
 * model ever sees. Nothing reversible is persisted or sent anywhere.
 *
 * FAIL CLOSED: after coding, the outbound payload is scanned for every
 * original value the coder knows about. If one is still there, or coding
 * throws, PseudonymizationError is raised and nothing is sent.
 *
 * KNOWN LIMITS (v1 — rules in code, no NER service yet):
 *   - A name is found only if it has a recognisable shape: after "ИП",
 *     with a patronymic, with initials, or next to a common first name.
 *     A bare unknown surname in free text ("оплата Сидорову") is NOT found
 *     unless that person also appears elsewhere in a recognisable shape.
 *   - Postal addresses and dates of birth are not coded.
 *   - Two people with the same surname and no initials get one token.
 *   - Uploaded images / scans are a separate matter (they are not sent).
 */

export class PseudonymizationError extends Error {
  constructor(message: string) { super(message); this.name = "PseudonymizationError"; }
}

// Added to the system prompt when coding is on.
export const PSEUDONYM_NOTE = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ОБЕЗЛИЧЕННЫЕ ДАННЫЕ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Персональные данные физических лиц и ИП в документах и сообщениях заменены
кодами в квадратных скобках: [ФЛ_1] — физическое лицо (ФИО), [ИНН_ФЛ_1] —
его ИНН, [СЧЕТ_1:40802] — счёт (после двоеточия сохранены первые пять цифр —
тип счёта), [КАРТА_1] — номер карты, а также [ОГРНИП_1], [СНИЛС_1],
[ПАСПОРТ_1], [ТЕЛ_1], [EMAIL_1]. Один код всегда обозначает одно и то же
лицо или реквизит. Используй коды в ответе и в record_findings ровно в том
виде, как они даны: не изменяй, не склоняй, не сокращай, не придумывай новые
и не пытайся угадать, кто за ними стоит — система сама подставит настоящие
значения перед показом клиенту. Наименования организаций не кодируются.`;

const CYR = "А-Яа-яЁё";
const NB = `(?<![${CYR}])`;              // no Cyrillic letter before (JS \b ignores Cyrillic)
const NA = `(?![${CYR}])`;               // no Cyrillic letter after
const TITLE = `[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?`;
const UPPER = `[А-ЯЁ]{2,}(?:-[А-ЯЁ]{2,})?`;
const W = `(?:${TITLE}|${UPPER})`;        // a capitalised or ALL-CAPS Cyrillic word

// Account-type prefixes that belong to individuals / ИП.
const PERSON_ACCOUNT = /^(40817|40802|40820|40803|40813|423\d\d|426\d\d)/;

const FIRST_NAMES = new Set(`александр алексей анатолий андрей антон аркадий арсений артём артем артур богдан борис вадим валентин
валерий василий виктор виталий владимир владислав всеволод вячеслав геннадий георгий герман глеб григорий давид даниил данила денис
дмитрий евгений егор эдуард иван игорь илья кирилл константин лев леонид максим марат марк матвей михаил назар никита николай олег
павел пётр петр роман руслан рустам сергей семён семен станислав степан тимофей тимур фёдор федор филипп эльдар юрий яков ярослав
александра алина алиса алла анастасия ангелина анжела анна антонина валентина валерия вера вероника виктория галина дарья диана ева
евгения екатерина елена елизавета жанна зинаида зоя инна ирина карина кира клавдия кристина ксения лариса лидия лилия любовь людмила
маргарита марина мария милана надежда наталья наталия нина оксана олеся ольга полина раиса регина светлана софия софья таисия тамара
татьяна ульяна юлия яна`.split(/\s+/).filter(Boolean));

// First name in any case form (Иван / Ивана / Ивану, Анна / Анне / Анну).
const NAME_STEMS = new Set([...FIRST_NAMES].map(n => /[аяйь]$/.test(n) ? n.slice(0, -1) : n));
const NAME_ENDINGS = ["", "а", "я", "у", "ю", "е", "ы", "и", "ой", "ей", "ом", "ем", "ём", "ью"];
function isFirstName(w: string): boolean {
  const s = w.toLowerCase();
  if (FIRST_NAMES.has(s)) return true;
  return NAME_ENDINGS.some(e => s.endsWith(e) && s.length - e.length >= 3 && NAME_STEMS.has(s.slice(0, s.length - e.length)));
}
// Typical Russian surname shape (any case form) — used where the only other
// clue is a neighbouring first name, to avoid coding ordinary words.
function looksLikeSurname(w: string): boolean {
  const s = low(w).replace(/(ого|ому|ыми|ими|ым|им|ом|ой|ую|ая|ых|их|ые|а|у|е|ы)$/, m => (/(ых|их)$/.test(m) ? m : ""));
  return /(ов|ев|ин|ын|ск|цк|ко|ук|юк|чук|ак|як|ич|ян|янц|дзе|швили|их|ых|ец|ман|берг|штейн|ский|цкий|ской)$/.test(s);
}

const STOP = new Set(`ооо оао зао пао ао нко ип банк счет счёт оплата договор перевод покупка возврат терминал общество
индивидуальный предприниматель москва россия ндс без налог услуги товар сумма карта дата операции аренда займ заём зарплата
акт уфк ифнс фнс сфр филиал отделение компания фирма группа завод магазин аптека инн кпп огрн огрнип бик снилс
рф руб директор бухгалтер генеральный главный`.split(/\s+/).filter(Boolean));

// Patronymic in any case form: Иванович/-а/-у/-ем/-е, Ивановна/-ы/-е/-у/-ой.
const isPatronymic = (w: string) => w.length >= 6 &&
  /((ович|евич|ьич)(а|у|ем|ом|е)?|(овн|евн|ичн|иничн)(а|ы|е|у|ой)|оглы|кызы)$/i.test(w);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
const low = (s: string) => s.toLowerCase().replace(/ё/g, "е");

function surnameStem(surname: string): string {
  const s = low(surname);
  if (/(ий|ый|ой|ая|яя)$/.test(s) && s.length > 5) return s.slice(0, -2);
  if (/[аяыиуюео]$/.test(s) && s.length > 4) return s.slice(0, -1);
  return s;
}
// A stem as a regex fragment that matches both "е" and "ё".
const stemRe = (stem: string) => esc(stem).replace(/е/g, "[её]");

interface Person { token: string; stem: string; display: string; name?: string; patr?: string; i1?: string; i2?: string; nominative?: boolean; }

export class Pseudonymizer {
  private persons: Person[] = [];
  private ids = new Map<string, string>();        // original value → token
  private back = new Map<string, string>();       // token → value shown on restore
  private counters: Record<string, number> = {};
  private secrets = new Set<string>();            // originals that must never go out

  get stats() { return { persons: this.persons.length, identifiers: this.ids.size }; }
  /** For tests only: what each person token restores to. */
  get personDisplays(): string[] { return this.persons.map(p => p.display); }

  // ── identifiers ────────────────────────────────────────────────────────────
  private idToken(kind: string, original: string, key = original, suffix = ""): string {
    const k = `${kind}|${key}`;
    let t = this.ids.get(k);
    if (!t) {
      this.counters[kind] = (this.counters[kind] ?? 0) + 1;
      t = `[${kind}_${this.counters[kind]}${suffix}]`;
      this.ids.set(k, t);
      this.back.set(`${kind}_${this.counters[kind]}`, original);
      this.secrets.add(key);
      this.secrets.add(original);   // also the exact surface form (with spaces / dashes)
    }
    return t;
  }

  private encodeIdentifiers(text: string): string {
    const digits = (s: string) => s.replace(/\D/g, "");
    return text
      // e-mail
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, m => this.idToken("EMAIL", m, m.toLowerCase()))
      // 20-digit accounts of individuals / ИП (keep the 5-digit type prefix)
      .replace(/(?<!\d)\d{20}(?!\d)/g, m => PERSON_ACCOUNT.test(m) ? this.idToken("СЧЕТ", m, m, `:${m.slice(0, 5)}`) : m)
      // masked cards: 2204********1234, 427638******1234, 220015++++++0023, 4276XXXXXXXX1234
      .replace(/(?<!\d)\d{4,6}[*+xXхХ•.]{4,12}\d{4}(?!\d)/g, m => this.idToken("КАРТА", m))
      // full card numbers (16 digits, optional separators)
      .replace(/(?<!\d)(?:\d{4}[ -]?){3}\d{4}(?!\d)/g, m => this.idToken("КАРТА", m, digits(m)))
      // ОГРНИП (15 digits, starts with 3)
      .replace(/(?<!\d)3\d{14}(?!\d)/g, m => this.idToken("ОГРНИП", m))
      // 12-digit ИНН of an individual / ИП
      .replace(/(?<![\d.,])\d{12}(?!\d|[.,]\d)/g, m => this.idToken("ИНН_ФЛ", m))
      // СНИЛС 123-456-789 01
      .replace(/(?<!\d)\d{3}-\d{3}-\d{3}[ -]\d{2}(?!\d)/g, m => this.idToken("СНИЛС", m, digits(m)))
      // passport: "паспорт … 45 08 123456"
      .replace(/(паспорт\S*[^\d\n]{0,25})(\d{2}\s?\d{2}\s?(?:№\s?)?\d{6})(?!\d)/gi,
        (_m, pre: string, num: string) => pre + this.idToken("ПАСПОРТ", num, digits(num)))
      // phones: +7 / 8 (xxx) xxx-xx-xx
      .replace(/(?<![\d,.])(?:\+7|8)[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/g,
        m => this.idToken("ТЕЛ", m, digits(m).replace(/^8/, "7")));
  }

  // ── persons ────────────────────────────────────────────────────────────────
  private addPerson(surname: string, name?: string, patr?: string, i1?: string, i2?: string): void {
    if (!surname || STOP.has(low(surname)) || surname.length < 2) return;
    const stem = surnameStem(surname);
    const init1 = (name?.[0] ?? i1)?.toUpperCase();
    // Same person if the stems match — or, for short surnames whose case
    // endings are not stripped ("Кот" / "Коту"), if one stem extends the
    // other by at most two letters — and the initials do not contradict.
    const sameStem = (a: string, b: string) => a === b ||
      (Math.abs(a.length - b.length) <= 2 && Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));
    const existing = this.persons.find(p => sameStem(p.stem, stem) && (!p.i1 || !init1 || p.i1 === init1));
    if (existing && stem.length < existing.stem.length) existing.stem = stem;   // keep the shorter (base) stem
    if (existing) {
      // learn a fuller form if we now have one
      // learn a fuller / nominative form if we now have one
      const nominative = !!name && (FIRST_NAMES.has(name.toLowerCase()) || (!!patr && /(ич|на|оглы|кызы)$/i.test(patr)));
      if (name && (!existing.name || (nominative && !existing.nominative))) {
        existing.name = name; existing.patr = patr; existing.nominative = nominative;
        existing.display = [surname, name, patr].filter(Boolean).join(" ");
        this.back.set(existing.token.slice(1, -1), existing.display);
      }
      existing.i1 ??= init1; existing.i2 ??= (patr?.[0] ?? i2)?.toUpperCase();
      return;
    }
    this.counters["ФЛ"] = (this.counters["ФЛ"] ?? 0) + 1;
    const token = `[ФЛ_${this.counters["ФЛ"]}]`;
    const display = name ? [surname, name, patr].filter(Boolean).join(" ")
      : init1 ? `${surname} ${init1}.${i2 ? i2.toUpperCase() + "." : ""}` : surname;
    this.persons.push({ token, stem, display, name, patr, i1: init1, i2: (patr?.[0] ?? i2)?.toUpperCase(),
      nominative: !!name && (FIRST_NAMES.has(name.toLowerCase()) || (!!patr && /(ич|на|оглы|кызы)$/i.test(patr))) });
    this.back.set(token.slice(1, -1), display);
  }

  /**
   * Remember a name found by the name-detection service (Natasha). The
   * service's own first/last split is unreliable ("Сидоров Пётр" comes back
   * with the roles swapped), so the roles are assigned here: patronymic by
   * its ending, first name by the dictionary, single letters as initials,
   * and the remaining word is the surname. A span without a surname (a lone
   * first name) is ignored.
   */
  learnDetectedName(span: string): void {
    const words = span.split(/[\s.,]+/).filter(w => /^[А-ЯЁа-яё-]+$/.test(w));
    let surname: string | undefined, name: string | undefined, patr: string | undefined;
    const initials: string[] = [];
    for (const w of words) {
      if (w.length === 1) initials.push(w.toUpperCase());
      else if (isPatronymic(w)) patr ??= w;
      else if (isFirstName(w)) name ??= w;
      else if (!STOP.has(low(w))) surname ??= w;
    }
    if (!surname) return;   // a lone first name / patronymic is not coded
    // The service also returns ordinary words now and then ("Контрагент",
    // "Верификационный" on a real bank report). A word on its own is taken as
    // a surname only if it has a surname shape; with a first name, patronymic
    // or initials beside it, any word is accepted.
    if (!name && !patr && initials.length === 0 && !looksLikeSurname(surname)) return;
    const cap = (w: string) => (w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1));
    this.addPerson(cap(surname), name && cap(name), patr && cap(patr), initials[0], initials[1]);
  }

  /** Find people in a text and remember them. Call for every outbound text before encode(). */
  learn(text: string): void {
    // P1: after "ИП" / "Индивидуальный предприниматель"
    for (const m of text.matchAll(new RegExp(`(?:[Ии]ндивидуальн\\S+\\s+предпринимател\\S+|ИНДИВИДУАЛЬН\\S+\\s+ПРЕДПРИНИМАТЕЛ\\S+|${NB}ИП)\\s+(${W})(?:\\s+(${W})\\s+(${W})(?:\\s+(?:оглы|кызы))?|\\s+([А-ЯЁ])\\.\\s?([А-ЯЁ])\\.)?`, "g"))) {
      if (m[2] && m[3] && !STOP.has(low(m[2]))) this.addPerson(m[1], m[2], m[3]);
      else this.addPerson(m[1], undefined, undefined, m[4], m[5]);
    }
    // P2: three words, one of them a patronymic
    for (const m of text.matchAll(new RegExp(`${NB}(?=(${W})\\s+(${W})\\s+(${W})${NA})`, "g"))) {
      const [, a, b, c] = m;
      if (isPatronymic(c) && !isPatronymic(b)) this.addPerson(a, b, c);          // Фамилия Имя Отчество
      else if (isPatronymic(b) && !isPatronymic(a) && isFirstName(a)) {          // Имя Отчество Фамилия
        // …unless a surname already stands before the name (then c is just the next word)
        const prev = new RegExp(`(${W})\\s+$`).exec(text.slice(Math.max(0, m.index! - 40), m.index));
        if (!prev || STOP.has(low(prev[1]))) this.addPerson(c, a, b);
      }
    }
    // P3: surname + initials, initials + surname. "W1 И.О. W2" is ambiguous
    // (which word is the surname?) — decided by which one has a surname shape.
    for (const m of text.matchAll(new RegExp(`${NB}(${W})\\s+([А-ЯЁ])\\.\\s?([А-ЯЁ])\\.(?=(?:\\s?(${TITLE}))?)`, "g"))) {
      const next = m[4];
      if (next && !looksLikeSurname(m[1]) && looksLikeSurname(next)) continue;   // → initials belong to the next word
      this.addPerson(m[1], undefined, undefined, m[2], m[3]);
    }
    for (const m of text.matchAll(new RegExp(`${NB}([А-ЯЁ])\\.\\s?([А-ЯЁ])\\.\\s?(${TITLE})${NA}`, "g"))) {
      const prev = new RegExp(`(${W})\\s+$`).exec(text.slice(Math.max(0, m.index! - 40), m.index))?.[1];
      if (prev && !STOP.has(low(prev)) && (looksLikeSurname(prev) || !looksLikeSurname(m[3]))) continue; // → belong to the previous word
      this.addPerson(m[3], undefined, undefined, m[1], m[2]);
    }
    // P4: surname next to a common first name
    for (const m of text.matchAll(new RegExp(`${NB}(?=(${W})\\s+(${W})${NA})`, "g"))) {
      const [, a, b] = m;
      const an = isFirstName(a), bn = isFirstName(b);
      if (bn && !an && !isPatronymic(a) && looksLikeSurname(a)) this.addPerson(a, b);
      else if (an && !bn && !isPatronymic(b) && looksLikeSurname(b)) this.addPerson(b, a);
    }
  }

  private encodePersons(text: string): string {
    const stems = [...new Set(this.persons.map(p => p.stem))].sort((a, b) => b.length - a.length);
    for (const stem of stems) {
      const group = this.persons.filter(p => p.stem === stem);
      // Short stems ("Кот", "Ли"): a case form ("Коту") is accepted only next
      // to initials or a name — otherwise ordinary words would be coded.
      const short = stem.length < 4;
      const re = new RegExp(`${NB}${stemRe(stem)}[${CYR}]{0,${short ? 2 : 3}}${NA}`, "gi");
      let out = "", pos = 0, m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        if (!/^[А-ЯЁ]/.test(m[0])) continue;                       // names are capitalised
        // Never touch the inside of one of OUR codes — but ordinary brackets
        // in the source text ("[Иванова Анна +7…]") are not codes.
        const lb = text.lastIndexOf("[", m.index);
        if (lb !== -1 && m.index - lb < 24) {
          const own = /^\[(?:ФЛ|ИНН_ФЛ|ОГРНИП|СЧЕТ|КАРТА|СНИЛС|ПАСПОРТ|ТЕЛ|EMAIL)_\d+(?::\d{5})?\]/.exec(text.slice(lb, lb + 24));
          if (own && m.index < lb + own[0].length) continue;
        }
        let start = m.index, end = m.index + m[0].length, initial: string | undefined;
        const before = text.slice(Math.max(pos, start - 60), start);
        const rest = text.slice(end, end + 80);
        let x: RegExpExecArray | null;
        if ((x = /^\s+([А-ЯЁ])\.(?:\s?[А-ЯЁ]\.)?/.exec(rest))) { end += x[0].length; initial = x[1]; }       // Иванов И.И.
        else if ((x = new RegExp(`^\\s+(${W})(?:\\s+(${W}))?(?:\\s+(?:оглы|кызы))?`).exec(rest))) {          // Иванов Иван Иванович
          const n1 = x[1], n2 = x[2];
          if (n2 && isPatronymic(n2)) { end += x[0].length; initial = n1[0]; }
          else if (isFirstName(n1) || group.some(p => p.name && low(p.name).slice(0, 3) === low(n1).slice(0, 3))) {
            end += /^\s+/.exec(rest)![0].length + n1.length; initial = n1[0];
          }
        }
        if ((x = /([А-ЯЁ])\.\s?([А-ЯЁ])\.\s?$/.exec(before))) { start -= x[0].length; initial ??= x[1]; }     // И.И. Иванов
        else if ((x = new RegExp(`(${W})\\s+(${W})\\s+$`).exec(before)) && isPatronymic(x[2])) { start -= x[0].length; initial ??= x[1][0]; } // Иван Иванович Иванов
        else if ((x = new RegExp(`(${W})\\s+$`).exec(before)) && isFirstName(x[1])) { start -= x[0].length; initial ??= x[1][0]; }   // Иван Иванов
        if (short && low(m[0]) !== stem && !initial) { re.lastIndex = m.index + m[0].length; continue; }
        const person = group.find(p => initial && p.i1 === initial.toUpperCase()) ?? group[0];
        out += text.slice(pos, start) + person.token;
        pos = end; re.lastIndex = end;
      }
      text = out + text.slice(pos);
    }
    // "Имя Отчество" left without a surname
    text = text.replace(new RegExp(`${NB}(${W})\\s+(${W})${NA}`, "g"), (m, a: string, b: string) => {
      if (!isPatronymic(b) || !isFirstName(a)) return m;
      const p = this.persons.find(q => q.name && low(q.name) === low(a) && q.patr && low(q.patr).slice(0, 4) === low(b).slice(0, 4));
      if (p) return p.token;
      this.counters["ФЛ"] = (this.counters["ФЛ"] ?? 0) + 1;
      const token = `[ФЛ_${this.counters["ФЛ"]}]`;
      this.persons.push({ token, stem: `\u0000${low(a)} ${low(b)}`, display: m, name: a, patr: b, i1: a[0].toUpperCase() });
      this.back.set(token.slice(1, -1), m);
      this.secrets.add(low(m));
      return token;
    });
    return text;
  }

  /** Code one text. learn() must have seen all outbound texts first. */
  encode(text: string): string {
    return this.encodePersons(this.encodeIdentifiers(text));
  }

  /** Fail-closed check: no known original may remain in a coded text. */
  verify(coded: string): void {
    const hay = low(coded);
    for (const s of this.secrets) {
      if (s.length < 4) continue;
      // all-digit values must match as a whole number, not inside a longer one
      const found = /^\d+$/.test(s) ? new RegExp(`(?<!\\d)${s}(?!\\d)`).test(coded) : hay.includes(low(s));
      if (found) throw new PseudonymizationError("identifier left uncoded");
    }
    for (const p of this.persons) {
      if (p.stem.startsWith("\u0000") || p.stem.length < 4) continue;
      const re = new RegExp(`${NB}${stemRe(p.stem)}[${CYR}]{0,3}${NA}`, "gi");
      for (const m of coded.matchAll(re)) {
        if (/^[А-ЯЁ]/.test(m[0])) throw new PseudonymizationError("name left uncoded");
      }
    }
  }

  /** Code a whole request (system prompt + message texts) and verify it. Throws → send nothing. */
  encodeRequest(texts: string[]): string[] {
    try {
      for (const t of texts) this.learn(t);
      const coded = texts.map(t => this.encode(t));
      for (const c of coded) this.verify(c);
      return coded;
    } catch (err) {
      if (err instanceof PseudonymizationError) throw err;
      throw new PseudonymizationError(`coding failed: ${(err as Error)?.message ?? err}`);
    }
  }

  // ── restore ────────────────────────────────────────────────────────────────
  static readonly TOKEN = /\[((?:ФЛ|ИНН_ФЛ|ОГРНИП|СЧ[ЕЁ]Т|КАРТА|СНИЛС|ПАСПОРТ|ТЕЛ|EMAIL)_\d+)(?::\d{5})?\]/g;
  unknownTokens = 0;

  restore(text: string): string {
    return text.replace(Pseudonymizer.TOKEN, (m, key: string) => {
      const v = this.back.get(key.replace("СЧЁТ", "СЧЕТ"));
      if (v === undefined) { this.unknownTokens++; return m; }   // model invented a token — leave visible
      return v;
    });
  }

  restoreDeep<T>(value: T): T {
    if (typeof value === "string") return this.restore(value) as unknown as T;
    if (Array.isArray(value)) return value.map(v => this.restoreDeep(v)) as unknown as T;
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, this.restoreDeep(v)])) as T;
    }
    return value;
  }

  /** Restorer for streamed text: holds back a token that is split across chunks. */
  stream(emit: (text: string) => void) {
    let buf = "";
    const MAX_TOKEN = 24;
    return {
      push: (delta: string) => {
        buf += delta;
        const open = buf.lastIndexOf("[");
        const hold = open !== -1 && buf.indexOf("]", open) === -1 && buf.length - open <= MAX_TOKEN ? open : buf.length;
        const ready = buf.slice(0, hold);
        buf = buf.slice(hold);
        if (ready) emit(this.restore(ready));
      },
      flush: () => { if (buf) emit(this.restore(buf)); buf = ""; },
      clear: () => { buf = ""; },
    };
  }
}
