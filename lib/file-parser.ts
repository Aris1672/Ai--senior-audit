/**
 * lib/file-parser.ts
 *
 * Pure row-counting functions for xlsx / csv / xml.
 * No HTTP calls, no Supabase — imported directly by API routes.
 * Runs inside Vercel (Node.js runtime).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ParseMethod = "xlsx" | "csv" | "xml" | "fallback";

export interface ParseResult {
  rowCount: number;
  parseMethod: ParseMethod;
  sheetName?: string;        // xlsx: sheet that was counted
  detectedColumns?: string[]; // csv / xlsx: first-row header names (max 10)
  xmlElement?: string;       // xml: element tag that was counted
  parsedAt: string;          // ISO timestamp
}

// ─── XML candidate tags (1C-first, then generic) ─────────────────────────────

const XML_TRANSACTION_TAGS = [
  "ХозяйственнаяОперация",
  "Документ",
  "Document",
  "transaction",
  "Transaction",
  "entry",
  "Entry",
  "record",
  "Record",
  "row",
  "Row",
];

// ─── CSV ──────────────────────────────────────────────────────────────────────

export function parseCSV(buffer: ArrayBuffer): ParseResult {
  const text = new TextDecoder("utf-8").decode(buffer);
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { rowCount: 0, parseMethod: "csv", parsedAt: now() };
  }

  // 1C exports use semicolons; standard CSV uses commas
  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0]
    .split(delimiter)
    .map((h) => h.replace(/^"|"$/g, "").trim());

  return {
    rowCount: Math.max(0, lines.length - 1), // subtract header row
    parseMethod: "csv",
    detectedColumns: headers.slice(0, 10),
    parsedAt: now(),
  };
}

// ─── XML ──────────────────────────────────────────────────────────────────────

export function parseXML(buffer: ArrayBuffer): ParseResult {
  const text = new TextDecoder("utf-8").decode(buffer);

  // Try known 1C / generic transaction tags first
  for (const tag of XML_TRANSACTION_TAGS) {
    const matches = text.match(new RegExp(`<${tag}[\\s>]`, "gi"));
    if (matches && matches.length > 0) {
      return {
        rowCount: matches.length,
        parseMethod: "xml",
        xmlElement: tag,
        parsedAt: now(),
      };
    }
  }

  // Fallback: find the most-frequent element (likely the record element)
  const allTags =
    text.match(/<([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9_]*)[\s>]/g) || [];

  const freq: Record<string, number> = {};
  for (const t of allTags) {
    const name = t.replace(/^</, "").replace(/[\s>].*/, "");
    freq[name] = (freq[name] || 0) + 1;
  }

  // Root element appears once — skip it; the next most-frequent is the record
  const candidate = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .find(([, count]) => count > 1);

  return {
    rowCount: candidate ? candidate[1] : 0,
    parseMethod: "xml",
    xmlElement: candidate?.[0],
    parsedAt: now(),
  };
}

// ─── XLSX ─────────────────────────────────────────────────────────────────────

export async function parseXLSX(buffer: ArrayBuffer): Promise<ParseResult> {
  try {
    // fflate is a zero-dep pure-JS zip library.
    // Install with: npm install fflate
    const fflate = await import("fflate");
    const unzipped = fflate.unzipSync(new Uint8Array(buffer));

    // Find worksheets
    const sheetKeys = Object.keys(unzipped).filter((k) =>
      /xl\/worksheets\/sheet\d+\.xml/.test(k)
    );
    if (sheetKeys.length === 0) throw new Error("No worksheets found in XLSX");

    // Prefer sheet1
    const sheetKey =
      sheetKeys.find((k) => k === "xl/worksheets/sheet1.xml") || sheetKeys[0];
    const sheetName = sheetKey
      .replace("xl/worksheets/", "")
      .replace(".xml", "");

    const sheetXml = new TextDecoder("utf-8").decode(unzipped[sheetKey]);

    // Each <row …> element = one spreadsheet row; subtract 1 for header
    const rowCount = Math.max(
      0,
      (sheetXml.match(/<row[\s>]/gi) || []).length - 1
    );

    // Column names from shared strings table
    let detectedColumns: string[] | undefined;
    if (unzipped["xl/sharedStrings.xml"]) {
      const ssXml = new TextDecoder("utf-8").decode(
        unzipped["xl/sharedStrings.xml"]
      );
      detectedColumns = (ssXml.match(/<t[^>]*>([^<]+)<\/t>/g) || [])
        .map((m) => m.replace(/<t[^>]*>/, "").replace(/<\/t>/, "").trim())
        .filter(Boolean)
        .slice(0, 10);
    }

    return { rowCount, parseMethod: "xlsx", sheetName, detectedColumns, parsedAt: now() };
  } catch (err) {
    console.warn("[file-parser] XLSX parse failed, using size estimate:", err);
    // ~200 bytes per row is a reasonable xlsx estimate
    return {
      rowCount: Math.floor(buffer.byteLength / 200),
      parseMethod: "fallback",
      parsedAt: now(),
    };
  }
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function parseFile(
  buffer: ArrayBuffer,
  fileType: "xlsx" | "csv" | "xml"
): Promise<ParseResult> {
  if (fileType === "csv")  return parseCSV(buffer);
  if (fileType === "xml")  return parseXML(buffer);
  return parseXLSX(buffer);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}
