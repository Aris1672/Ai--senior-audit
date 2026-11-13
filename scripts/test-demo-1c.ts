// Code test (no database, no network): the demo 1C base switch.
//   npm run test:demo1c
import assert from "node:assert/strict";
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://db.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "x";

async function main() {
  const D = await import("../lib/demo-1c");
  const { readC1Snapshot, C1Error } = await import("../lib/c1-reader");
  const config = { url: "https://auditor.example.ru/api/mock-1c", base: "mock", username: D.DEMO_USER, password: D.DEMO_PASSWORD };
  const period = { from: "2025-01-01", to: "2025-12-31" };
  const auth = "Basic " + Buffer.from(`${D.DEMO_USER}:${D.DEMO_PASSWORD}`).toString("base64");

  // Off: the address is "not found", and the reader says the demo is off.
  D.setDemo1cForTests(false);
  assert.equal((await D.demo1cRequest("GET", "/mock/odata/standard.odata/Catalog_Контрагенты", new URLSearchParams(), auth, "https://x")).status, 404);
  await assert.rejects(readC1Snapshot(config, period), (e: unknown) => e instanceof C1Error && /Демо-база 1С сейчас выключена/.test((e as Error).message));

  // On: the same answers as the mock server.
  D.setDemo1cForTests(true);
  const ok = await D.demo1cRequest("GET", "/mock/odata/standard.odata/Catalog_Контрагенты", new URLSearchParams({ $format: "json", $top: "2" }), auth, "https://x");
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).value.length, 2);
  assert.equal((await D.demo1cRequest("GET", "/mock/odata/standard.odata/Catalog_Контрагенты", new URLSearchParams(), "Basic eDp5", "https://x")).status, 401);
  assert.equal((await D.demo1cRequest("POST", "/mock/odata/standard.odata/Catalog_Контрагенты", new URLSearchParams(), auth, "https://x")).status, 405);
  assert.equal((await D.demo1cRequest("GET", "/other/odata/standard.odata/Catalog_Контрагенты", new URLSearchParams(), auth, "https://x")).status, 404);
  const meta = await D.demo1cRequest("GET", "/mock/odata/standard.odata/$metadata", new URLSearchParams(), auth, "https://x");
  assert.equal(meta.status, 200);
  assert.match(meta.body, /<edmx:Edmx/);

  // The 1C reader answers the demo address in-process, whatever the host — nothing goes to the network.
  const snap = await readC1Snapshot(config, period);
  const docs = snap.documentCount;
  assert.equal(docs, 771);
  assert.match(snap.organisation.name, /Вектор-Трейд/);
  await assert.rejects(readC1Snapshot({ ...config, password: "wrong" }, period), (e: unknown) => e instanceof C1Error && /логин или пароль/.test((e as Error).message));
  assert.equal(D.isDemo1cUrl(new URL("https://a.ru/api/mock-1c/mock/odata")), true);
  assert.equal(D.isDemo1cUrl(new URL("https://a.ru/api/mock-1cx")), false);

  // Demo documents: all present, nothing outside the list can be fetched, the ZIP holds them all.
  const { DEMO_DOCS, demoDocPath } = await import("../lib/demo-docs");
  const fs = await import("node:fs");
  const { zipSync, unzipSync } = await import("fflate");
  assert.equal(DEMO_DOCS.length, 7);
  for (const d of DEMO_DOCS) assert.ok(demoDocPath(d.file), `missing: ${d.file}`);
  for (const bad of ["../data.ts", "../../.env", "/etc/passwd", "meridian_dogovor_i_akty.pdf/../../data.ts", "other.pdf"]) assert.equal(demoDocPath(bad), null, bad);
  const zip = zipSync(Object.fromEntries(DEMO_DOCS.map((d, i) => [`${i + 1}_round${d.round}_${d.file}`, new Uint8Array(fs.readFileSync(demoDocPath(d.file)!))])));
  const back = unzipSync(zip);
  assert.equal(Object.keys(back).length, 7);
  assert.ok(Object.keys(back)[0].startsWith("1_round1_meridian"));

  console.log(`✅ demo 1C: all checks passed (off → 404 and a clear message; on → OData answers; reader in-process: ${docs} documents; 7 demo documents, ZIP ok)`);
}
main().catch(e => { console.error("❌ demo 1C test failed:", e); process.exit(1); });
