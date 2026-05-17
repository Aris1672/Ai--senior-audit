/**
 * lib/file-parser.ts
 *
 * Content extraction for xlsx / csv / xml / docx.
 * No HTTP calls, no Supabase — imported directly by API routes.
 * Runs inside Vercel (Node.js runtime).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ParseMethod = "xlsx" | "csv" | "xml" | "docx" | "fallback";

export interface ParseResult {
  rowCount: number;
  parseMethod: ParseMethod;
  sheetName?: string;
  detectedColumns?: string[];
  xmlElement?: string;
  parsedAt: string;
  textContent?: string;
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

  const maxRows    = Math.min(lines.length, 501);
  const totalRows  = Math.max(0, lines.length - 1);
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
// A .docx is a ZIP containing word/document.xml — we unzip with fflate
// and strip XML tags to get plain text.

export async function parseDOCX(buffer: ArrayBuffer): Promise<ParseResult> {
  try {
    const fflate   = await import("fflate");
    const unzipped = fflate.unzipSync(new Uint8Array(buffer));

    const docXmlBytes = unzipped["word/document.xml"];
    if (!docXmlBytes) throw new Error("word/document.xml not found in docx");

    const docXml = new TextDecoder("utf-8").decode(docXmlBytes);

    // Extract text from <w:t> elements (Word text runs)
    const runs    = docXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
    const rawText = runs
      .map(r => r.replace(/<w:t[^>]*>/, "").replace(/<\/w:t>/, ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    // Count paragraphs as "rows"
    const paragraphs = (docXml.match(/<w:p[\s>]/g) || []).length;

    const textContent = rawText.slice(0, MAX_CONTENT_CHARS) +
      (rawText.length > MAX_CONTENT_CHARS ? "\n\n[Текст обрезан — показаны первые 50 000 символов]" : "");

    return { rowCount: paragraphs, parseMethod: "docx", textContent, parsedAt: now() };

  } catch (err) {
    console.warn("[file-parser] DOCX parse failed:", err);
    return { rowCount: 0, parseMethod: "fallback", textContent: "[Не удалось прочитать содержимое файла DOCX]", parsedAt: now() };
  }
}

// ─── XLSX ─────────────────────────────────────────────────────────────────────

export async function parseXLSX(buffer: ArrayBuffer): Promise<ParseResult> {
  try {
    const fflate   = await import("fflate");
    const unzipped = fflate.unzipSync(new Uint8Array(buffer));

    const sheetKeys = Object.keys(unzipped).filter(k => /xl\/worksheets\/sheet\d+\.xml/.test(k));
    if (sheetKeys.length === 0) throw new Error("No worksheets found in XLSX");

    const sheetKey  = sheetKeys.find(k => k === "xl/worksheets/sheet1.xml") || sheetKeys[0];
    const sheetName = sheetKey.replace("xl/worksheets/", "").replace(".xml", "");
    const sheetXml  = new TextDecoder("utf-8").decode(unzipped[sheetKey]);
    const rowCount  = Math.max(0, (sheetXml.match(/<row[\s>]/gi) || []).length - 1);

    // Build shared strings lookup
    const sharedStrings: string[] = [];
    if (unzipped["xl/sharedStrings.xml"]) {
      const ssXml   = new TextDecoder("utf-8").decode(unzipped["xl/sharedStrings.xml"]);
      const matches = ssXml.match(/<t[^>]*>([^<]*)<\/t>/g) || [];
      for (const m of matches) {
        sharedStrings.push(m.replace(/<t[^>]*>/, "").replace(/<\/t>/, "").trim());
      }
    }

    // Convert rows → CSV-like text
    const rowMatches = sheetXml.match(/<row[\s\S]*?<\/row>/gi) || [];
    const maxRows    = Math.min(rowMatches.length, 501);
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

    const truncationNote = rowCount > 500 ? `\n[Показаны первые 500 из ${rowCount} строк]` : "";
    const textContent    = csvLines.join("\n").slice(0, MAX_CONTENT_CHARS) + truncationNote;

    return { rowCount, parseMethod: "xlsx", sheetName, detectedColumns: sharedStrings.slice(0, 10), textContent, parsedAt: now() };

  } catch (err) {
    console.warn("[file-parser] XLSX parse failed:", err);
    return { rowCount: Math.floor(buffer.byteLength / 200), parseMethod: "fallback", textContent: "[Не удалось прочитать содержимое файла XLSX]", parsedAt: now() };
  }
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function parseFile(
  buffer: ArrayBuffer,
  fileType: "xlsx" | "csv" | "xml" | "docx"
): Promise<ParseResult> {
  if (fileType === "csv")  return parseCSV(buffer);
  if (fileType === "xml")  return parseXML(buffer);
  if (fileType === "docx") return parseDOCX(buffer);
  return parseXLSX(buffer);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now() { return new Date().toISOString(); }
