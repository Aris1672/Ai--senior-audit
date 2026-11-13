// Code test (no LLM, no database): recognised scans — confidence gate,
// pricing per reliable page, what the model is shown, the client's wording.
//   npm run test:ocr
// With the service running (OCR_URL, OCR_TOKEN set) it also recognises the
// files given as arguments and prints the counts and the price:
//   OCR_URL=http://127.0.0.1:8000 OCR_TOKEN=dev npm run test:ocr -- scan.pdf photo.jpg
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.LLM_API_KEY ||= "test";

async function main() {
  const O = await import("../lib/ocr");
  const { quoteDocument, describeQuote, PAGE_KINDS, NOT_READ_KINDS } = await import("../lib/doc-billing");
  const { toParsedSummary } = await import("../lib/file-parser");
  const PAGE = 20;
  const quote = (fileType: string, parsed: any, extra: Record<string, unknown> = {}) =>
    quoteDocument({ fileType, parsed, knownKeys: new Map(), sameFileAlreadyAccepted: false,
                    operationRateRub: 10.5, pageRateRub: PAGE, ...extra });

  const page = (n: number, confidence: number, words = 120, text = `Акт № ${n} от 31.03.2025\nСтоимость услуг: 150 000,00 руб.`) =>
    ({ page: n, text, confidence, words, uncertainNumbers: 0, rotated: 0 });

  // 1. Gate: threshold 75 by default; the measured bands fall on the right sides.
  delete process.env.OCR_MIN_CONFIDENCE;
  assert.equal(O.minConfidenceFromEnv(), 75);
  process.env.OCR_MIN_CONFIDENCE = "80"; assert.equal(O.minConfidenceFromEnv(), 80);
  process.env.OCR_MIN_CONFIDENCE = "abc"; assert.equal(O.minConfidenceFromEnv(), 75);
  delete process.env.OCR_MIN_CONFIDENCE;
  assert.equal(O.pageStatus(page(1, 94.6), 75), "reliable");      // clean scan
  assert.equal(O.pageStatus(page(1, 91.7), 75), "reliable");      // stamp + skew
  assert.equal(O.pageStatus(page(1, 32.4, 337), 75), "unreliable"); // poor photo
  assert.equal(O.pageStatus(page(1, 96, 1, "Подпись"), 75), "empty");
  assert.equal(O.pageStatus(page(1, 0, 0, ""), 75), "empty");

  // 2. A three-page scan: two good pages, one poor photo → 2 pages charged.
  const stored = O.buildStoredOcr("tesseract 5.3", [page(1, 92.3), page(2, 94.9), page(3, 32.4, 337, "мусор 1[?]5 ООО")], 75);
  const parsed = O.ocrParseResult(stored);
  assert.equal(parsed.parseMethod, "ocr");
  assert.deepEqual(parsed.ocr, { pages: 3, reliable: 2, unreliable: 1, empty: 0, minConfidence: 75 });
  const q = quote("pdf", parsed);
  assert.deepEqual([q.kind, q.units, q.newUnits, q.amountRub], ["scan", 3, 2, 40]);
  assert.ok(PAGE_KINDS.has(q.kind));
  assert.match(describeQuote("акты.pdf", q), /скан, 3 страницы; распознано надёжно — 2 × 20,00 ₽ = 40,00 ₽; ещё 1 страница не распознана надёжно или пустая — не анализируется/);

  // 3. The model sees reliable pages only, the scan rules, and which pages were left out.
  const text = O.ocrTextForModel(stored);
  assert.match(text, /^\[Этот документ — скан или фотография/);
  assert.match(text, /только если совпадает с цифрой, уже имеющейся в базе 1С или в выписке/);
  assert.match(text, /пометкой \[\?\]/);
  assert.match(text, /--- Страница 1 из 3 \(распознана, уверенность 92%\) ---\nАкт № 1/);
  assert.match(text, /--- Страница 3 из 3: НЕ распознана надёжно \(уверенность 32%, порог 75%\)/);
  assert.doesNotMatch(text, /мусор/);                     // text of an unreliable page is never passed on

  // 4. Stored once, read back the same; the summary on the row keeps counts, not text.
  const back = O.parseStoredOcr(JSON.stringify(stored));
  assert.equal(O.ocrTextForModel(back), text);
  assert.throws(() => O.parseStoredOcr(JSON.stringify({ kind: "1c_odata" })));
  assert.equal(O.ocrSidecarPath("c/s/1_scan.pdf"), "c/s/1_scan.pdf.ocr.json");
  const summary = toParsedSummary(parsed) as any;
  assert.equal(summary.textContent, undefined);
  assert.equal(summary.parseMethod, "ocr");
  assert.equal(summary.ocr.reliable, 2);

  // 5. One photo, every page good / every page poor.
  const photo = O.ocrParseResult(O.buildStoredOcr("t", [page(1, 93)], 75));
  const qp = quote("image", photo);
  assert.deepEqual([qp.kind, qp.units, qp.newUnits, qp.amountRub], ["scan", 1, 1, 20]);
  assert.match(describeQuote("чек.jpg", qp), /скан, распознана 1 страница × 20,00 ₽ = 20,00 ₽/);
  const bad = O.ocrParseResult(O.buildStoredOcr("t", [page(1, 30), page(2, 41)], 75));
  const qb = quote("pdf", bad);
  assert.deepEqual([qb.kind, qb.newUnits, qb.amountRub], ["scan", 0, 0]);
  assert.match(describeQuote("фото.pdf", qb), /2 страницы — ни одна не распознана надёжно.*более чёткую копию/);
  const qb1 = quote("image", O.ocrParseResult(O.buildStoredOcr("t", [page(1, 30)], 75)));
  assert.match(describeQuote("фото.jpg", qb1), /«фото.jpg»: скан, страница не распознана надёжно \(низкое качество/);
  const q5 = quote("pdf", O.ocrParseResult(O.buildStoredOcr("t", [1, 2, 3, 4, 5, 6].map(n => page(n, n < 3 ? 30 : 90)), 75)));
  assert.match(describeQuote("пачка.pdf", q5), /6 страниц; распознано надёжно — 4 × 20,00 ₽ = 80,00 ₽; ещё 2 страницы не распознаны надёжно или пустые — не анализируются/);

  // 6. The same scan again costs nothing; the service down → 0 ₽, and the bytes are not "already read".
  assert.deepEqual([quote("pdf", parsed, { sameFileAlreadyAccepted: true }).kind,
                    quote("pdf", parsed, { sameFileAlreadyAccepted: true }).amountRub], ["duplicate", 0]);
  const scanPdf = { rowCount: 0, parseMethod: "pdf", likelyScanned: true, pageCount: 4, textContent: "[…]", parsedAt: "" };
  const qf = quote("pdf", scanPdf, { ocrUnavailable: true });
  assert.deepEqual([qf.kind, qf.units, qf.amountRub], ["ocr_failed", 4, 0]);
  assert.match(describeQuote("скан.pdf", qf), /распознавание сканов сейчас недоступно.*ещё раз позже/);
  assert.ok(NOT_READ_KINDS.has("ocr_failed") && NOT_READ_KINDS.has("unreadable") && !NOT_READ_KINDS.has("scan"));
  // Without the service configured nothing changes: unreadable, 0 ₽.
  assert.deepEqual([quote("pdf", scanPdf).kind, quote("image", null).kind], ["unreadable", "unreadable"]);

  console.log("✅ ocr: all checks passed (gate, per-page price, model text, stored result, wording)");

  // 7. Optional: real files through the running service.
  const files = process.argv.slice(2);
  if (files.length) {
    const { recognizeDocument } = await import("../lib/ocr-client");
    if (!process.env.OCR_URL) throw new Error("set OCR_URL and OCR_TOKEN to recognise files");
    for (const f of files) {
      const buf = readFileSync(f);
      const type = /\.pdf$/i.test(f) ? "application/pdf" : /\.png$/i.test(f) ? "image/png" : "image/jpeg";
      const t0 = Date.now();
      const r = await recognizeDocument(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, type, 1);
      const s = O.buildStoredOcr(r!.engine, r!.pages, O.minConfidenceFromEnv());
      const p = O.ocrParseResult(s);
      console.log(`${f}: ${Date.now() - t0} ms | ` +
        s.pages.map(x => `стр. ${x.page}: ${x.status} ${Math.round(x.confidence)}%${x.uncertainNumbers ? `, [?]×${x.uncertainNumbers}` : ""}${x.rotated ? `, повёрнута ${x.rotated}°` : ""}`).join("; "));
      console.log("   " + describeQuote(f.split("/").pop()!, quote(/\.pdf$/i.test(f) ? "pdf" : "image", p)));
    }
  }
}
main().catch(e => { console.error("❌ ocr test failed:", e); process.exit(1); });
