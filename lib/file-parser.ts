/**
 * lib/file-parser.ts
 *
 * Content extraction for xlsx / xls / csv / xml / docx.
 * No HTTP calls, no Supabase — imported directly by API routes.
 * Runs inside Vercel (Node.js runtime).
 *
 * Dependencies:
 *   fflate  — for xlsx / docx (already installed)
 *   xlsx    — for legacy .xls binary format (npm install xlsx)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ParseMethod = "xlsx" | "xls" | "csv" | "xml" | "docx" | "doc" | "1c_txt" | "pdf" | "fallback";

export interface ParseResult {
  rowCount: number;
  parseMethod: ParseMethod;
  sheetName?: string;
  detectedColumns?: string[];
  xmlElement?: string;
  parsedAt: string;
  textContent?: string;
  // 1C bank statement extras
  c1AccountSummary?: C1AccountSummary;
  // PDF extra: true when pdf-parse found no embedded text layer (likely a
  // scanned document), signaling the caller should render pages as images
  // and route them through vision instead of relying on textContent.
  likelyScanned?: boolean;
}

/** A single rendered PDF page, ready to send to Claude's vision input. */
export interface PDFPageImage {
  pageNumber: number;
  mediaType: "image/png";
  base64: string;
}

/** Summary section from the СекцияРасчСчет block of a 1CClientBankExchange file. */
export interface C1AccountSummary {
  account: string;          // РасчСчет
  dateFrom: string;         // ДатаНачала
  dateTo: string;           // ДатаКонца
  openingBalance: number;   // НачальныйОстаток
  totalCredits: number;     // ВсегоПоступило
  totalDebits: number;      // ВсегоСписано
  closingBalance: number;   // КонечныйОстаток
}

/** Single payment document parsed from a 1CClientBankExchange file. */
export interface C1Transaction {
  docType: string;          // СекцияДокумент value
  number: string;           // Номер
  date: string;             // Дата (dd.mm.yyyy)
  amount: number;           // Сумма
  direction: "credit" | "debit";
  datePosted?: string;      // ДатаПоступило or ДатаСписано
  payerAccount?: string;    // ПлательщикСчет
  payerInn?: string;        // ПлательщикИНН
  payerName?: string;       // Плательщик1
  payerBank?: string;       // ПлательщикБанк1
  payerBik?: string;        // ПлательщикБИК
  receiverAccount?: string; // ПолучательСчет
  receiverInn?: string;     // ПолучательИНН
  receiverName?: string;    // Получатель1
  receiverBank?: string;    // ПолучательБанк1
  receiverBik?: string;     // ПолучательБИК
  purpose?: string;         // НазначениеПлатежа
  paymentType?: string;     // ВидОплаты
}

const MAX_CONTENT_CHARS = 50_000;

// ─── XML candidate tags (1C-first, then generic) ─────────────────────────────

const XML_TRANSACTION_TAGS = [
  "ХозяйственнаяОперация", "Документ", "Document",
  "transaction", "Transaction", "entry", "Entry",
  "record", "Record", "row", "Row",
];

// ─── CSV ──────────────────────────────────────────────────────────────────────

export function parseCSV(buffer: ArrayBuffer): ParseResult {
  const text  = new TextDecoder("utf-8").decode(buffer);
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);

  if (lines.length === 0) return { rowCount: 0, parseMethod: "csv", parsedAt: now() };

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers   = lines[0].split(delimiter).map(h => h.replace(/^"|"$/g, "").trim());

  const maxRows   = Math.min(lines.length, 501);
  const totalRows = Math.max(0, lines.length - 1);
  const textContent =
    lines.slice(0, maxRows).join("\n").slice(0, MAX_CONTENT_CHARS) +
    (totalRows > 500 ? `\n\n[Показаны первые 500 из ${totalRows} строк]` : "");

  return { rowCount: totalRows, parseMethod: "csv", detectedColumns: headers.slice(0, 10), textContent, parsedAt: now() };
}

// ─── XML ──────────────────────────────────────────────────────────────────────

export function parseXML(buffer: ArrayBuffer): ParseResult {
  const text = new TextDecoder("utf-8").decode(buffer);

  for (const tag of XML_TRANSACTION_TAGS) {
    const matches = text.match(new RegExp(`<${tag}[\\s>]`, "gi"));
    if (matches && matches.length > 0) {
      return { rowCount: matches.length, parseMethod: "xml", xmlElement: tag, textContent: text.slice(0, MAX_CONTENT_CHARS), parsedAt: now() };
    }
  }

  const allTags = text.match(/<([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9_]*)[\s>]/g) || [];
  const freq: Record<string, number> = {};
  for (const t of allTags) {
    const name = t.replace(/^</, "").replace(/[\s>].*/, "");
    freq[name]  = (freq[name] || 0) + 1;
  }
  const candidate = Object.entries(freq).sort((a, b) => b[1] - a[1]).find(([, c]) => c > 1);

  return { rowCount: candidate ? candidate[1] : 0, parseMethod: "xml", xmlElement: candidate?.[0], textContent: text.slice(0, MAX_CONTENT_CHARS), parsedAt: now() };
}

// ─── DOCX ─────────────────────────────────────────────────────────────────────

export async function parseDOCX(buffer: ArrayBuffer): Promise<ParseResult> {
  try {
    const fflate      = await import("fflate");
    const unzipped    = fflate.unzipSync(new Uint8Array(buffer));
    const docXmlBytes = unzipped["word/document.xml"];
    if (!docXmlBytes) throw new Error("word/document.xml not found");

    const docXml  = new TextDecoder("utf-8").decode(docXmlBytes);
    const runs    = docXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
    const rawText = runs
      .map(r => r.replace(/<w:t[^>]*>/, "").replace(/<\/w:t>/, ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const paragraphs  = (docXml.match(/<w:p[\s>]/g) || []).length;
    const textContent = rawText.slice(0, MAX_CONTENT_CHARS) +
      (rawText.length > MAX_CONTENT_CHARS ? "\n\n[Текст обрезан]" : "");

    return { rowCount: paragraphs, parseMethod: "docx", textContent, parsedAt: now() };
  } catch (err) {
    console.warn("[file-parser] DOCX parse failed:", err);
    return { rowCount: 0, parseMethod: "fallback", textContent: "[Не удалось прочитать содержимое файла DOCX]", parsedAt: now() };
  }
}

// ─── XLS (legacy binary format, pre-2007) ────────────────────────────────────
// Uses the 'xlsx' npm package which handles the proprietary BIFF binary format.
// We use it ONLY for .xls — .xlsx continues to use fflate (faster, no dep).

export async function parseXLS(buffer: ArrayBuffer): Promise<ParseResult> {
  try {
    const XLSX = await import("xlsx");

    const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
    if (workbook.SheetNames.length === 0) throw new Error("No sheets found in XLS");

    const ROWS_PER_SHEET_CAP = 500;
    let totalRowCount = 0;
    const sheetBlocks: string[] = [];
    const allHeaders: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      if (rows.length === 0) {
        sheetBlocks.push(`--- ЛИСТ: ${sheetName} (пусто) ---`);
        continue;
      }

      const headers  = (rows[0] as any[]).map(h => String(h ?? "").trim()).filter(Boolean);
      if (allHeaders.length === 0) allHeaders.push(...headers);

      const dataRows  = rows.slice(1);
      const totalRows = dataRows.length;
      totalRowCount  += totalRows;
      const maxRows   = Math.min(dataRows.length, ROWS_PER_SHEET_CAP);

      const lines = [
        headers.join(";"),
        ...dataRows.slice(0, maxRows).map(row =>
          (row as any[]).map(cell => String(cell ?? "").trim()).join(";")
        ),
      ];

      const sheetTruncationNote = totalRows > ROWS_PER_SHEET_CAP
        ? `\n[Лист "${sheetName}": показаны первые ${ROWS_PER_SHEET_CAP} из ${totalRows} строк]`
        : "";

      sheetBlocks.push(
        `--- ЛИСТ: ${sheetName} (${totalRows} строк) ---\n${lines.join("\n")}${sheetTruncationNote}`
      );
    }

    const multiSheetHeader = workbook.SheetNames.length > 1
      ? `[Файл содержит ${workbook.SheetNames.length} листов: ${workbook.SheetNames.join(", ")}]\n\n`
      : "";

    const textContent = (multiSheetHeader + sheetBlocks.join("\n\n")).slice(0, MAX_CONTENT_CHARS);

    return {
      rowCount:        totalRowCount,
      parseMethod:     "xls",
      sheetName:       workbook.SheetNames.join(", "),
      detectedColumns: allHeaders.slice(0, 10),
      textContent,
      parsedAt:        now(),
    };

  } catch (err) {
    console.warn("[file-parser] XLS parse failed:", err);
    return {
      rowCount:    Math.floor(buffer.byteLength / 200),
      parseMethod: "fallback",
      textContent: "[Не удалось прочитать содержимое файла XLS]",
      parsedAt:    now(),
    };
  }
}

// ─── XLSX ─────────────────────────────────────────────────────────────────────

export async function parseXLSX(buffer: ArrayBuffer): Promise<ParseResult> {
  try {
    const fflate   = await import("fflate");
    const unzipped = fflate.unzipSync(new Uint8Array(buffer));

    const sheetKeys = Object.keys(unzipped)
      .filter(k => /xl\/worksheets\/sheet\d+\.xml/.test(k))
      .sort((a, b) => {
        // Sort numerically by sheet number (sheet1, sheet2, ... sheet10), not lexically
        const numA = parseInt(a.match(/sheet(\d+)\.xml/)?.[1] || "0", 10);
        const numB = parseInt(b.match(/sheet(\d+)\.xml/)?.[1] || "0", 10);
        return numA - numB;
      });
    if (sheetKeys.length === 0) throw new Error("No worksheets found in XLSX");

    // ── Resolve real sheet names (e.g. "Без подтверждающих документов") ──────
    // workbook.xml lists <sheet name="..." r:id="rIdN"/> in display order.
    // workbook.xml.rels maps r:id -> worksheets/sheetK.xml.
    // Both are needed because sheet *display order* can differ from sheetK.xml
    // file numbering, and the real name is never in the worksheet file itself.
    const sheetNameByKey: Record<string, string> = {};
    try {
      if (unzipped["xl/workbook.xml"] && unzipped["xl/_rels/workbook.xml.rels"]) {
        const workbookXml = new TextDecoder("utf-8").decode(unzipped["xl/workbook.xml"]);
        const relsXml     = new TextDecoder("utf-8").decode(unzipped["xl/_rels/workbook.xml.rels"]);

        const relIdToTarget: Record<string, string> = {};
        const relMatches = relsXml.match(/<Relationship[^>]*\/>/g) || [];
        for (const rel of relMatches) {
          const id     = rel.match(/Id="([^"]+)"/)?.[1];
          const target = rel.match(/Target="([^"]+)"/)?.[1];
          if (id && target && target.includes("worksheets/")) {
            relIdToTarget[id] = `xl/${target.replace(/^\.?\/?/, "")}`;
          }
        }

        const sheetTags = workbookXml.match(/<sheet[^>]*\/>/g) || [];
        for (const tag of sheetTags) {
          const name = tag.match(/name="([^"]+)"/)?.[1];
          const rId  = tag.match(/r:id="([^"]+)"/)?.[1];
          if (name && rId && relIdToTarget[rId]) {
            sheetNameByKey[relIdToTarget[rId]] = name
              .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
          }
        }
      }
    } catch (nameErr) {
      console.warn("[file-parser] Could not resolve real sheet names, falling back to sheetN:", nameErr);
    }

    const sharedStrings: string[] = [];
    if (unzipped["xl/sharedStrings.xml"]) {
      const ssXml   = new TextDecoder("utf-8").decode(unzipped["xl/sharedStrings.xml"]);
      const matches = ssXml.match(/<t[^>]*>([^<]*)<\/t>/g) || [];
      for (const m of matches) {
        sharedStrings.push(m.replace(/<t[^>]*>/, "").replace(/<\/t>/, "").trim());
      }
    }

    // ── Parse every sheet, not just the first ─────────────────────────────────
    const ROWS_PER_SHEET_CAP = 500;
    let totalRowCount = 0;
    const sheetBlocks: string[] = [];
    const sheetNamesUsed: string[] = [];

    for (const sheetKey of sheetKeys) {
      const sheetName = sheetNameByKey[sheetKey]
        || sheetKey.replace("xl/worksheets/", "").replace(".xml", "");
      sheetNamesUsed.push(sheetName);

      const sheetXml = new TextDecoder("utf-8").decode(unzipped[sheetKey]);
      const rowMatches = sheetXml.match(/<row[\s\S]*?<\/row>/gi) || [];
      const sheetRowCount = Math.max(0, rowMatches.length - 1); // minus header row
      totalRowCount += sheetRowCount;

      const maxRows = Math.min(rowMatches.length, ROWS_PER_SHEET_CAP + 1);
      const csvLines: string[] = [];

      for (let i = 0; i < maxRows; i++) {
        const cells  = rowMatches[i].match(/<c[\s\S]*?<\/c>/gi) || [];
        const values: string[] = [];
        for (const cell of cells) {
          const typeMatch = cell.match(/\bt="([^"]+)"/);
          const valMatch  = cell.match(/<v>([^<]*)<\/v>/);
          const val       = valMatch ? valMatch[1] : "";
          values.push(typeMatch?.[1] === "s" ? (sharedStrings[parseInt(val, 10)] ?? "") : val);
        }
        csvLines.push(values.join(";"));
      }

      const sheetTruncationNote = sheetRowCount > ROWS_PER_SHEET_CAP
        ? `\n[Лист "${sheetName}": показаны первые ${ROWS_PER_SHEET_CAP} из ${sheetRowCount} строк]`
        : "";

      sheetBlocks.push(
        `--- ЛИСТ: ${sheetName} (${sheetRowCount} строк) ---\n${csvLines.join("\n")}${sheetTruncationNote}`
      );
    }

    const multiSheetHeader = sheetKeys.length > 1
      ? `[Файл содержит ${sheetKeys.length} листов: ${sheetNamesUsed.join(", ")}]\n\n`
      : "";

    const textContent = (multiSheetHeader + sheetBlocks.join("\n\n")).slice(0, MAX_CONTENT_CHARS);

    return {
      rowCount:        totalRowCount,
      parseMethod:     "xlsx",
      sheetName:       sheetNamesUsed.join(", "), // all sheet names, comma-separated
      detectedColumns: sharedStrings.slice(0, 10),
      textContent,
      parsedAt:        now(),
    };

  } catch (err) {
    console.warn("[file-parser] XLSX parse failed:", err);
    return { rowCount: Math.floor(buffer.byteLength / 200), parseMethod: "fallback", textContent: "[Не удалось прочитать содержимое файла XLSX]", parsedAt: now() };
  }
}


// ─── DOC (legacy binary Word format, pre-2007) ────────────────────────────────
// Uses 'mammoth' npm package to extract text from binary .doc files.
// Install with: npm install mammoth

export async function parseDOC(buffer: ArrayBuffer): Promise<ParseResult> {
  try {
    const mammoth = await import("mammoth");
    const result  = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
    const rawText = result.value.trim();

    // Count non-empty lines as "rows"
    const lines    = rawText.split(/\n/).filter(l => l.trim().length > 0);
    const rowCount = lines.length;

    const textContent = rawText.slice(0, MAX_CONTENT_CHARS) +
      (rawText.length > MAX_CONTENT_CHARS ? "\n\n[Текст обрезан]" : "");

    return { rowCount, parseMethod: "doc", textContent, parsedAt: now() };
  } catch (err) {
    console.warn("[file-parser] DOC parse failed:", err);
    return { rowCount: 0, parseMethod: "fallback", textContent: "[Не удалось прочитать содержимое файла DOC]", parsedAt: now() };
  }
}

// ─── PDF ──────────────────────────────────────────────────────────────────────
// Extracts text from text-based PDFs (invoices, contracts, statements, etc.)
// using pdf-parse. This does NOT do OCR — pdf-parse only reads PDFs that
// already have an embedded text layer. Scanned/photographed documents have
// no such layer; for those, set likelyScanned=true so the caller can render
// pages as images and route them through Claude's vision instead (see
// renderPDFPagesAsImages below).
export async function parsePDF(buffer: ArrayBuffer): Promise<ParseResult> {
  try {
    // Switched off pdf-parse@2.x entirely (was: PDFParse class from "pdf-parse").
    // Root cause wasn't fixable from our config: pdf-parse bundles its OWN
    // nested pdfjs-dist copy, and Next/Vercel's file-tracing does not reliably
    // follow nested node_modules inside an externalized package — so its
    // worker .mjs file kept getting dropped from the deployed bundle no matter
    // what serverExternalPackages said, throwing "Setting up fake worker failed"
    // on every single PDF. Fix: use the top-level pdfjs-dist directly for text
    // extraction too — it's the same package already used successfully below
    // in renderPDFPagesAsImages, already externalized correctly, and workerSrc
    // is already disabled there. One less dependency, no nested-copy problem.
    // pdfjs-dist v4+ only ships the .mjs legacy build — the CJS legacy build
    // doesn't exist (confirmed by a failed Vercel build). Reverting to .mjs.
    // workerSrc history: "" was falsy (treated as unset) → require.resolve()
    // produced a value pdfjs-dist rejected as "Invalid workerSrc type" under
    // Turbopack. The actual correct pattern is `new URL(spec, import.meta.url)`
    // — bundlers (Turbopack included) specifically recognize this exact syntax
    // as an asset reference and bundle/copy the target file, which plain
    // require.resolve()/string paths don't trigger.
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.mjs",
      import.meta.url
    ).toString();

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      isEvalSupported: false,
    });
    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages || 1;

    let rawText = "";
    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item: any) => item.str ?? "").join(" ");
      rawText += pageText + "\n";
    }
    rawText = rawText.trim();

    // Heuristic: near-zero text relative to page count means there's
    // essentially no real text layer (a few stray characters from a stamp
    // or watermark shouldn't count as "has text"). ~20 chars/page is a
    // conservative floor — genuine text documents are always far above this.
    const avgCharsPerPage = rawText.length / numPages;
    const likelyScanned   = avgCharsPerPage < 20;

    if (likelyScanned) {
      return {
        rowCount:      0,
        parseMethod:   "pdf",
        likelyScanned: true,
        textContent:   "[PDF не содержит извлекаемого текста — вероятно, это скан. Страницы будут переданы модели как изображения.]",
        detectedColumns: [`Страниц: ${numPages}`],
        parsedAt:      now(),
      };
    }

    // Count non-empty lines as a rough "row" proxy, consistent with parseDOC
    const lines    = rawText.split(/\n/).filter(l => l.trim().length > 0);
    const rowCount = lines.length;

    const truncated    = rawText.length > MAX_CONTENT_CHARS;
    const textContent  = rawText.slice(0, MAX_CONTENT_CHARS) +
      (truncated ? "\n\n[Текст обрезан]" : "");

    return {
      rowCount,
      parseMethod: "pdf",
      detectedColumns: [`Страниц: ${numPages}`],
      textContent,
      parsedAt: now(),
    };
  } catch (err) {
    // Logged with full detail — visible now, not silently swallowed.
    console.error("[file-parser] PDF parse failed:", err);
    return {
      rowCount:    0,
      parseMethod: "fallback",
      textContent: "[Не удалось прочитать содержимое файла PDF]",
      parsedAt:    now(),
    };
  }
}

// ─── Scanned PDF → images (vision fallback) ───────────────────────────────────
// Renders PDF pages to PNG images so they can be sent through Claude's native
// vision instead of text extraction. Used when parsePDF() sets
// likelyScanned=true. Uses pdfjs-dist for rendering, paired with
// @napi-rs/canvas (prebuilt binaries, no native build step) instead of the
// standard "canvas" package, which requires compiling Cairo and is fragile
// on Vercel's serverless build environment.
//
// Dependencies required (add to package.json):
//   "pdfjs-dist": "^4.x"
//   "@napi-rs/canvas": "^0.1.x"
export async function renderPDFPagesAsImages(
  buffer: ArrayBuffer,
  maxPages = 10
): Promise<PDFPageImage[]> {
  try {
    // Use the legacy build — it doesn't assume a DOM/Worker environment,
    // which matters since this runs in a Vercel Node.js serverless function,
    // not a browser.
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { createCanvas } = await import("@napi-rs/canvas");

    // No web worker available server-side — run rendering on the main thread.
    pdfjsLib.GlobalWorkerOptions.workerSrc = "";

    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;

    const pageCount = Math.min(pdf.numPages, maxPages);
    const images: PDFPageImage[] = [];

    if (pdf.numPages > maxPages) {
      console.warn(`[file-parser] PDF has ${pdf.numPages} pages, rendering only first ${maxPages} for vision`);
    }

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      // scale 1.5 balances legibility (small print, stamps, signatures)
      // against image size / token cost — higher scale = sharper but pricier.
      const viewport = page.getViewport({ scale: 1.5 });

      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx    = canvas.getContext("2d");

      await page.render({ canvasContext: ctx as any, viewport }).promise;

      const pngBuffer = canvas.toBuffer("image/png");
      images.push({
        pageNumber: i,
        mediaType:  "image/png",
        base64:     pngBuffer.toString("base64"),
      });
    }

    return images;
  } catch (err) {
    console.error("[file-parser] renderPDFPagesAsImages failed:", err);
    return [];
  }
}


// ─── 1C Client Bank Exchange (*.txt) ─────────────────────────────────────────
// Handles the standard Russian bank statement export format used by 1C
// accounting software. Files begin with "1CClientBankExchange" and are
// encoded in Windows-1251 (CP1251). The format is line-oriented key=value
// with section markers СекцияДокумент / КонецДокумента.

/**
 * Decode a Windows-1251 (CP1251) ArrayBuffer to a UTF-16 JS string.
 * Hard-coded CP1251→Unicode table — no TextDecoder encoding support needed.
 * Zero dependencies, safe across all runtimes (Vercel Node, Edge, etc.).
 */
function decodeWindows1251(buffer: ArrayBuffer): string {
  // CP1251 → Unicode codepoints for bytes 0x80–0xFF
  const HIGH: number[] = [
    0x0402,0x0403,0x201A,0x0453,0x201E,0x2026,0x2020,0x2021,
    0x20AC,0x2030,0x0409,0x2039,0x040A,0x040C,0x040B,0x040F,
    0x0452,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,
    0xFFFD,0x2122,0x0459,0x203A,0x045A,0x045C,0x045B,0x045F,
    0x00A0,0x040E,0x045E,0x0408,0x00A4,0x0490,0x00A6,0x00A7,
    0x0401,0x00A9,0x0404,0x00AB,0x00AC,0x00AD,0x00AE,0x0407,
    0x00B0,0x00B1,0x0406,0x0456,0x0491,0x00B5,0x00B6,0x00B7,
    0x0451,0x2116,0x0454,0x00BB,0x0458,0x0405,0x0455,0x0457,
    // Cyrillic А–Я (0xC0–0xDF) then а–я (0xE0–0xFF)
    0x0410,0x0411,0x0412,0x0413,0x0414,0x0415,0x0416,0x0417,
    0x0418,0x0419,0x041A,0x041B,0x041C,0x041D,0x041E,0x041F,
    0x0420,0x0421,0x0422,0x0423,0x0424,0x0425,0x0426,0x0427,
    0x0428,0x0429,0x042A,0x042B,0x042C,0x042D,0x042E,0x042F,
    0x0430,0x0431,0x0432,0x0433,0x0434,0x0435,0x0436,0x0437,
    0x0438,0x0439,0x043A,0x043B,0x043C,0x043D,0x043E,0x043F,
    0x0440,0x0441,0x0442,0x0443,0x0444,0x0445,0x0446,0x0447,
    0x0448,0x0449,0x044A,0x044B,0x044C,0x044D,0x044E,0x044F,
  ];
  const bytes  = new Uint8Array(buffer);
  const chars: string[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    chars[i] = b < 0x80 ? String.fromCharCode(b) : String.fromCharCode(HIGH[b - 0x80]);
  }
  return chars.join("");
}

/**
 * Sniff the first 64 bytes to detect a 1CClientBankExchange file.
 * Exported so upload/parse routes can call it without parsing the whole file.
 */
export function is1CClientBankExchange(buffer: ArrayBuffer): boolean {
  const MAGIC = "1CClientBankExchange";
  const head  = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 64));
  // Magic string is pure ASCII so byte values match char codes directly.
  const headStr = Array.from(head, b => String.fromCharCode(b)).join("");
  return headStr.startsWith(MAGIC);
}

/** Map the raw key=value record for one document block to a typed C1Transaction. */
function buildC1Transaction(raw: Record<string, string>): C1Transaction {
  const creditDate = (raw["ДатаПоступило"] ?? "").trim();
  const debitDate  = (raw["ДатаСписано"]   ?? "").trim();
  const direction: "credit" | "debit" = creditDate ? "credit" : "debit";
  return {
    docType:         raw["_docType"]           ?? "",
    number:          raw["Номер"]              ?? "",
    date:            raw["Дата"]               ?? "",
    amount:          parseFloat(raw["Сумма"]   ?? "0") || 0,
    direction,
    datePosted:      direction === "credit" ? creditDate : debitDate || undefined,
    payerAccount:    raw["ПлательщикСчет"]     || undefined,
    payerInn:        raw["ПлательщикИНН"]      || undefined,
    payerName:       raw["Плательщик1"]        || undefined,
    payerBank:       raw["ПлательщикБанк1"]    || undefined,
    payerBik:        raw["ПлательщикБИК"]      || undefined,
    receiverAccount: raw["ПолучательСчет"]     || undefined,
    receiverInn:     raw["ПолучательИНН"]      || undefined,
    receiverName:    raw["Получатель1"]        || undefined,
    receiverBank:    raw["ПолучательБанк1"]    || undefined,
    receiverBik:     raw["ПолучательБИК"]      || undefined,
    purpose:         raw["НазначениеПлатежа"]  || undefined,
    paymentType:     raw["ВидОплаты"]          || undefined,
  };
}

export function parse1CTxt(buffer: ArrayBuffer): ParseResult {
  const raw   = decodeWindows1251(buffer);
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  const kv = (line: string): [string, string] | undefined => {
    const idx = line.indexOf("=");
    if (idx === -1) return undefined;
    return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
  };

  // ── Header + account summary (СекцияРасчСчет) ───────────────────────────
  const header: Record<string, string>    = {};
  const accBuf: Record<string, string>    = {};
  let   inAccountSection                  = false;
  let   accountSummary: C1AccountSummary | undefined;

  // ── Transaction parsing (СекцияДокумент … КонецДокумента) ───────────────
  const transactions: C1Transaction[]     = [];
  let   current: Record<string, string> | null = null;

  for (const line of lines) {
    const t = line.trim();

    if (t === "СекцияРасчСчет")  { inAccountSection = true;  continue; }
    if (t === "КонецРасчСчет")   {
      inAccountSection = false;
      accountSummary = {
        account:        accBuf["РасчСчет"]           ?? header["РасчСчет"] ?? "",
        dateFrom:       accBuf["ДатаНачала"]          ?? header["ДатаНачала"] ?? "",
        dateTo:         accBuf["ДатаКонца"]           ?? header["ДатаКонца"] ?? "",
        openingBalance: parseFloat(accBuf["НачальныйОстаток"] ?? "0") || 0,
        totalCredits:   parseFloat(accBuf["ВсегоПоступило"]   ?? "0") || 0,
        totalDebits:    parseFloat(accBuf["ВсегоСписано"]      ?? "0") || 0,
        closingBalance: parseFloat(accBuf["КонечныйОстаток"]   ?? "0") || 0,
      };
      continue;
    }

    if (t.startsWith("СекцияДокумент=")) {
      current = { _docType: t.slice("СекцияДокумент=".length).trim() };
      continue;
    }
    if (t === "КонецДокумента") {
      if (current) transactions.push(buildC1Transaction(current));
      current = null;
      continue;
    }

    const pair = kv(t);
    if (!pair) continue;
    const [key, val] = pair;

    if      (current)          current[key] = val;
    else if (inAccountSection) accBuf[key]  = val;
    else                       header[key]  = val;
  }

  // ── Build CSV-style textContent for AI consumption ───────────────────────
  const CSV_HEADERS = [
    "direction","date","amount","docType","number",
    "payerName","payerInn","receiverName","receiverInn","purpose",
  ].join(";");

  const csvRows = transactions.map(tx =>
    [
      tx.direction,
      tx.date,
      tx.amount,
      tx.docType,
      tx.number,
      tx.payerName    ?? "",
      tx.payerInn     ?? "",
      tx.receiverName ?? "",
      tx.receiverInn  ?? "",
      (tx.purpose     ?? "").replace(/;/g, ","),
    ].join(";")
  );

  const summaryLines: string[] = accountSummary ? [
    `# 1C Bank Statement | Account: ${accountSummary.account}`,
    `# Period: ${accountSummary.dateFrom} – ${accountSummary.dateTo}`,
    `# Opening: ${accountSummary.openingBalance} | Credits: +${accountSummary.totalCredits} | Debits: -${accountSummary.totalDebits} | Closing: ${accountSummary.closingBalance}`,
    "",
  ] : [];

  const maxRows   = Math.min(csvRows.length, 500);
  const truncNote = transactions.length > 500
    ? `\n[Показаны первые 500 из ${transactions.length} транзакций]`
    : "";

  const textContent = [
    ...summaryLines,
    CSV_HEADERS,
    ...csvRows.slice(0, maxRows),
  ].join("\n").slice(0, MAX_CONTENT_CHARS) + truncNote;

  return {
    rowCount:         transactions.length,
    parseMethod:      "1c_txt",
    textContent,
    c1AccountSummary: accountSummary,
    parsedAt:         now(),
  };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function parseFile(
  buffer: ArrayBuffer,
  fileType: "xlsx" | "xls" | "csv" | "xml" | "docx" | "doc" | "1c_txt" | "pdf"
): Promise<ParseResult> {
  if (fileType === "csv")    return parseCSV(buffer);
  if (fileType === "xml")    return parseXML(buffer);
  if (fileType === "docx")   return parseDOCX(buffer);
  if (fileType === "xls")    return parseXLS(buffer);
  if (fileType === "doc")    return parseDOC(buffer);
  if (fileType === "1c_txt") return parse1CTxt(buffer);
  if (fileType === "pdf")    return parsePDF(buffer);
  return parseXLSX(buffer);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now() { return new Date().toISOString(); }
