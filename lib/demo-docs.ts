/**
 * lib/demo-docs.ts — the supporting documents for a demonstration on the demo
 * 1C base (stage 2: closing findings). Invented company ООО «Вектор-Трейд»;
 * every file is marked «Тестовые данные вымышленной организации».
 * Files: services/mock-1c/demo-docs/ (built by scripts/dev/make-stage2-docs.py).
 * Downloaded from the admin page «Демо 1С» (one by one or as a ZIP).
 */
import fs from "node:fs";
import path from "node:path";

export interface DemoDoc { file: string; round: 1 | 2; title: string; expect: string }

/** In the order to upload them. Expected results: PROJECT_STATUS.md, stage-2 entry of Nov 13, 2026. */
export const DEMO_DOCS: DemoDoc[] = [
  { file: "meridian_dogovor_i_akty.pdf", round: 1, title: "Меридиан-Сервис: договор № 3 и акты № 1–3",
    expect: "предложение закрыть вывод об авансе 480 000 ₽ без встречного предоставления" },
  { file: "safonova_spravka_npd_i_cheki.pdf", round: 1, title: "Сафонова: справка о статусе НПД и 6 чеков",
    expect: "предложение закрыть вывод о выплатах физлицу без НДФЛ и взносов" },
  { file: "glebov_dogovor_i_akty_4_iz_6.pdf", round: 1, title: "ИП Глебов: договор и 4 акта из 6",
    expect: "вывод остаётся открытым: покрыто 400 000 из 600 000 ₽" },
  { file: "bumazhny_dvor_schet_20781.pdf", round: 1, title: "Бумажный Двор: счёт № 20781",
    expect: "двойная оплата остаётся открытой — счёт её не снимает" },
  { file: "poyasnenie_bez_dokumentov.docx", round: 1, title: "Пояснение руководства без документов",
    expect: "намерения без документов — выводы по дивидендам, займу и авансу УСН остаются открытыми" },
  { file: "bumazhny_dvor_akt_sverki.pdf", round: 2, title: "Бумажный Двор: акт сверки",
    expect: "предложение закрыть вывод о двойной оплате (зачёт и аванс 7 057 ₽)" },
  { file: "glebov_akt_oktyabr.pdf", round: 2, title: "ИП Глебов: акт № 5 за сентябрь–октябрь",
    expect: "выявляется расхождение: акт на 90 000 ₽ при оплате 100 000 ₽" },
];

export function demoDocPath(name: string): string | null {
  if (!DEMO_DOCS.some(d => d.file === name)) return null;   // only the listed files — never a path from the request
  const candidates = [path.join(/* turbopackIgnore: true */ process.cwd(), "services", "mock-1c", "demo-docs", name)];
  return candidates.find(p => fs.existsSync(p)) ?? null;
}

export const contentType = (name: string) =>
  name.endsWith(".pdf") ? "application/pdf"
  : name.endsWith(".docx") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  : "application/octet-stream";
