/**
 * lib/ner-client.ts — client for the name-detection service (services/ner, Natasha).
 *
 * NER_URL set   → the service is REQUIRED: if it cannot be reached or answers
 *                 badly, PseudonymizationError is thrown and the audit is
 *                 blocked (decided Nov 12, 2026 — never fall back silently to
 *                 weaker protection).
 * NER_URL unset → the service is not used; names are found by the shape rules
 *                 in lib/pseudonymize.ts only. A warning is logged once.
 * NER_TOKEN     → shared secret, sent as X-NER-Token. Required together with
 *                 NER_URL (the service rejects calls without it).
 *
 * The request carries REAL client text — NER_URL must point only at our own
 * service on our own server: either a private Docker network address, or the
 * service's own HTTPS domain on the Coolify server (see services/ner/README.md).
 * Plain http:// to anything but a private address is refused.
 */
import { PseudonymizationError } from "./pseudonymize";

export interface DetectedName { text: string; normal: string; }

const TIMEOUT_MS  = 120_000;  // per piece
const PIECE_CHARS = 150_000;

/** Cuts texts into pieces of at most PIECE_CHARS, at line ends where possible. */
export function splitForNer(texts: string[]): string[] {
  const pieces: string[] = [];
  for (const text of texts) {
    let rest = text;
    while (rest.length > PIECE_CHARS) {
      let cut = rest.lastIndexOf("\n", PIECE_CHARS);
      if (cut < PIECE_CHARS / 2) cut = rest.lastIndexOf(" ", PIECE_CHARS);
      if (cut < PIECE_CHARS / 2) cut = PIECE_CHARS;
      pieces.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    if (rest.trim()) pieces.push(rest);
  }
  return pieces;
}
let warned = false;

export const NER_ENABLED = !!process.env.NER_URL;

/** Returns the names found, or null when the service is not configured. Throws when it is configured but unavailable. */
export async function detectNames(texts: string[]): Promise<DetectedName[] | null> {
  const base = process.env.NER_URL;
  if (!base) {
    if (!warned) { warned = true; console.warn("[ner] NER_URL is not set — names are detected by shape rules only"); }
    return null;
  }
  try {
    if (!process.env.NER_TOKEN) throw new Error("NER_TOKEN is not set");
    const u = new URL(base);
    const privateHost = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname) || !u.hostname.includes(".");
    if (u.protocol !== "https:" && !privateHost) throw new Error("NER_URL must be https:// unless it is a private address");
    // Large documents go in pieces (cut at line ends), one call after another:
    // a year of operations in a single call could outlast the timeout, and a
    // timeout blocks the audit.
    const found = new Map<string, DetectedName>();
    for (const piece of splitForNer(texts)) {
      const res = await fetch(`${base.replace(/\/+$/, "")}/names`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ner-token": process.env.NER_TOKEN },
        body: JSON.stringify({ texts: [piece] }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { names?: DetectedName[] };
      if (!Array.isArray(data.names)) throw new Error("unexpected response");
      for (const n of data.names) {
        if (n && typeof n.text === "string" && !found.has(n.text)) found.set(n.text, n);
      }
    }
    return [...found.values()];
  } catch (err) {
    // The error text never includes request content.
    throw new PseudonymizationError(`name detection service unavailable (${(err as Error)?.name ?? "error"}: ${(err as Error)?.message ?? err})`);
  }
}
