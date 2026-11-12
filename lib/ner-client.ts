/**
 * lib/ner-client.ts — client for the name-detection service (services/ner, Natasha).
 *
 * NER_URL set   → the service is REQUIRED: if it cannot be reached or answers
 *                 badly, PseudonymizationError is thrown and the audit is
 *                 blocked (decided Nov 12, 2026 — never fall back silently to
 *                 weaker protection).
 * NER_URL unset → the service is not used; names are found by the shape rules
 *                 in lib/pseudonymize.ts only. A warning is logged once.
 * NER_TOKEN     → optional shared secret, sent as X-NER-Token.
 *
 * The request carries REAL client text — it must only ever go to our own
 * server over the internal Docker network (http://<alias>:8000).
 */
import { PseudonymizationError } from "./pseudonymize";

export interface DetectedName { text: string; normal: string; }

const TIMEOUT_MS = 60_000;
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
    const res = await fetch(`${base.replace(/\/+$/, "")}/names`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.NER_TOKEN ? { "x-ner-token": process.env.NER_TOKEN } : {}) },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { names?: DetectedName[] };
    if (!Array.isArray(data.names)) throw new Error("unexpected response");
    return data.names.filter(n => n && typeof n.text === "string");
  } catch (err) {
    // The error text never includes request content.
    throw new PseudonymizationError(`name detection service unavailable (${(err as Error)?.name ?? "error"}: ${(err as Error)?.message ?? err})`);
  }
}
