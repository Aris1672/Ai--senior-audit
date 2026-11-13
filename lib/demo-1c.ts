/**
 * lib/demo-1c.ts — the demo 1C base, switched on and off by an admin.
 *
 * The mock base (services/mock-1c: invented company ООО «Вектор-Трейд», one
 * year, planted errors) is served by the app itself at
 *     <app address>/api/mock-1c/mock/odata/standard.odata/
 * only while the switch `demo_1c` (table app_settings, migration 009) is on.
 * Off → the address answers 404, as if there were no server.
 *
 * The 1C reader (lib/c1-reader.ts) answers requests to an address whose path
 * starts with /api/mock-1c/ in-process, without going out to the network:
 * the app does not have to reach its own public domain, and no private
 * address has to be allowed (C1_ALLOW_PRIVATE_HOSTS is no longer needed).
 */
import { createAdminClient } from "./supabase-server";

export const DEMO_PATH = "/api/mock-1c";
export const DEMO_BASE_NAME = process.env.MOCK_1C_BASE || "mock";
export const DEMO_USER = process.env.MOCK_1C_USER || "odata.user";
export const DEMO_PASSWORD = process.env.MOCK_1C_PASSWORD || "mock-password";

type Admin = ReturnType<typeof createAdminClient>;

// ─── The switch ──────────────────────────────────────────────────────────────
let cached: { enabled: boolean; at: number } | null = null;

let testOverride: boolean | null = null;
/** For code tests only (scripts/test-demo-1c.ts): fixes the switch without a database. */
export function setDemo1cForTests(enabled: boolean | null): void { testOverride = enabled; }

/** Is the demo base on? Read from the database, kept for 5 s. No table (migration 009 not run) → off. */
export async function demo1cEnabled(supabase?: Admin): Promise<boolean> {
  if (testOverride !== null) return testOverride;
  if (cached && Date.now() - cached.at < 5_000) return cached.enabled;
  supabase ??= createAdminClient();
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", "demo_1c").maybeSingle();
  const enabled = !error && !!(data?.value as { enabled?: boolean } | null)?.enabled;
  cached = { enabled, at: Date.now() };
  return enabled;
}

export async function setDemo1c(supabase: Admin, enabled: boolean, userId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("app_settings")
    .upsert({ key: "demo_1c", value: { enabled }, updated_at: new Date().toISOString(), updated_by: userId });
  if (error) return { ok: false, error: /app_settings/.test(error.message) ? "Не выполнена миграция 009_app_settings.sql" : error.message };
  cached = { enabled, at: Date.now() };
  console.log(`[demo-1c] ${enabled ? "ON" : "OFF"} (by ${userId})`);
  return { ok: true };
}

export async function demo1cSchemaReady(supabase: Admin): Promise<boolean> {
  const { error } = await supabase.from("app_settings").select("key").limit(1);
  return !error;
}

// ─── The base ────────────────────────────────────────────────────────────────
type Handler = (resource: string, query: URLSearchParams, serviceUrl: string) => { status: number; contentType: string; body: string };
let handler: Promise<Handler> | null = null;

/** Builds the invented year once per process (about a second) and keeps it. */
function getHandler(): Promise<Handler> {
  if (!handler) {
    handler = (async () => {
      const fs = await import("node:fs");
      const { buildBase, mockFile } = await import("../services/mock-1c/data");
      const { handleOData } = await import("../services/mock-1c/odata");
      const base = buildBase(Number(process.env.MOCK_1C_YEAR) || 2025, Number(process.env.MOCK_1C_SCALE) || 1);
      const metadata = fs.readFileSync(mockFile("metadata.xml"), "utf8");
      return (resource, query, serviceUrl) => handleOData(base, metadata, resource, query, serviceUrl);
    })();
    handler.catch(() => { handler = null; });
  }
  return handler;
}

/**
 * One request to the demo base. `path` is what follows /api/mock-1c
 * (e.g. "/mock/odata/standard.odata/Catalog_Контрагенты"); `authorization` is
 * the request's header. Same answers as a 1C server: 404 when off or unknown,
 * 401 on a wrong login, 405 for anything but reading.
 */
export async function demo1cRequest(method: string, path: string, query: URLSearchParams, authorization: string | null,
                                    origin: string): Promise<{ status: number; contentType: string; body: string; headers?: Record<string, string> }> {
  const text = (status: number, body: string, headers?: Record<string, string>) =>
    ({ status, contentType: "text/plain;charset=utf-8", body, headers });
  if (!(await demo1cEnabled())) return text(404, "Not Found");
  const prefix = `/${DEMO_BASE_NAME}/odata/standard.odata`;
  if (path !== prefix && !path.startsWith(prefix + "/")) return text(404, "Not Found");

  const expected = `${DEMO_USER}:${DEMO_PASSWORD}`;
  const given = authorization?.startsWith("Basic ") ? Buffer.from(authorization.slice(6), "base64").toString("utf8") : "";
  if (given !== expected) return text(401, "Unauthorized", { "WWW-Authenticate": 'Basic realm="1C:Enterprise 8"' });
  if (method !== "GET") {
    return { status: 405, contentType: "application/json;charset=utf-8",
      body: JSON.stringify({ "odata.error": { code: "5", message: { lang: "ru", value: "Демо-база доступна только для чтения" } } }) };
  }
  const handle = await getHandler();
  return handle(path.slice(prefix.length + 1), query, `${origin}${DEMO_PATH}${prefix}`);
}

/** True for an address of the demo base (any host — the path decides). */
export function isDemo1cUrl(url: URL): boolean {
  return url.pathname === DEMO_PATH || url.pathname.startsWith(DEMO_PATH + "/");
}
