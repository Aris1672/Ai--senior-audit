/**
 * lib/ocr-client.ts — client for the text-recognition service (services/ocr, Tesseract).
 *
 * OCR_URL set   → scans and images are sent to the service at upload. If it
 *                 cannot be reached or answers badly, OcrUnavailableError is
 *                 thrown and the upload route treats the document as
 *                 unreadable (0 ₽, not analysed, the client is told to try
 *                 again later). Nothing from the file goes anywhere else.
 * OCR_URL unset → not used; images and scans stay unreadable, as before.
 * OCR_TOKEN     → shared secret, sent as X-OCR-Token.
 *
 * The request carries a REAL client document — OCR_URL must point only at our
 * own service on our own server (private Docker network address, or its own
 * HTTPS domain). Plain http:// to anything but a private address is refused.
 */
import type { OcrPage } from "./ocr";

export class OcrUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = "OcrUnavailableError"; }
}

export const OCR_ENABLED = !!process.env.OCR_URL;

export interface OcrResponse { engine: string; pages: OcrPage[]; }

/** Time allowed: a fixed part plus a few seconds per page (bad pages take ~5 s). */
function timeoutMs(pagesHint: number): number {
  return Math.min(15 * 60_000, 60_000 + Math.max(1, pagesHint) * 10_000);
}

/** Returns the recognised pages, or null when the service is not configured. */
export async function recognizeDocument(
  bytes: ArrayBuffer, mediaType: "application/pdf" | "image/jpeg" | "image/png", pagesHint = 1,
): Promise<OcrResponse | null> {
  const base = process.env.OCR_URL;
  if (!base) return null;
  try {
    if (!process.env.OCR_TOKEN) throw new Error("OCR_TOKEN is not set");
    const u = new URL(base);
    const privateHost = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname) || !u.hostname.includes(".");
    if (u.protocol !== "https:" && !privateHost) throw new Error("OCR_URL must be https:// unless it is a private address");
    const res = await fetch(`${base.replace(/\/+$/, "")}/recognize`, {
      method: "POST",
      headers: { "content-type": mediaType, "x-ocr-token": process.env.OCR_TOKEN },
      body: Buffer.from(bytes),
      signal: AbortSignal.timeout(timeoutMs(pagesHint)),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as Partial<OcrResponse>;
    if (!Array.isArray(data.pages) || data.pages.length === 0) throw new Error("unexpected response");
    const pages: OcrPage[] = data.pages.map((p, i) => ({
      page: Number(p?.page) || i + 1,
      text: typeof p?.text === "string" ? p.text : "",
      confidence: Number(p?.confidence) || 0,
      words: Number(p?.words) || 0,
      uncertainNumbers: Number(p?.uncertainNumbers) || 0,
      rotated: Number(p?.rotated) || 0,
    }));
    return { engine: typeof data.engine === "string" ? data.engine : "tesseract", pages };
  } catch (err) {
    // The error text never includes document content.
    throw new OcrUnavailableError(`text recognition service unavailable (${(err as Error)?.name ?? "error"}: ${(err as Error)?.message ?? err})`);
  }
}
