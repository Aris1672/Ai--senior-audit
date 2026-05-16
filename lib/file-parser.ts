/**
 * lib/file-parser.ts
 *
 * Row-counting + content extraction for xlsx / csv / xml.
 * No HTTP calls, no Supabase — imported directly by API routes.
 * Runs inside Vercel (Node.js runtime).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ParseMethod = "xlsx" | "csv" | "xml" | "fallback";

export interface ParseResult {
  rowCount: number;
  parseMethod: ParseMethod;
  sheetName?: string;         // xlsx: sheet that was counted
  detectedColumns?: string[]; // csv / xlsx: first-row header names (max 10)
  xmlElement?: string;        // xml: element tag that was counted
  parsedAt: string;           // ISO timestamp
  // NEW: text content for Claude to read (capped at ~50k chars)
  textContent?: string;
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

const MAX_CONTENT_CHARS = 50_000; // ~12k tokens — safe for Haiku context

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

  // Build readable text: header + first 500 rows max
  const maxRows = Math.min(lines.length, 501); // header + 500 data rows
  const contentLines = lines.slice(0, maxRows);
  const textContent = contentLines.join("\n").slice(0, MAX_CONTENT_CHARS);

  const totalRows = Math.max(0, lines.length - 1);
  const truncated = totalRows > 500
    ? `\n\n[Показаны первые 500 из ${totalRows} строк]`
    : "";

  return {
    rowCount: totalRows,
    parseMethod: "csv",
    detectedColumns: headers.slice(0, 10),
    textContent: textContent + truncated,
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
        // Pass raw XML truncated — Claude can read XML structure
        textContent: text.slice(0, MAX_CONTENT_CHARS),
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

  const candidate = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .find(([, count]) => count > 1);

  return {
    rowCount: candidate ? candidate[1] : 0,
    parseMethod: "xml",
    xmlElement: candidate?.[0],
    textContent: text.slice(0, MAX_CONTENT_CHARS),
    parsedAt: now(),
  };
}

// ─── XLSX ─────────────────────────────────────────────────────────────────────

export async function parseXLSX(buffer: ArrayBuffer): Promise<ParseResult> {
  try {
    const fflate = await import("fflate");
    const unzipped = fflate.unzipSync(new Uint8Array(buffer));

    // Find worksheets
    const sheetKeys = Object.keys(unzipped).filter((k) =>
      /xl\/worksheets\/sheet\d+\.xml/.test(k)
    );
    if (sheetKeys.length === 0) throw new Error("No worksheets found in XLSX");

    const sheetKey =
      sheetKeys.find((k) => k === "xl/worksheets/sheet1.xml") || sheetKeys[0];
    const sheetName = sheetKey
      .replace("xl/worksheets/", "")
      .replace(".xml", "");

    const sheetXml = new TextDecoder("utf-8").decode(unzipped[sheetKey]);

    // Count rows
    const rowCount = Math.max(
      0,
      (sheetXml.match(/<row[\s>]/gi) || []).length - 1
    );

    // ── Build shared strings lookup ──────────────────────────────────────────
    const sharedStrings: string[] = [];
    if (unzipped["xl/sharedStrings.xml"]) {
      const ssXml = new TextDecoder("utf-8").decode(
        unzipped["xl/sharedStrings.xml"]
      );
      // Extract all <t> values in order
      const matches = ssXml.match(/<t[^>]*>([^<]*)<\/t>/g) || [];
      for (const m of matches) {
        sharedStrings.push(
          m.replace(/<t[^>]*>/, "").replace(/<\/t>/, "").trim()
        );
      }
    }

    const detectedColumns = sharedStrings.slice(0, 10);

    // ── Convert rows → CSV-like text for Claude ──────────────────────────────
    const rowMatches = sheetXml.match(/<row[\s\S]*?<\/row>/gi) || [];
    const maxRows = Math.min(rowMatches.length, 501); // header + 500 rows
    const csvLines: string[] = [];

    for (let i = 0; i < maxRows; i++) {
      const rowXml = rowMatches[i];
      // Each cell: <c r="A1" t="s"><v>0</v></c>  or  <c r="B2"><v>123.45</v></c>
      const cells = rowXml.match(/<c[\s\S]*?<\/c>/gi) || [];
      const values: string[] = [];

      for (const cell of cells) {
        const typeMatch = cell.match(/\bt="([^"]+)"/);
        const valMatch  = cell.match(/<v>([^<]*)<\/v>/);
        const val       = valMatch ? valMatch[1] : "";

        if (typeMatch && typeMatch[1] === "s") {
          // Shared string index
          const idx = parseInt(val, 10);
          values.push(sharedStrings[idx] ?? "");
        } else {
          values.push(val);
        }
      }

      csvLines.push(values.join(";"));
    }

    const truncationNote =
      rowCount > 500 ? `\n[Показаны первые 500 из ${rowCount} строк]` : "";

    const textContent =
      csvLines.join("\n").slice(0, MAX_CONTENT_CHARS) + truncationNote;

    return {
      rowCount,
      parseMethod: "xlsx",
      sheetName,
      detectedColumns,
      textContent,
      parsedAt: now(),
    };
  } catch (err) {
    console.warn("[file-parser] XLSX parse failed, using size estimate:", err);
    return {
      rowCount: Math.floor(buffer.byteLength / 200),
      parseMethod: "fallback",
      textContent: "[Не удалось прочитать содержимое файла XLSX]",
      parsedAt: now(),
    };
  }
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function parseFile(
  buffer: ArrayBuffer,
  fileType: "xlsx" | "csv" | "xml"
): Promise<ParseResult> {
  if (fileType === "csv") return parseCSV(buffer);
  if (fileType === "xml") return parseXML(buffer);
  return parseXLSX(buffer);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}
