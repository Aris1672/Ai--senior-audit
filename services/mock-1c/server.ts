/**
 * services/mock-1c/server.ts — runs the mock 1C base over HTTP.
 *
 *   npm run mock:1c                       → http://localhost:8081/mock/odata/standard.odata/
 *   MOCK_1C_PORT, MOCK_1C_BASE (default "mock"), MOCK_1C_USER / MOCK_1C_PASSWORD
 *   (default odata.user / mock-password), MOCK_1C_YEAR, MOCK_1C_SCALE (1 ≈ 750 documents a year)
 *
 * Access is by HTTP Basic login, like 1C's "automatic REST service" user.
 * The data is invented; see data.ts and README.md.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { buildBase, mockFile, type MockBase } from "./data";
import { handleOData } from "./odata";


export interface MockOptions { port?: number; baseName?: string; user?: string; password?: string; year?: number; scale?: number }

export function startMock1C(opts: MockOptions = {}): Promise<{ url: string; base: MockBase; close: () => Promise<void> }> {
  const baseName = opts.baseName ?? process.env.MOCK_1C_BASE ?? "mock";
  const user     = opts.user ?? process.env.MOCK_1C_USER ?? "odata.user";
  const password = opts.password ?? process.env.MOCK_1C_PASSWORD ?? "mock-password";
  const base     = buildBase(opts.year ?? (Number(process.env.MOCK_1C_YEAR) || 2025), opts.scale ?? (Number(process.env.MOCK_1C_SCALE) || 1));
  const metadata = fs.readFileSync(mockFile("metadata.xml"), "utf8");
  const prefix   = `/${baseName}/odata/standard.odata`;
  const expected = Buffer.from(`${user}:${password}`);

  const server = http.createServer((req, res) => {
    const send = (status: number, type: string, body: string, extra: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": type, "DataServiceVersion": "3.0", ...extra });
      res.end(body);
    };
    const auth = req.headers.authorization ?? "";
    const given = Buffer.from(auth.startsWith("Basic ") ? Buffer.from(auth.slice(6), "base64").toString("utf8") : "");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return send(401, "text/plain;charset=utf-8", "Unauthorized", { "WWW-Authenticate": 'Basic realm="1C:Enterprise 8"' });
    }
    if (req.method !== "GET") {
      return send(405, "application/json;charset=utf-8", JSON.stringify({ "odata.error": { code: "5", message: { lang: "ru", value: "Макет базы доступен только для чтения" } } }));
    }
    const url = new URL(req.url ?? "/", "http://mock");
    let pathname: string;
    try { pathname = decodeURIComponent(url.pathname); } catch { return send(400, "text/plain;charset=utf-8", "Bad Request"); }
    if (pathname !== prefix && !pathname.startsWith(prefix + "/")) return send(404, "text/plain;charset=utf-8", "Not Found");
    const host = req.headers.host ?? "localhost";
    const out = handleOData(base, metadata, pathname.slice(prefix.length + 1), url.searchParams, `http://${host}${prefix}`);
    send(out.status, out.contentType, out.body);
  });

  return new Promise(resolve => {
    server.listen(opts.port ?? (Number(process.env.MOCK_1C_PORT) || 8081), () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `http://localhost:${port}${prefix}`, base, close: () => new Promise<void>(done => server.close(() => done())) });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startMock1C().then(({ url, base }) => {
    const docs = Object.entries(base.sets).filter(([n]) => n.startsWith("Document_")).reduce((s, [, r]) => s + r.length, 0);
    console.log(`[mock-1c] ООО «Вектор-Трейд», ${base.year}: ${docs} документов, ${base.ledger.length} проводок`);
    console.log(`[mock-1c] ${url}/   (вход: HTTP Basic)`);
  });
}
