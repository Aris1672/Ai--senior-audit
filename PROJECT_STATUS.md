# AI Senior Auditor — Project Status

> Last updated: September 1, 2026. **Major infrastructure migration: Vercel → SpaceWeb, with a new Kazakhstan VPS proxy for Anthropic.** Root cause: Vercel billing failed because the only available payment card is Russia-issued (accepted at signup, but Vercel cannot actually charge it — see Session Log for full story). App is now hosted on SpaceWeb Serverless (beta); Anthropic calls are routed through a dedicated reverse-proxy vhost on the existing Kazakhstan VPS (`audit.assistant24info.ru` → `api.anthropic.com`); Supabase is reachable directly from SpaceWeb, no proxy needed. Also fixed, same session: the `/api/chat` route had no `maxDuration` set (silently defaulting to Vercel Hobby's 10s), which combined with a fully-buffered (non-streaming) response and zero client-side error handling caused audits to time out with the UI stuck locked forever; converted to true NDJSON streaming with a 15s heartbeat (to survive proxy idle-timeouts) and added try/catch/finally everywhere so the input never locks up again. **Vercel is being kept live as a fallback for now, not yet decommissioned.** Previous entry (August 7): per-transaction billing verified end-to-end...

> GitHub: https://github.com/Aris1672/Ai--senior-audit
> Live demo: https://ai-senior-audit.vercel.app
> Admin login: support@assistant24.tech (role set manually in Supabase)
> **Local repo path:** `.git` lives at `H:\AI Work\audit-agent\ai-senior-auditor` — NOT at `H:\AI Work\audit-agent`. `cd` into the `ai-senior-auditor` subfolder before any git command.

---

## Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js App Router, TypeScript | 16.2.6 |
| Runtime | React | 19.2.4 |
| Database + Auth | Supabase (PostgreSQL + Auth + Storage) | @supabase/supabase-js 2.105.4 |
| Hosting | SpaceWeb Serverless (beta) — primary, as of Sep 1 2026 | — |
| Hosting (fallback, not decommissioned) | Vercel | — |
| Outbound proxy (Anthropic only) | nginx on existing Kazakhstan VPS (`audit.assistant24info.ru`) | — |
| AI — audit reasoning + findings extraction | Claude Sonnet 5 | @anthropic-ai/sdk 0.96.0 |
| XLSX parsing | fflate (hand-rolled) + xlsx (legacy .xls only) | 0.8.3 / 0.18.5 |
| DOCX parsing | fflate (hand-rolled) | same |
| DOC parsing | mammoth | 1.12.0 |
| PDF text extraction | pdf-parse | installed, now wired in |
| PDF rasterization (scanned PDFs → vision) | pdfjs-dist + @napi-rs/canvas | added this session |
| PDF generation | pdfmake | 0.3.8 |

---

## Architecture: Russia → Kazakhstan VPS Proxy (SpaceWeb hosting)

**Superseded September 1, 2026** — see Session Log below for the full migration story. The app now runs on SpaceWeb (Russia-based hosting, billed in RUB, solves the Vercel card problem), with only the Anthropic leg proxied through an existing Kazakhstan VPS. Supabase is reachable directly from SpaceWeb — no proxy needed for that leg.

```
Browser (Russia)
    │
    ▼
SpaceWeb Serverless (Russia) — Next.js SSR/Standalone, auto-deploy on push
    ├── → Supabase PostgreSQL  (direct, no proxy needed)
    ├── → Supabase Storage     (direct, no proxy needed)
    └── → Anthropic API        (via Kazakhstan VPS reverse proxy — see below)
```

**Anthropic proxy details:**
- Domain: `audit.assistant24info.ru` (A record → `199.189.249.4`, the Kazakhstan VPS — same server that already hosts `audit.o2plus.ru`, an unrelated *ingress* proxy for the old Vercel deployment, and a few other ispmanager-managed sites)
- nginx vhost on that VPS reverse-proxies everything to `https://api.anthropic.com`, with `proxy_buffering off` (critical — without it, streaming responses get buffered at this hop and silently look "stuck" again, same failure mode fixed earlier in the app itself)
- App's `lib/anthropic.ts` reads `ANTHROPIC_BASE_URL` from env, defaulting to the real `api.anthropic.com` if unset (safe for local dev)
- Confirmed via manual `curl` testing (including a realistic ~28K-char system prompt + `tools` param + streaming) that the proxy itself handles full-scale requests correctly — the extended debugging session was actually about `ANTHROPIC_BASE_URL` not being set/baked into the SpaceWeb build at all (see Session Log), not a proxy or Anthropic-side problem

**Old architecture (Vercel), kept as fallback:**
```
Browser (Russia)
    │
    ▼
Vercel API Routes (US serverless)
    ├── → Supabase PostgreSQL  (DB reads/writes)
    ├── → Supabase Storage     (file upload/download)
    └── → Anthropic API        (Claude calls)
```

The browser **never** connects directly to Supabase or Anthropic. Every fetch in every client component hits a `/api/*` route on the same Vercel domain.

`proxy.ts` at the project root is a Next.js middleware file but is currently a **no-op passthrough** (`return NextResponse.next()`). The Russia-proxy protection is purely architectural — it comes from how API routes are structured — not from this middleware. The middleware matcher excludes `/api/report`, which means the report download route doesn't go through even this no-op.

**✅ FIXED July 1, 2026 — direct-browser-to-Supabase bypass in `admin/layout.tsx` and `client/layout.tsx`.** Root cause of intermittent login failures without VPN from Russia. Both layouts called `createClient()` from `lib/supabase-client.ts` (a legitimate `@supabase/ssr` browser client) solely to run `supabase.auth.signOut()` on logout. Constructing that client is not inert: `@supabase/ssr`'s browser client auto-initializes a `GoTrueClient` that reads the session cookie set by `/api/auth/login` and can issue a direct browser → `*.supabase.co` call (session validation/refresh), bypassing Vercel entirely — even though the login POST itself was already correctly proxied. Fix: removed `createClient()` from both layouts; logout now calls a new `POST /api/auth/logout` route that runs `signOut()` server-side, matching the same pattern as `/api/auth/login`. Every remaining page in the app tree was individually swept for `createClient`/`@supabase/ssr` imports — none found. See Session Log for the full audit trail.

**Residual risk, not fully closed:** `*.vercel.app` is shared infrastructure; Roskomnadzor blocking is sometimes done by IP range/SNI rather than per-site, so the app can still inherit collateral blocking unrelated to its own code. Not yet moved to a custom domain (`assistant24tech.ru` subdomain via CNAME) — recommended before relying on the `.vercel.app` URL for future demos in Russia.

---

## AI Agent: Single-Model Tool-Use Architecture

> **Changed July 3, 2026** — was a two-model "hybrid" design (Sonnet reasoning + separate Haiku extraction call). Haiku is now removed; see Session Log for rationale (real usage data showed Haiku at ~2.6% of daily token cost — not worth the quality risk the split had already caused once, see the evidence_status incident below).

### Model

| Model | Role | Max tokens |
|---|---|---|
| Claude Sonnet 5 (`claude-sonnet-5`) | Audit reasoning + structured findings extraction (single call) | 16000 |

### Call Flow (`app/api/chat/route.ts`)

```
User message arrives at POST /api/chat
    │
    ├─ Verify client profile is active (profiles table)
    │
    ├─ Download ALL documents linked to session (Supabase Storage → parseFile())
    │   └─ Each file parsed to structured text (CSV-style or prose)
    │
    ├─ Build system prompt:
    │   AUDIT_SYSTEM_PROMPT + buildAuditContext() + "=== ЗАГРУЖЕННЫЕ ФИНАНСОВЫЕ ДОКУМЕНТЫ ===" block
    │
    └─ Claude Sonnet 5 → single call, `record_findings` tool attached (16000 tokens, auto-continues on max_tokens)
          ├─ Writes full audit report as text (deep legal reasoning, Russian regulatory citations, risk classification)
          ├─ If findings exist: calls record_findings ONCE at the end with all findings as structured input
          │     (per AUDIT_SYSTEM_PROMPT instructions — model is told not to call it if there's nothing to report)
          └─ Response content walked for both text blocks and the tool_use block in the same pass
                ├─ Text blocks → concatenated → saved to audit_messages
                └─ tool_use input.findings → validated (enum checks, length caps, risk_flag default) → insert into findings table
                      └─ Increment findings_ct on audit_sessions
                      (Both DB writes still run in parallel via Promise.all)
```

**Why the second model was removed:** the two-call split had already caused a real bug once — Sonnet computed the `evidence_status` confidence tier as part of its reasoning, but Haiku's separate extraction schema didn't ask for that field, so it was silently discarded before the DB write (fixed July 1, see Session Log). Any field Sonnet reasoned about that a second model's schema didn't mirror was structurally at risk of the same class of bug. A single call with a forced tool schema can't have that drift — there's one source of truth, not a translation step.

**What this removed:**
- The keyword-regex gate (`нарушени`, `критич`, `риск`, `штраф`, `КРИТИЧНО`, `СУЩЕСТВЕННО`, `НЕСУЩЕСТВЕННО`) that decided whether to even attempt extraction — findings phrased outside that keyword list could previously be silently skipped
- Markdown-fence-stripping and regex-fallback JSON parsing, needed because Haiku sometimes ignored the "JSON only" instruction — tool_use input arrives as a typed object, not free text to re-parse
- `HAIKU_MODEL` and `HAIKU_PRICING` constants in `lib/anthropic.ts`

**What stayed:** DB-side validation in `saveFindings()` (enum checks against `validRiskLevels`/`validEvidenceStatuses`, field length caps, defaulting to `risk_flag` never `confirmed` on ambiguity) — tool_use input is schema-*guided* by the tool definition, not schema-*enforced*, so a malformed value from the model is still possible and must not corrupt the DB or overstate certainty.

**Not yet verified:** this is a behavioral assumption (model writes full text, then calls the tool exactly once at the end) that hasn't been confirmed against a real Sonnet 5 round trip yet. See punch list P1.

### System Prompt (`lib/anthropic.ts` — `AUDIT_SYSTEM_PROMPT`)

The system prompt is written entirely in Russian and instructs the AI to operate as a senior corporate auditor for Russian enterprises. Key capabilities defined:

**Regulatory framework:** ФЗ №402-ФЗ (accounting), ПБУ 1–24 (accounting standards), НДС гл.21 НК РФ, налог на прибыль гл.25 НК РФ, НДФЛ гл.23 НК РФ, ФНС/ПФР/СФР/Росстат requirements, ФСАД (federal audit standards).

**Three-tier evidence confidence system:**
- `ПОДТВЕРЖДЁННОЕ НАРУШЕНИЕ` — only when data directly and unambiguously proves the violation
- `ПРИЗНАК РИСКА` — possible problem requiring additional documents; must name the specific docs needed
- `КОСВЕННЫЙ ПРИЗНАК` — weak signal requiring monitoring only

**✅ FIXED July 1, 2026 — this tier was previously computed by Sonnet but discarded before storage.** The prompt has always required a `**Статус:**` field per finding, but Haiku's extraction schema never asked for it, so every finding's DB row was indistinguishable regardless of confidence — a proven violation and a weak indirect signal looked identical in the dashboard and PDF. Fixed by adding an `evidence_status` enum column (`confirmed` / `risk_flag` / `indirect`, migration `005_finding_evidence_status.sql`) and extending the Haiku extraction prompt in `lib/anthropic.ts`/`app/api/chat/route.ts` to map the Russian status text to it. Defaults to `risk_flag` (never `confirmed`) whenever the mapping is ambiguous or absent — the extraction step never overstates certainty. Rendered as a badge alongside the risk-level badge in `app/client/audit/[id]/page.tsx` (list + PDF) and `app/client/dashboard/page.tsx` (open findings panel). See Session Log.

**Superseded July 3, 2026 — Haiku extraction step removed.** The mechanism described above (Haiku's separate JSON schema) no longer exists. `evidence_status` is now requested directly on the `record_findings` tool schema that Sonnet calls itself — see "AI Agent: Single-Model Tool-Use Architecture" above. The same default-to-`risk_flag`-never-`confirmed` rule was carried over into the new tool schema and `saveFindings()`'s DB-side validation.

**Three-tier risk classification (used throughout DB and UI):**
- `КРИТИЧНО` — direct tax sanctions, fraud indicators, balance sheet distortion >5%, cash-out patterns, missing primary documents on material transactions
- `СУЩЕСТВЕННО` — PBU methodology violations, partial missing docs affecting tax base, systematic account correspondence errors, missed ФНС/СФР deadlines
- `НЕСУЩЕСТВЕННО` — technical errors without tax impact, single document deficiencies without financial consequences

**Anti-hallucination constraints:** Explicitly prohibits citing specific legal articles without certainty, inventing document details or counterparty data, making legal conclusions without direct data support.

**Transaction analysis checklist:** Document verification (ТОРГ-12, УПД, Счёт-фактура, КС-2/КС-3, ЕГРЮЛ), account correspondence validation, anomaly detection (duplicate payments, round-number transactions, after-hours operations 22:00–06:00 МСК, manual journal entries bypassing 1C workflow, shell company indicators), quantitative flags (payments >200% of per-counterparty average, >30% payment concentration on one counterparty).

**Mandatory output format:** Each finding must include: risk level, status, description with supporting data, legal basis, confirming data points from the document, recommendation with timeframe.

**Report structure:** Auditor summary (**changed July 4, 2026 — now a required bullet list, 4–6 points, not prose**: what was checked, legal form + tax regime from session context, main income/expense sources, key issues, overall risk rating) → confirmed violations (by descending risk) → risk indicators → indirect indicators → quality assessment → priority recommendations (max 5, numbered).

**Tone rules (added July 4, 2026):** explicit instruction against self-introduction/greeting phrasing ("Здравствуйте! Меня зовут...") at the start of any response — the model is told it's a corporate audit tool, not a conversational partner, and should start directly with either formal address or substance.

**Mandatory audit-purpose question (added July 4, 2026):** legal form/tax regime/VAT status are now app-level facts (see "Tax-Profile Gate" above) and the prompt tells the model not to re-ask for them. The one remaining clarifying question — audit purpose (tax risk / bank-check prep / internal control / other) — is now a hard instruction: if not yet stated in the conversation, the model's first response in the session must be *only* that question, no report, no preliminary findings. Full analysis is explicitly gated on it being answered. **This is prompt-only, not app-enforced** — same non-determinism ceiling as everything else asked of the model rather than validated in code; not yet confirmed to fire reliably across repeated real runs (see punch list).

---

## File Parser (`lib/file-parser.ts`)

A pure library with no HTTP calls or side effects. Runs server-side on Vercel Node.js runtime. Converts uploaded files to structured text for the AI context window.

### Supported formats

| Format | Parser | Method | Output |
|---|---|---|---|
| `.xlsx` | `parseXLSX()` | fflate unzip → raw XML parse | CSV-style text, first 500 rows, 50K char cap |
| `.xls` (legacy binary) | `parseXLS()` | `xlsx` npm package | Same as above |
| `.csv` | `parseCSV()` | Hand-rolled, auto-detects `;` vs `,` | Headers + first 500 rows |
| `.xml` | `parseXML()` | Tag frequency heuristic | First 50K chars |
| `.docx` | `parseDOCX()` | fflate unzip → `word/document.xml` text run extraction | Prose text, 50K char cap |
| `.doc` (legacy binary) | `parseDOC()` | mammoth | Prose text, 50K char cap |
| `.txt` (1C bank export) | `parse1CTxt()` | Full custom parser | Structured CSV + account summary |
| `.pdf` (text layer) | `parsePDF()` | pdf-parse | Text content, 50K char cap |
| `.pdf` (scanned, no text layer) | `renderPDFPagesAsImages()` | pdfjs-dist + @napi-rs/canvas → PNG → Claude vision | Up to first 10 pages rendered at 1.5x scale, sent as native vision images |
| `.jpg` / `.png` | n/a (no text parser) | Routed directly to Claude vision | Native image input, no OCR pipeline |

**`/api/chat/route.ts` file-type detection (fixed this session):** Previously re-derived file type from the filename extension, which silently mis-routed `.doc`, `.txt`, and `.pdf` through the XLSX parser (since unmatched extensions fell through to an `"xlsx"` default). Root cause: the `documents` table already has a correctly-classified `file_type` column populated by the upload route's MIME/magic-byte sniffing, but the chat route ignored it. Fix: `getAllDocumentsContent()` now trusts `doc.file_type` directly instead of re-deriving it. This one fix unlocked `.doc`, `.txt` (1C), and `.pdf` simultaneously, and separates images out to a dedicated vision path instead of attempting text extraction on them.

**1C Client Bank Exchange parser** is the most complete parser in the system. Capabilities:
- Detects files by magic string `1CClientBankExchange` (first 64 bytes) via `is1CClientBankExchange()`
- Hand-coded Windows-1251 (CP1251) → UTF-16 decoder with hardcoded 128-entry byte table — zero external dependencies, works on all runtimes including Vercel Edge
- Parses `СекцияРасчСчет` block to a typed `C1AccountSummary`: account number, period start/end, opening/closing balance, total credits, total debits
- Parses all `СекцияДокумент…КонецДокумента` blocks to typed `C1Transaction[]`: payer/receiver INN, bank, BIK, BIC, payment purpose, direction (credit/debit), payment type
- Outputs CSV-style text with a balance summary header for AI consumption, capped at 500 transactions / 50K chars

### XML heuristic detection

1. Try known 1C and generic transaction tag names: `ХозяйственнаяОперация`, `Документ`, `Document`, `transaction`, `Transaction`, `entry`, `Entry`, `record`, `Record`, `row`, `Row`
2. If none match: frequency-analyse all tags in the document, use the most-repeated tag as the row element

### Known gaps (historical — status updated below; see Session Log)

**Multi-sheet XLS/XLSX:** ✅ **FIXED this session.** Both `parseXLSX()` and `parseXLS()` now loop over every sheet instead of reading only the first. `parseXLSX()` resolves real sheet names by cross-referencing `xl/workbook.xml` against `xl/_rels/workbook.xml.rels` (falls back to generic "sheet1"/"sheet2" naming if that parsing fails, so it can't regress previously-working files). Each sheet gets a `--- ЛИСТ: {name} ({row count} строк) ---` header in the combined output. Each sheet is still capped at 500 rows individually (not 500 total), so a 2-sheet file can now surface up to 1000 rows combined; the overall 50K char cap still applies to the combined output. Not yet re-tested against the real 135-row + 178-row client file post-Vercel-deploy — **do that before considering this closed.**

**PDF content extraction:** ✅ **FIXED this session.** `parsePDF()` now uses `pdf-parse` for text-layer PDFs. For scanned PDFs (no extractable text layer — detected via a ~20-chars/page heuristic), `renderPDFPagesAsImages()` rasterizes up to the first 10 pages to PNG via `pdfjs-dist` + `@napi-rs/canvas` and routes them through Claude's vision input, same pathway as JPG/PNG uploads. **Not yet verified on an actual Vercel deploy** — two build failures were already hit and fixed (TS type error on the `pdf-parse` import shape, and Turbopack failing to bundle `@napi-rs/canvas`'s native binding, fixed via `serverExternalPackages` in `next.config.ts`). Confirm a real scanned-PDF upload end-to-end before treating this as done. Known limitation: the scanned-vs-text heuristic averages across the whole document, so a mixed PDF (typed contract + handwritten signature page) gets classified as fully one or the other, not per-page.

**1C `.txt` unreachable from UI:** ✅ **FIXED this session.** `.txt` added to the `accept` attribute on the Documents page and the new-audit wizard. **Chat page's own attachment-button accept attribute was intentionally left untouched** — it already had `.xls,.pdf` but is still missing `.txt`/`.doc` for consistency with the other two upload surfaces. Decide whether to patch it too.

**Fallback byte-size estimation:** Every parser's `catch` block returns `parseMethod: "fallback"` with `rowCount: Math.floor(buffer.byteLength / 200)`. This produces a plausible-looking but fictitious row count that flows into the billing `calculate-price` route, potentially resulting in incorrect pricing on parse failure.

---

## Pricing & Billing System

**Superseded July 15, 2026 — flat per-tier pricing replaced with true per-transaction pricing.** The tier table below is historical; `pricing_tiers` is no longer the source of truth (see P2 punch-list item for its pending removal).

### Per-transaction pricing (current)

- **Global default rate:** `billing_settings.price_per_transaction_rub` — single row (`id = 1`). Was seeded at 15.00 ₽ as a placeholder; **updated August 7, 2026 to 12.5 ₽/transaction (live)**, matching the rate now published on the landing page.
- **Per-client override:** `client_subscriptions.custom_price_rub` — `NULL` = use global default; set = that client's own rate. Editable from `/admin/pricing`.
- Audit cost = `transactionCount × rate` (client's override if set, else global default).
- **Verified end-to-end August 7, 2026** — tested with two real clients on different rates (one on the global default, one on a custom override); both priced correctly. Closes the P1 verification item opened July 15.

### Historical flat tiers (superseded, table left unused)

| Tier | Max transactions | Price |
|---|---|---|
| Базовый | 500 | 8 000 ₽ |
| Стандарт | 2 000 | 15 000 ₽ |
| Профи | 5 000 | 30 000 ₽ |
| Корпоратив | 20 000 | 75 000 ₽ |

### New audit pricing flow

```
New Audit wizard (Step 1: client info)
    ↓
Step 2: file upload OR live 1C connection
    ↓
POST /api/upload → file stored in Supabase Storage → background parse triggered
    ↓
POST /api/audit/calculate-price
    ├── FILE MODE: use cached parsed_data.rowCount, or re-parse if not ready
    └── LIVE 1C MODE: OData REST API call → Document_ПоступлениеТоваровУслуг?$count=true
    ↓
Match rowCount to pricing_tiers → return { transactionCount, priceRub, tierName }
    ↓
Step 4: client sees transaction count, tier name, price — confirms
    ↓
POST /api/data { action: "confirm_audit" } → writes cost_rub + transactions_ct to audit_sessions
    ↓
Redirect to /client/chat?session=...
```

### `check-limit` enforcement (`/api/billing/check-limit`)

Calls the `get_client_limit(p_client_id)` PostgreSQL function which joins `client_subscriptions` → `pricing_tiers` and returns `(max_tx, price_rub, audits_remaining)`. Blocks audit start if:
- Client status is `paused` or `deleted`
- No active subscription found
- `audits_remaining <= 0`
- `transactionCount > max_tx`

**Known gap:** Client creation via `/api/admin/clients POST` never creates a `client_subscriptions` row. New clients have no subscription until one is inserted manually in Supabase. `check-limit` will always return "Нет активной подписки" for newly created clients until this is done.

### Payment tracking

The admin clients page shows each client's audit sessions expanded with paid/unpaid status and a toggle button. The admin dashboard shows a paid-vs-unpaid donut. The client dashboard shows their own payment donut. All three read/write `audit_sessions.paid` (boolean).

**Known gap:** `paid` is not a column in `003_audit_core.sql`. It was added outside version-controlled migrations (directly in Supabase dashboard or in an untracked migration). Migration files should be updated to reflect the real schema.

---

## PDF Report Generation

**Two independent, complete PDF generators currently exist in the codebase.**

### Generator 1: Client-side (active)

**Location:** `app/client/audit/[id]/page.tsx` → `generatePDF()` function

Triggered by "↓ Скачать PDF" button on the audit detail page. Uses `pdfmake` dynamically imported in the browser. Generates from React state already loaded on the page — no additional server round-trip.

**Report contents:** Assistant24 logo (base64 embedded), audit metadata (company, period, date), 4-cell KPI grid (transactions checked, critical risks, major risks, audit cost), executive summary panel with auto-generated Russian prose, detailed findings registry grouped by risk level with colored left-border cards (red/amber/green), pdfmake Roboto font for Cyrillic support.

**Executive summary prose is auto-generated:**
- Critical findings present → "Внимание: выявлено N критичных нарушений… немедленно принять меры…"
- Only minor/major findings → "Критических системных несоответствий не обнаружено…"
- No findings → "Нарушений нормативных регламентов не выявлено…"

**`transactions_ct` workaround:** When `session.transactions_ct` is 0 in the DB (common, see Known Gaps), the PDF generator tries to extract a transaction count by regex-scanning finding descriptions for numeric patterns before "финансов", "транзакц", or "операци". This compensates for the fact that `confirm_audit` doesn't reliably populate `transactions_ct`.

### Generator 2: Server-side (orphaned)

**Location:** `app/api/report/[id]/route.ts`

A `GET /api/report/{sessionId}` route that fetches session + findings + messages from Supabase, generates a PDF server-side using `pdfmake`, and streams it as `application/pdf` with a `Content-Disposition: attachment` header. Dark-themed design (white text on dark background). The `/api/data/route.ts` dispatcher contains the comment: *"generate_report removed — PDF is now generated client-side in page.tsx using pdfmake in the browser."*

This route is effectively dead code — no UI link triggers it. However it remains deployed, publicly accessible (no auth check), and accepts any session UUID. **Should be deleted or auth-gated.**

`app/api/report/test/route.ts` is a diagnostic smoke-test that was used during development to verify `pdfmake`'s `getBuffer()` API works in the Vercel serverless runtime. Returns `{ ok, size }` or an error with stack trace. Also dead code, should be deleted.

---

## Data Layer: `/api/data` Dispatcher

All frontend data reads and writes route through a single `POST /api/data` endpoint with an `action` string and optional `payload`. This uses `createAdminClient()` (service-role key, RLS bypassed) for all operations.

### Full action list

| Action | Used by | What it does |
|---|---|---|
| `admin_stats` | Admin dashboard | profiles, sessions, findings, usage aggregates |
| `admin_clients` | Admin clients page | profiles + nested subscriptions + sessions |
| `pricing_tiers` | Price calculation | Active tiers only |
| `pricing_tiers_all` | Admin pricing page | All tiers including inactive |
| `client_dashboard` | Client dashboard | profile + sessions (last 5) + open findings (last 8) + usage |
| `client_usage` | Client usage page | usage_events (last 100) |
| `client_documents` | Documents page | documents for client |
| `client_messages` | Chat page | audit_messages for session |
| `get_or_create_session` | **No longer called by any client code (July 4, 2026).** | See "Tax-Profile Gate" section — still creates a tax-profile-less session if invoked directly against the API, but the chat page now redirects to the wizard instead of calling it. |
| `save_message` | Chat page | Insert to audit_messages |
| `update_client_status` | Admin clients page | profiles.status |
| `create_audit_session` | New audit wizard | **Now validates legal_form/tax_regime/vat_status server-side (July 4, 2026)** — rejects with 400 if missing or not in the shared enum set from `lib/audit-constants.ts`; see below. Insert audit_sessions. |
| `confirm_audit` | New audit wizard | **Now re-checks legal_form/tax_regime/vat_status exist on the session row before writing (July 4, 2026)** — defense-in-depth catching any session that reached this point without going through `create_audit_session`'s validation. Write cost_rub + transactions_ct to session. |
| `get_session_context` | Chat page (with session param) | Session data + company/period parsed from title + tax-profile fields (with `_display` resolving "Другое" to free text) |
| `delete_client` | Admin clients page | Soft-delete (status → "deleted") |
| `get_client_sessions` | Client layout auth check | Check if client has any sessions (lock/unlock chat nav) |
| `update_session_status` | Chat page | Set session status (active/completed) |
| `update_session_paid` | Admin clients page | Toggle session.paid boolean |
| `audit_detail` | Audit detail page | session + findings + messages together |

**Architectural note:** The codebase uses two parallel data-access patterns: (1) the `/api/data` action dispatcher for most reads and status writes, and (2) dedicated REST-style routes for write-heavy admin operations (`/api/admin/clients` POST/PATCH/DELETE, `/api/admin/pricing` POST/PATCH/DELETE, `/api/audit/calculate-price`, `/api/billing/check-limit`, `/api/chat`, `/api/upload`, `/api/parse-file`). This is a convention inconsistency worth resolving.

### Company name / period storage

Company name and audit period are **not stored in dedicated columns**. They are encoded into `audit_sessions.title` as `"Аудит: {companyName} ({period})"` and re-extracted by regex in two separate places (`get_session_context` and `audit_detail`):

```typescript
const companyMatch = title.match(/Аудит:\s*(.+?)(?:\s*\(|$)/);
const periodMatch  = title.match(/\((.+?)\)/);
```

Any company name containing a `(` character silently breaks the parse. `audit_sessions` has `period_from DATE` and `period_to DATE` columns in the schema (selected in `get_session_context`) but these are never written to — the title-embedded period string is used instead.

### Tax-Profile Gate (added July 4, 2026)

**Why:** identical input data (same 71-transaction bank statement) was producing different risk-tier conclusions across separate AI runs, and one run skipped straight to full analysis while another stopped to ask about tax regime first — an emergent, not scripted, behavior, since nothing in the prompt governed this decision either way. Root cause: the model was left to guess at or inconsistently ask about facts (legal form, tax regime, VAT status) that change what a *correct* analysis even looks like.

**Fix — moved to a hard application-level gate, not a prompt instruction:**
- Three new columns on `audit_sessions`: `legal_form`/`legal_form_other`, `tax_regime`/`tax_regime_other`, `vat_status` (migration `006_session_tax_profile.sql`)
- `lib/audit-constants.ts` — single source of truth for the three dropdown option sets (`LEGAL_FORMS`, `TAX_REGIMES`, `VAT_STATUSES`), imported by both the wizard (rendering) and `/api/data` (validation), so they can't drift apart
- New-audit wizard (`app/client/audit/new/page.tsx`) — Step 1 now has three required fields: legal form (select + conditional "Другое" free text), tax regime (same pattern), VAT status (radio group — single-select, since the three options are mutually exclusive; deliberately not checkboxes)
- `create_audit_session` (`/api/data`) validates all three server-side against the shared enum sets and rejects with 400 if missing/invalid — **this is the real gate; the wizard's client-side check is UX only, not enforcement**
- `confirm_audit` re-checks the fields exist on the DB row itself before allowing confirmation — defense-in-depth against any code path that could create a session without going through `create_audit_session`
- **The `get_or_create_session` bypass is closed at its only call site:** this action still exists and would still create a tax-profile-less session if called directly, but `app/client/chat/page.tsx` no longer calls it — landing on `/client/chat` with no `?session=` param now redirects to the wizard instead. Since the wizard's `confirm_audit` redirect is the only way to reach the chat page with a session ID, every session reaching chat has necessarily passed the gate.
- `buildAuditContext()` (`lib/anthropic.ts`) takes `legalForm`/`taxRegime`/`vatStatus` and renders them as **stated facts** in the system prompt context block, with an explicit instruction not to re-ask for them in chat
- Per product decision, these fields are captured **fresh on every new audit session**, not inherited from a client profile — a repeat client re-enters them each time. Deliberate tradeoff, not an oversight.

**Scoped out by product decision:** `audit_purpose` stays prompt-only (see AI Agent section / System Prompt below) rather than becoming a 4th app-level gate — reasoning was that legal form/tax regime/VAT status are objective facts that change correctness of findings, while audit purpose is framing/prioritization on top of an already-correct analysis, so some variance there was judged lower-stakes. Not yet validated against repeated real runs whether that assumption holds — see punch list.

---

## Database Schema

Migrations: `supabase/migrations/001–005.sql` (005 adds `findings.evidence_status` — see below)

### `profiles`
Extends Supabase `auth.users`. Auto-created by `on_auth_user_created` trigger (reliability issues: client creation route bypasses the trigger and does explicit `upsert` + `update`).

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | References auth.users |
| role | `user_role` ENUM | `'admin'`, `'client'` |
| full_name | TEXT | |
| company_name | TEXT | |
| inn | TEXT | Russian tax ID |
| phone | TEXT | |
| status | `account_status` ENUM | `'active'`, `'paused'`, `'deleted'` |
| created_by | UUID | Admin who created the client |
| created_at / updated_at | TIMESTAMPTZ | |

### `pricing_tiers`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| name | TEXT | e.g. "Базовый" |
| max_transactions | INTEGER | Upper bound for this tier |
| price_rub | NUMERIC(10,2) | |
| description | TEXT | |
| is_active | BOOLEAN | Admin can toggle |
| sort_order | INTEGER | Display order |

### `client_subscriptions`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| client_id | UUID → profiles | |
| tier_id | UUID → pricing_tiers | |
| custom_price_rub | NUMERIC(10,2) | Override tier price |
| custom_max_tx | INTEGER | Override tier limit |
| audits_purchased | INTEGER | CHECK > 0 |
| audits_used | INTEGER | |
| valid_from / valid_to | DATE | Subscription window |
| notes | TEXT | Admin notes |
| created_by | UUID → auth.users | |

PostgreSQL function `get_client_limit(p_client_id)` returns effective `(max_tx, price_rub, audits_remaining)` respecting custom overrides and date validity.

### `audit_sessions`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| client_id | UUID → profiles | |
| subscription_id | UUID → client_subscriptions | |
| title | TEXT | Encodes company name + period |
| period_from / period_to | DATE | Written at session create (currently unused by app code) |
| status | `session_status` ENUM | `'active'`, `'completed'`, `'archived'` |
| transactions_ct | INTEGER | Set by `confirm_audit` action |
| findings_ct | INTEGER | Incremented by chat route after saving findings from the record_findings tool call |
| cost_rub | NUMERIC(10,2) | Set by `confirm_audit` action |
| paid | BOOLEAN | **Not in migration file** — added outside version control |
| legal_form / legal_form_other | TEXT | **Added July 4, 2026 (migration 006).** Company legal form declared at session creation via required dropdown; `_other` holds free text when "Другое" is selected. |
| tax_regime / tax_regime_other | TEXT | **Added July 4, 2026 (migration 006).** Same pattern as legal_form. Feeds directly into `buildAuditContext()` as a stated fact — see "Tax-Profile Gate" section below. |
| vat_status | TEXT | **Added July 4, 2026 (migration 006).** `'payer'` \| `'exempt'` \| `'not_taxed'`, DB-level `CHECK` constraint. |
| created_at / completed_at | TIMESTAMPTZ | |

PostgreSQL function `increment_session_cost(p_session_id, p_amount)` — defined but not called by any app code.

### `transactions`

Fully designed for structured 1C transaction storage (counterparty, INN, debit/credit accounts, risk_score, raw JSONB). **No app code currently inserts into this table.** The file parser converts data to flat text sent directly to the LLM rather than structured rows. This table is designed for a future structured-analysis layer or Phase 2 GigaChat integration.

### `findings`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| session_id | UUID → audit_sessions | |
| client_id | UUID → profiles | |
| transaction_id | UUID → transactions | Nullable; no transactions are inserted |
| risk_level | `risk_level` ENUM | `'КРИТИЧНО'`, `'СУЩЕСТВЕННО'`, `'НЕСУЩЕСТВЕННО'` — severity |
| evidence_status | `finding_evidence_status` ENUM | **Added July 1, 2026 (migration 005).** `'confirmed'`, `'risk_flag'`, `'indirect'` — confidence tier, distinct from both `risk_level` (severity) and `status` (workflow). Defaults to `'risk_flag'`; existing pre-migration rows were backfilled to this default rather than assumed confirmed. |
| risk_score | INTEGER | Not populated by current extraction |
| title | TEXT | Max 100 chars (enforced in app) |
| description | TEXT | Max 500 chars |
| legal_basis | TEXT | Max 200 chars |
| recommendation | TEXT | Max 300 chars |
| status | `finding_status` ENUM | `'open'`, `'resolved'`, `'disputed'` — workflow state, not evidence confidence |

### `audit_messages`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| session_id, client_id | UUID | |
| role | TEXT | `'user'` or `'assistant'` |
| content | TEXT | Full message text |
| tokens_in / tokens_out | INTEGER | Defined in schema, not populated by chat route |

### `documents`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| client_id, session_id | UUID | |
| file_name | TEXT | |
| file_type | TEXT | `xlsx`, `xls`, `csv`, `xml`, `pdf`, `docx`, `doc`, `1c_txt`, `image` |
| file_size | INTEGER | bytes |
| storage_path | TEXT | Path in Supabase Storage bucket `audit-documents` |
| status | `doc_status` ENUM | `'uploading'`, `'processing'`, `'ready'`, `'error'` |
| parsed_data | JSONB | Cached `ParseResult` from `lib/file-parser.ts` |
| page_count | INTEGER | |
| error_msg | TEXT | |
| uploaded_at / processed_at | TIMESTAMPTZ | |

### `usage_events`

Logs `document_upload` events (written by upload route). Schema supports `tokens_in`, `tokens_out`, `cost_rub`, `transactions_ct`, `metadata JSONB`. Most fields are not populated by current code — the chat route does not log AI token usage. The client usage page shows event type and timestamp only.

---

## API Routes

### Auth
| Route | Method | Description |
|---|---|---|
| `/api/auth/login` | POST | `signInWithPassword` via Vercel, sets session cookies, returns role |
| `/api/auth/logout` | POST | **Added July 1, 2026.** `signOut` via Vercel — server-side, mirrors `/api/auth/login`. Added specifically to remove the last direct-browser-to-Supabase call from the two portal layouts (see Session Log). |
| `/api/auth/me` | GET | Returns current Supabase user from cookies |
| `/api/auth/profile` | POST | Returns `role`, `status`, `company_name` for a userId |

### AI & Chat
| Route | Method | Description |
|---|---|---|
| `/api/chat` | POST | Sonnet 5 audit reasoning + tool_use findings extraction (single call) |

### File Handling
| Route | Method | Description |
|---|---|---|
| `/api/upload` | POST | Store file in Supabase Storage, create documents record, background parse |
| `/api/parse-file` | POST | Parse a document by documentId, cache result in documents.parsed_data |

### Billing
| Route | Method | Description |
|---|---|---|
| `/api/audit/calculate-price` | POST | Count transactions (file or live 1C), map to pricing tier |
| `/api/billing/check-limit` | POST | Enforce subscription limits before audit start |

### Data (unified dispatcher)
| Route | Method | Description |
|---|---|---|
| `/api/data` | POST | 19 actions — see action list above |

### Admin
| Route | Method | Description |
|---|---|---|
| `/api/admin/clients` | GET/POST/PATCH/DELETE | Client CRUD |
| `/api/admin/pricing` | GET/POST/PATCH/DELETE | Pricing tier CRUD |

### Reports
| Route | Method | Description |
|---|---|---|
| `/api/report/[id]` | GET | **Orphaned.** Server-side PDF generation — superseded by client-side generator, should be deleted |
| `/api/report/test` | GET | **Dead code.** pdfmake smoke test from development, should be deleted |

---

## Admin Portal

**Authentication:** Client-side guard in `admin/layout.tsx` — calls `/api/auth/me` → `/api/auth/profile` and redirects to `/login` if not admin. No server-side middleware enforcement. Logout now calls `POST /api/auth/logout` (server-side) rather than a client-side Supabase client — see Session Log, July 1.

**Navigation:** Overview · Clients · Pricing

### Overview (`/admin`)
- 8 metric cards: total/active/paused clients, audit sessions, total/critical findings, total revenue (sum of `cost_rub`), unpaid total
- Pure SVG donut chart (zero dependencies): paid vs unpaid audit revenue with percentage breakdown
- Quick action links to create client, manage clients, pricing settings

### Clients (`/admin/clients`)
- Searchable table (company name, contact name, INN)
- Each row shows: company, session count, total billed, unpaid amount, status badge
- **Expandable per-client audit log:** click a row to expand a sub-table of all audit sessions with date, cost, and paid/unpaid toggle button
- Toggle calls `update_session_paid` → flips `audit_sessions.paid`
- Actions per client: Pause/Activate (toggle `status`), Delete (soft delete → `status: 'deleted'`)
- Soft delete pattern: deleted clients are hidden from list (`neq("status", "deleted")`) but data is retained

### New Client (`/admin/clients/new`)
- Form: email + password (required), company name, contact name, INN, phone, admin notes
- Creates Supabase Auth user via `admin.createUser()` with `email_confirm: true` (no email verification sent)
- Manual `upsert` + `update` on `profiles` bypasses the `on_auth_user_created` trigger (trigger reliability workaround, noted inline)
- **No subscription is created** — new clients cannot start audits until a `client_subscriptions` row is manually inserted in Supabase

### Pricing (`/admin/pricing`)
- Full CRUD table for `pricing_tiers`: create, inline edit (all fields), activate/deactivate toggle, delete
- New tiers get `sort_order = max_existing + 1`

---

## Client Portal

**Authentication:** Client-side guard in `client/layout.tsx` — same pattern as admin. Redirects non-clients and paused accounts to `/login`. Logout now calls `POST /api/auth/logout` (server-side) rather than a client-side Supabase client — see Session Log, July 1.

**Chat navigation lock:** "ИИ Аудитор" nav item is greyed out with 🔒 icon until the client has at least one audit session (`get_client_sessions` action, limit 1). First visit forces client to create an audit before they can chat.

**Navigation:** Dashboard · ИИ Аудитор (locked until first audit) · История использования
(Documents page exists at `/client/documents` but its nav item is commented out — page is built and functional but hidden from navigation)

### Dashboard (`/client/dashboard`)
- `useCountUp` custom hook: animates metric numbers from 0 to their value with cubic easing on mount
- Canvas-based animated donut: active vs completed audits
- Canvas-based animated donut: paid vs unpaid cost (same `SvgDonut` component, different data)
- Flat list of open findings across all sessions (last 8), with Russian risk level badges
- Recent sessions list (last 5) → each row links to `/client/audit/{id}`
- "+ Новый аудит" button → `/client/audit/new`

### New Audit Wizard (`/client/audit/new`)

4-step flow: client-info → data-source → processing → confirm

Step 1 — Client info: company name (required), INN, audit period (free-text)

Step 2 — Data source choice:
- **File upload:** accepts `.xlsx`, `.csv`, `.xml`, `.xls`, `.docx`, `.doc` (note: `.txt` for 1C bank exports not included despite full parser support)
- **Live 1C:** URL, database name, username, password for OData REST API connection (`Document_ПоступлениеТоваровУслуг?$count=true`, 10-second timeout). UI warns that 1C server must be internet-accessible with OData enabled.

Step 3 — Processing spinner while upload + parse + price calculation run

Step 4 — Confirm: shows transaction count, tier name, locked price → "Подтвердить и начать аудит" → writes to DB → redirects to chat

### AI Chat (`/client/chat`)

- Accepts optional `?session=` query param to resume a specific session
- **Auto-opening message:** on first load of a new session, automatically sends a system message to `/api/chat` that includes company name, INN, period, transaction count, and locked price, prompting the AI to introduce itself and ask clarifying questions about audit priorities
- **Typewriter effect:** latest assistant message types out character-by-character via `requestAnimationFrame` at 18ms per character with a blinking cursor. Previous messages render instantly.
- **File attachment:** paperclip button accepts `.xlsx`, `.csv`, `.xml`, `.xls`, `.pdf`, `.docx` (mid-chat upload goes through `/api/upload`, then immediately calls `/api/chat`)
- **Textarea auto-resize:** grows with content up to 200px, collapses on send
- **Complete audit button:** "✓ Завершить аудит" sets session status to `completed`, disabling further input. Chat history remains readable.
- Loading indicator: three pulsing dots with staggered CSS animation while AI is responding

### Audit Detail (`/client/audit/[id]`)

Loaded via `audit_detail` action — returns `{session, findings, messages}` in one call.

- Session header: company name, period, status badge, "Открыть чат →" button (if active), "↓ Скачать PDF" button
- 4 mini metric cards: findings count, transactions, cost, date
- **Two canvas-based animated donuts:**
  - ViolationsDonut: findings by risk level (КРИТИЧНО/СУЩЕСТВЕННО/НЕСУЩЕСТВЕННО) with color legend and percentages
  - ResolutionDonut: open vs resolved findings with progress bar and "X из Y нарушений устранено" label
- **Tabbed view:** "Нарушения (N)" | "История чата (N)"
  - Findings tab: grouped by risk level, each finding card shows title, description, legal basis (📋), recommendation (💡 styled box)
  - Chat tab: full message history, same bubble style as chat page

### Documents (`/client/documents`)

Fully built page: drag-and-drop upload zone, documents table with status badges (Загрузка/Обработка/Готов/Ошибка), file type icons, file size formatting. **Not reachable from navigation** — nav item commented out in client layout. Accessible directly at `/client/documents`.

### Usage History (`/client/usage`)

Simple chronological event log from `usage_events` table. Shows event type (mapped to Russian labels) and timestamp. Currently only `document_upload` events are logged; AI message events are not.

---

## Visual Design System

All styling is inline CSS (no CSS modules, Tailwind classes are not used despite Tailwind being installed). Consistent design token palette used throughout:

| Token | Value | Usage |
|---|---|---|
| Background (deepest) | `#050810` | Page background |
| Background (card) | `#0c1220` | Cards, panels |
| Background (sidebar) | `#080c18` | Nav sidebar |
| Background (input) | `#101828` | Form inputs |
| Background (hover) | `#0d1828` | Row hover state |
| Border | `#1e2d55` | Card borders |
| Border (subtle) | `#1a2340` | Row dividers |
| Accent (brand blue) | `#1565e8` | Primary buttons, active nav |
| Accent (light blue) | `#4d91ff` | Admin blue labels |
| Text (primary) | `#e8edf8` | Main content |
| Text (secondary) | `#7a90c0` | Labels, captions |
| Text (muted) | `#3d4f7a` | Placeholder, table headers |
| Risk: КРИТИЧНО (text) | `#e84040` | Critical findings |
| Risk: КРИТИЧНО (bg) | `#3d1515` | Critical badge background |
| Risk: СУЩЕСТВЕННО (text) | `#f59e0b` | Major findings, unpaid |
| Risk: СУЩЕСТВЕННО (bg) | `#3d2e0a` | Major badge background |
| Risk: НЕСУЩЕСТВЕННО (text) | `#2ecc8f` | Minor findings, paid/active |
| Risk: НЕСУЩЕСТВЕННО (bg) | `#0e3d2a` | Minor badge background |

**Three independently-built donut chart renderers exist in the codebase:**
1. Admin dashboard: pure SVG with manually computed arc paths (`arcPath()` function)
2. Client dashboard: Canvas-based with `requestAnimationFrame` animation (`SvgDonut` component — misleading name, it's canvas not SVG)
3. Audit detail page: Canvas-based with different animation algorithm (`DonutCanvas` component, `ViolationsDonut`, `ResolutionDonut`)

These could be consolidated into one shared component.

---

## Dependencies

### Active and used
| Package | Purpose |
|---|---|
| `@anthropic-ai/sdk ^0.96.0` | Claude API calls (Sonnet 5, single-model tool_use) |
| `@supabase/ssr ^0.10.3` | Cookie-based Supabase client for SSR/API routes |
| `@supabase/supabase-js ^2.105.4` | Admin client (service role, bypasses RLS) |
| `fflate ^0.8.3` | XLSX and DOCX unzipping (no native dep needed) |
| `mammoth ^1.12.0` | Legacy .doc binary text extraction |
| `xlsx ^0.18.5` | Legacy .xls binary parsing only (not used for .xlsx) |
| `pdfmake ^0.3.8` | Client-side PDF report generation |
| `react-markdown` | **Added July 4, 2026.** Renders assistant chat messages as real markdown (headers, bold, lists) instead of literal `##`/`**` syntax — see "Chat UX" section below. No `remark-gfm` needed; headers/bold/lists/`---` dividers are all core commonmark. |
| `next 16.2.6` | Framework |
| `react 19.2.4` | UI |

### Installed but unused
| Package | Why installed | Current status |
|---|---|---|
| `pdf-parse ^2.4.5` | PDF content extraction | Installed, never imported. PDF text is not extracted. |
| `papaparse ^5.5.3` | CSV parsing | Installed, never imported. CSV is parsed hand-rolled in `parseCSV()`. |
| `chart.js ^4.4.1` | Charts | Installed, never imported. All charts are hand-rolled canvas/SVG. |

These three add bundle weight with zero benefit and should be removed.

---

## Security Gaps

These are known issues to address before any production deployment.

**1. No server-side auth on API routes.** `/api/data`, `/api/admin/clients`, `/api/admin/pricing`, `/api/chat`, `/api/upload`, and `/api/report/[id]` perform no authentication check. Any caller who knows the endpoint, action name, and a valid `clientId`/`sessionId` can read or write any client's data. Auth guards exist only as client-side React effects in layout components.

**2. Admin routes have no admin role check.** `/api/admin/clients` and `/api/admin/pricing` are intended to be admin-only but have no server-side check that the caller is an admin.

**3. `/api/report/[id]` leaks full audit data unauthenticated.** A `GET` request with any known session UUID returns the full session, findings, and message history as a downloadable PDF. No auth required.

**4. `/api/data` is a single unauthenticated endpoint for all client and admin data operations.** Any action (including admin ones like `admin_stats`, `admin_clients`, `delete_client`) is callable without authentication.

**5. RLS policies are bypassed in all routes.** Supabase Row Level Security is defined on all tables but `createAdminClient()` (service-role key) is used everywhere, making all RLS policies decorative in practice.

---

## Known Technical Debt

| Item | Location | Priority |
|---|---|---|
| `audit_sessions.paid` missing from migrations | `supabase/migrations/` | High — billing feature correctness |
| New client creation doesn't create subscription | `/api/admin/clients` POST | High — blocks first audit |
| Multi-sheet XLS/XLSX only reads sheet 1 | `lib/file-parser.ts` ~line 212, 152 | High — confirmed production gap |
| 1C `.txt` not in any file input `accept` list | Chat page, documents page, new audit wizard | High — flagship parser unreachable |
| `types/index.ts` doesn't match real schema | `types/index.ts` | Medium — misleading to future developers |
| Company/period stored in title string, regex-parsed | `api/data/route.ts` | Medium — fragile, breaks on `(` in name |
| `audit_messages.tokens_in/out` never populated | Chat route | Medium — usage tracking incomplete |
| `transactions` table never written to | All routes | Medium — dead schema |
| `increment_session_cost()` DB function never called | DB function | Low — dead code |
| `period_from`/`period_to` columns never written | `audit_sessions` | Low — dead columns |
| `/api/report/[id]` orphaned server PDF route | `app/api/report/` | Low — delete it |
| `/api/report/test` smoke test | `app/api/report/test/` | Low — delete it |
| Three separate donut chart implementations | Admin dashboard, client dashboard, audit detail | Low — consolidate |
| `proxy.ts` is a no-op | `proxy.ts` | Low — document or remove |
| Unused deps: pdf-parse, papaparse, chart.js | `package.json` | Low — remove |
| Token pricing in `anthropic.ts` vs `billing.ts` inconsistent | Both files | Low — reconcile |

---

## Deployment

### Phase 1 — Demo (Current, Active)

- **Hosting:** Vercel (US)
- **Database:** Supabase PostgreSQL (US)
- **Storage:** Supabase Storage (US)
- **Auth:** Supabase Auth
- **AI:** Claude Sonnet 5 (audit reasoning + tool_use findings extraction, single call)
- **Purpose:** Demo and client acquisition

### Phase 2 — Production (Per Russian Client, On Contract Signing)

Each client gets a **dedicated isolated instance** for data confidentiality and 242-FZ compliance (Federal Law on personal data storage in Russia).

| Component | Phase 2 |
|---|---|
| Hosting | SpaceWeb Cloud VPS — `vps.sweb.ru` |
| Database | SpaceWeb DBaaS Managed PostgreSQL 17 (Russia) |
| Storage | SpaceWeb S3-compatible storage (Russia) |
| Email | SpaceWeb Почта via `assistant24.tech` SMTP (port 465 SSL or 587 TLS) |
| Auth | NextAuth.js + Credentials provider against own PostgreSQL (replace Supabase Auth) |
| AI | GigaChat Max (audit reasoning) + GigaChat Pro (findings extraction) |
| Compliance | 242-FZ compliant (data physically in Russia) |

**Infrastructure account:** SpaceWeb registered at `vps.sweb.ru` ✅, single billing for VPS + DBaaS + S3 + domain.

**GigaChat integration requirements:**
- Register GigaChat B2B API at developers.sber.ru/gigachat
- Download Russian CA certificate from gosuslugi.ru (`russian_trusted_root_ca.cer`) — required for GigaChat SSL
- Create `lib/gigachat.ts` with OAuth2 token caching and Russian CA cert bundle
- System prompt is already in Russian — minor adjustment required for GigaChat compliance

**GigaChat model hierarchy:**
- GigaChat Max → replaces Claude Sonnet 5 (deep audit reasoning + tool_use findings extraction, single call)
- GigaChat Lite → not suitable for audit use
- *(No GigaChat Pro mapping needed — Haiku's old findings-extraction role was folded into the main Sonnet call via tool_use on July 3, 2026, so Phase 2 only needs to replace one model, not two. Confirm GigaChat Max supports function/tool calling before committing to this — if it doesn't, Phase 2 may need to reintroduce a second-call extraction step specific to the GigaChat migration.)*
- **⚠️ Open decision (July 4, 2026):** this entire GigaChat swap may not be necessary. If the privacy pre-processing pipeline (P2 punch list — Russian LLM detects PII, deterministic script tokenizes to hashes like `User_A123`, Sonnet only ever sees tokenized data) is sufficient for 242-FZ compliance, Sonnet could stay the reasoning engine in Phase 2 with only the anonymization *detection* step running on a Russian LLM — keeping Sonnet's reasoning quality instead of trading it for GigaChat's. Needs a deliberate decision before Phase 2 execution starts, not a default.

### Domain Strategy

- **`assistant24tech.ru`** — client deployments (`client1.assistant24tech.ru`, `client2.assistant24tech.ru`, etc.)
  - Registered in SpaceWeb Cloud ✅
  - Paid until 27.05.2027 ✅
  - SSL: ❌ not yet issued — request Let's Encrypt via SpaceWeb Cloud domain panel
  - Автопродление: enable before expiry
  - DNS: add A record per client subdomain → VPS IP
- **`assistant24.tech`** — company homepage and landing pages only
  - SSL ✅ active (via cp.sweb.ru)
  - DDoS protection ✅ active
  - Do not use for client deployments

### CI/CD (Phase 2)

Vercel auto-deploy is unavailable on VPS. Replace with GitHub Actions:

```
Push to main branch
    → GitHub Actions SSH into SpaceWeb VPS
    → git pull
    → npm run build
    → pm2 restart
```

PM2 keeps Next.js running as background process, auto-restarts on crash. Cost: free (GitHub Actions 2,000 min/month). Workflow file: `.github/workflows/deploy.yml` (~30 lines YAML).

### Phase 2 Migration Checklist

**Pre-migration**
- [ ] Register GigaChat B2B API — developers.sber.ru/gigachat
- [ ] Download Russian CA certificate — gosuslugi.ru (`russian_trusted_root_ca.cer`)
- [ ] Enable Автопродление for `assistant24tech.ru` in SpaceWeb Cloud

**Infrastructure**
- [ ] Provision SpaceWeb Cloud VPS
- [ ] Create SpaceWeb DBaaS PostgreSQL 17 instance
- [ ] Create SpaceWeb S3 bucket for audit documents
- [ ] Add DNS A record: `clientN.assistant24tech.ru` → VPS IP
- [ ] Issue SSL certificate (Let's Encrypt via SpaceWeb domain panel)
- [ ] Configure Nginx reverse proxy: subdomain → Next.js port
- [ ] Install PM2: `npm install -g pm2`
- [ ] Whitelist only VPS IP in SpaceWeb DBaaS access rules (never `0.0.0.0/0`)

**CI/CD**
- [ ] Add SpaceWeb VPS SSH key to GitHub Actions secrets
- [ ] Create `.github/workflows/deploy.yml`

**Database**
- [ ] Run migrations 001–004 on SpaceWeb PostgreSQL
- [ ] Manually add `ALTER TABLE audit_sessions ADD COLUMN paid BOOLEAN DEFAULT false` (missing from migrations)
- [ ] Verify all tables: profiles, pricing_tiers, client_subscriptions, audit_sessions, transactions, findings, audit_messages, documents, usage_events

**Code changes**
- [x] ~~Fix multi-sheet XLS/XLSX parser in `lib/file-parser.ts`~~ Done June 30, 2026 — not yet re-verified against real client file on live deploy
- [x] ~~Add `.txt` to file input `accept` attributes~~ Done for documents page + new-audit wizard; chat page attachment button still pending
- [ ] Build subscription creation into new client flow (`/api/admin/clients` POST)
- [ ] Add server-side auth checks to all API routes
- [ ] Swap Supabase DB client → `pg` (node-postgres) → SpaceWeb DBaaS
- [ ] Swap Supabase Storage → `@aws-sdk/client-s3` → SpaceWeb S3 endpoint
- [ ] Install and configure NextAuth.js with Credentials provider
- [ ] Create `lib/gigachat.ts` — OAuth2 token caching, Russian CA cert, Max/Pro config
- [ ] Replace `/api/chat` Anthropic calls with GigaChat client
- [ ] Adjust system prompt for GigaChat (already in Russian — minor only)
- [ ] Configure SpaceWeb Почта SMTP credentials in env vars
- [ ] Remove `@anthropic-ai/sdk`, Supabase env vars
- [ ] Remove unused deps: `papaparse`, `chart.js` (note: `pdf-parse` is now actively used, no longer a removal candidate)
- [ ] Delete `/api/report/[id]` and `/api/report/test` routes

---

## What's Built vs What's Not

### Built and working
- Login with role-based redirect (admin / client)
- Admin portal: dashboard with metrics + paid/unpaid SVG donut chart
- Admin portal: clients list with search, expandable per-audit billing log, paid toggle
- Admin portal: new client creation form
- Admin portal: pricing tiers full CRUD
- Client portal: dashboard with animated canvas donuts, recent audits, open findings
- Client portal: new audit wizard (file upload + live 1C, 4-step flow with price confirmation, now also gates on legal form / tax regime / VAT status — see "Tax-Profile Gate" below)
- Client portal: AI chat with typewriter animation (now 2x speed — CHARS_PER_TICK=2, not interval-shrinking, since requestAnimationFrame clamps below ~16.6ms anyway), file attachment, complete-audit flow, **markdown rendering for finished assistant messages (July 4, 2026)** — real headers/subheaders/bold/lists instead of literal `##`/`**` syntax; typing message still renders plain text to avoid unclosed-markdown glitches mid-animation
- Client portal: audit detail page with findings, chat history, canvas donuts, PDF download
- Client portal: documents page (built, but hidden from navigation)
- Client portal: usage history (event log — minimal data currently)
- File parser: XLSX (multi-sheet), XLS (multi-sheet), CSV, XML, DOCX, DOC, 1C bank export (Windows-1251), PDF text-layer extraction, scanned-PDF → vision rendering, images → native vision
- Chat route now trusts `documents.file_type` (DB-classified) instead of re-deriving type from filename extension — root-cause fix that unlocked `.doc`/`.txt`/`.pdf` routing
- PDF report generation (client-side, pdfmake, full Russian audit report with branding, now includes evidence-confidence label per finding)
- Single-model AI: Sonnet 5 reasoning + tool_use findings extraction in one call (Haiku removed July 3, 2026 — see Session Log)
- **Tax-profile app-level gate (July 4, 2026):** legal form, tax regime, and VAT status are now required dropdowns in the wizard, validated server-side, persisted per-session, and fed to the AI as stated facts instead of being guessed or emergently asked about — see "Tax-Profile Gate" section and Session Log
- **Audit-purpose prompt gate (July 4, 2026):** `AUDIT_SYSTEM_PROMPT` now requires the model's first response in a session to be only a clarifying question about audit purpose (tax risk / bank-check prep / internal control / other) before any full analysis — prompt-only per product decision, not yet stress-tested against repeated runs (see punch list)
- **Communication-style fixes (July 4, 2026):** no more self-introduction/greeting ("Здравствуйте! Меня зовут...") at the start of responses; "Резюме аудитора" is now a required bullet list instead of a prose paragraph
- Pay-per-audit pricing with tier lookup and per-client overrides
- Supabase Storage upload with background parse and result caching
- Server-side-only Supabase auth: login AND logout both proxied through Vercel API routes; no page in the app makes a direct browser-to-Supabase call (full tree audited July 1, 2026)
- Evidence-confidence tier (`ПОДТВЕРЖДЁННОЕ НАРУШЕНИЕ` / `ПРИЗНАК РИСКА` / `КОСВЕННЫЙ ПРИЗНАК`) now persisted end-to-end: system prompt → record_findings tool call → DB column → UI badge → PDF

### Not yet built — Next To-Do (prioritized)

> Priority tiers: **P0** = active security/data-leak risk, fix before any real client data touches production. **P1** = blocks a working demo or core business flow. **P2** = important, not urgent. **P3** = cleanup / low-risk deferred.

**P0 — Security (active risk)**
- [ ] Server-side authentication on API routes — `/api/data`, `/api/admin/*`, `/api/chat`, `/api/upload` currently accept any caller who knows the endpoint/IDs (see Security Gaps section — this is the single biggest open risk in the project)
- [ ] Fix or delete `/api/report/[id]` — currently returns full audit session, findings, and message history as an unauthenticated downloadable PDF to anyone with a valid session UUID

**P1 — Blocks demo / core flow**
- [ ] Subscription creation when creating a new client — new clients currently can't start an audit until someone fixes it manually in Supabase
- [ ] Real-deploy verification of the June 30 PDF/vision + multi-sheet parsing fixes — confirmed to *build*, not yet confirmed working on the live Vercel deploy
- [ ] Run one full end-to-end audit post-deploy and confirm `findings.evidence_status` produces a non-default value (`confirmed`/`indirect`), not just the `risk_flag` default — this check now also needs to confirm the `record_findings` tool_use call itself fires correctly (after the report text, not mid-report, exactly once) since Haiku's separate extraction step was removed July 3, 2026 (see Session Log)
- [ ] 1C live connection — UI is built and the OData call is wired, but has never been tested against a real 1C server

**P2 — Important, not urgent**
- [ ] **Privacy-preserving pre-processing pipeline for LLM calls** (updated July 4 2026, originally July 1). Concrete mechanism confirmed with the client: before documents reach Claude Sonnet, run a detection pass — NER (e.g. Natasha/DeepPavlov) plus a **Russian LLM** as the actual detection/classification step for ФИО (full names) and other personal-data spans (phone numbers, addresses, individual INNs) — then use a **deterministic script** (not an LLM) to replace each span with a unique hash token (e.g. `User_A123`), preserving referential consistency across the document (the same person always maps to the same token) without retaining direct identification. Sonnet receives only the tokenized document and never sees real names; the response is reverse-substituted back using the same script. Code↔value lookup table stored Russia-side.
  **Strategic implication worth deciding explicitly:** if this pipeline is sufficient for 242-FZ compliance on its own, Phase 2 may not need to fully replace Sonnet with GigaChat Max for audit reasoning at all — Sonnet could stay the reasoning engine (keeping its quality) with only the anonymization *detection* step running on a Russian LLM. This is a real branch point in the "GigaChat model hierarchy" plan below, not yet resolved — worth a deliberate decision once this pipeline is scoped, rather than defaulting to full GigaChat migration by inertia.
- [ ] **Counterparty ЕГРЮЛ / shell-company verification** (new, July 4 2026). Currently the AI can only *recommend* a human check ЕГРЮЛ for a suspicious counterparty (e.g. "Проверить контрагента... на предмет реальной хозяйственной деятельности"); it can't do the check itself. Two-part plan discussed with the client:
  - Data sources split by cost: basic registry facts (status/address/director) are available via free-tier APIs (e.g. DaData); shell-company risk scoring (mass-registration flags, affiliations) requires a paid vendor (Kontur.Focus, SPARK-Interfax); asset/financials data is a separate lookup against ГИР БО (`bo.nalog.ru`). Not one API call — a decision on how much of this to automate vs. leave as a human follow-up is still open.
  - Preferred integration pattern: a `check_counterparty` tool on the same Sonnet call, mirroring `FINDINGS_TOOL`'s tool_use pattern — Sonnet decides when a counterparty is worth checking (e.g. already flags >30% concentration) and gets the result back in the same turn, writing the actual finding instead of a "please verify" recommendation.
  - **Blocked on the Phase 2 SpaceWeb migration**, not a Vercel-phase task: this app's entire proxy architecture exists because Anthropic/Supabase access from Russia is restricted, requiring Vercel (outside Russia) to sit in between. Checking a Russian registry/data API is the same class of problem in reverse — a non-Russian-origin server (Vercel) calling into a Russian government/commercial data source may hit its own geo-restrictions or bot protection, unverified either way. A SpaceWeb-hosted VPS (physically in Russia) is the safer place to build this, so it's deferred until that migration rather than risked on the current Vercel deploy.
- [ ] Move off `*.vercel.app` to a custom domain — recommended to reduce risk of collateral IP/SNI-range blocking in Russia (see July 1 Session Log, Part 1)
- [ ] Email notifications (SMTP configured in plan, not in code)
- [ ] `transactions` table population (designed, never written to)
- [ ] AI token usage logging (schema supports it, chat route doesn't write it)
- [ ] `audit_sessions.paid` migration file

**P3 — Cleanup / deferred**
- [ ] Chat page's own attachment-button accept attribute still missing `.txt`/`.doc` (only `.xls,.pdf` currently) — left unpatched on purpose, decide if it should match the other two upload surfaces

---

## Session Log — Vercel → SpaceWeb Migration, Kazakhstan Proxy, Streaming/Timeout Fixes (September 1, 2026)

**Goal, in order of how it actually unfolded:** fix a demo-breaking chat timeout bug → discover Vercel billing was broken → migrate hosting to SpaceWeb → build a Kazakhstan proxy for Anthropic → debug three separate deploy bugs → confirm full end-to-end success.

**1. Root-caused and fixed the "stuck thinking, input locked forever" bug.**
`/api/chat/route.ts` had no `export const maxDuration` set at all — on Vercel Hobby this silently defaults to **10 seconds**, not the 60s the plan actually allows. Combined with a fully-buffered (non-streaming) response that could involve up to 6 sequential Anthropic calls, real audits were virtually guaranteed to 504. Worse, `page.tsx`'s three fetch call sites (`sendMessage`, `sendAutoMessageDirect`, `uploadFilesAndSend`) called `res.json()` with no `!res.ok` check and no try/catch — a 504's HTML error body made `res.json()` throw uncaught, skipping `setLoading(false)` and locking the whole chat input with no recovery except a hard reload.

Fix: set `maxDuration = 60` (later raised to 300 after the Pro upgrade — see below), converted the route to true NDJSON streaming (`anthropic.messages.stream()`, one JSON event per line: `delta`/`done`/`error`/`heartbeat`), and wrapped every client call site in try/catch/finally so `setLoading(false)`/`setTypingIndex(-1)` always run.

**2. Added a 15s heartbeat.** A real case surfaced where Claude took ~150s to produce its first visible text (long internal reasoning before any output). No bytes flowed to the client that whole time; something in the RU→Vercel path (likely an idle-connection timeout on a proxy layer) killed the connection even though the Vercel function itself completed successfully and saved everything to Supabase. Fix: server emits a no-op `{type:"heartbeat"}` event every 15s during any silent gap, purely to keep bytes flowing; client ignores it.

**3. Fixed choppy streaming text.** Real network deltas arrive in bursts (sentence/token-sized chunks), which looked jarring without smoothing. Added a `requestAnimationFrame` loop in `page.tsx` that chases a live-growing `target` string at a steady character-per-tick pace — same pacing idea as the old fake `TypewriterMessage` (now removed), but now driven by real streamed content instead of an already-complete string.

**4. Discovered Vercel billing is broken and can't be fixed easily.** The account's only payment method is a Russia-issued Visa — Vercel accepts the card (no immediate rejection) but cannot actually charge it, leaving the account perpetually in "payment failed" / overdue status with a shutdown threat. This is very likely a sanctions-related card-network restriction, not a Vercel-specific issue, and isn't something to keep retrying.

**5. Decided to migrate off Vercel** to **SpaceWeb** (existing Russian hosting account, already used for other sites via ispmanager on a Kazakhstan VPS at `199.189.249.4`). Confirmed SpaceWeb's **Serverless (beta)** product explicitly supports Next.js SSR/Standalone, with git-push auto-deploy and configurable environment variables — a good fit, avoided the heavier VPS route since a managed deploy target was available.

**6. Built the app on SpaceWeb Serverless.** Platform: "Next.js (SSR/Standalone)", build command `npm run build`, start command `npm run start`. Live at `https://auditor-assistant.sl.swteh.ru`. Confirmed working: login, Supabase (auth + all historical data recovered) — **direct, no proxy needed**. Anthropic calls failed immediately with a generic "communication error," confirming direct Russia→Anthropic access is blocked (also independently confirmed: Kazakhstan is *not* on Anthropic's list of restricted countries, so this is Russia-specific network-level blocking, not an Anthropic account/region restriction).

**7. Built the Kazakhstan VPS proxy for Anthropic only** (Supabase already works directly, so it didn't need one). New subdomain `audit.assistant24info.ru` → same Kazakhstan VPS (`199.189.249.4`) that already runs `audit.o2plus.ru` (an unrelated ingress proxy for the old Vercel app — different vhost, different job). New ispmanager site, Let's Encrypt SSL, nginx `@fallback` block rewritten to `proxy_pass https://api.anthropic.com` with `proxy_buffering off` (critical for streaming) instead of the default PHP/static handling. Verified directly with `curl`, including a realistic-scale test (~28K char system prompt + `tools` param + `stream:true`, 23,579 input tokens) — proxy handles everything correctly, ruling out payload size, streaming, and tool-use as causes of anything that came later.

**8. Chased a persistent 403 "Request not allowed" that turned out to be a much simpler bug than suspected.** The app kept failing even after pointing `lib/anthropic.ts` at the proxy via a new `ANTHROPIC_BASE_URL` env var (SDK client patched to accept an optional `baseURL` override, defaulting to the real Anthropic API when unset). Spent real time investigating red herrings — SDK-vs-curl header fingerprinting, `X-Forwarded-For` leaking Russian origin, stale running processes — before checking the actual Docker build logs, which revealed **`ANTHROPIC_BASE_URL` had never actually been saved in the SpaceWeb panel at all** (the save button had silently failed earlier in the session). Fixed, rebuilt — hit two more unrelated bugs on the way: a corrupted API key value (contained a stray fragment that broke Dockerfile `ENV` parsing entirely) and one transient npm registry timeout during build (`ECONNRESET` on an unrelated package, resolved by just retrying).

**9. Confirmed fully working end-to-end.** Real audit run through SpaceWeb → Kazakhstan proxy → Anthropic completed successfully.

**Not yet done:**
- **This is NOT the "Phase 2 SpaceWeb migration" already described elsewhere in this document.** That planned migration bundles a GigaChat model swap and a 242-FZ compliance/anonymization pipeline; today's move was an unplanned, narrower fix driven purely by the Vercel billing failure. Sonnet/Anthropic is still the reasoning engine (via the new Kazakhstan proxy) — no GigaChat work happened. The Phase 2 Migration Checklist further down this document should be reviewed against what's now actually true (hosting has moved; the compliance/model-swap work has not started) rather than assumed still fully pending.
- Vercel is still live and untouched, intentionally kept as a fallback — not yet decommissioned or pointed away from.
- **Two API keys were exposed in plaintext multiple times during this session's debugging** (pasted directly in build logs shared for troubleshooting): `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. **Both have now been rotated** (confirmed by user) — no outstanding action here, but worth double-checking no other deployment (e.g. Vercel) is still configured with the old, now-revoked values.
- SpaceWeb Serverless is explicitly in beta — no confirmed answer yet on its own execution/timeout limits (the 300s `maxDuration` logic lives in the Next.js app itself, not confirmed as a platform-level constraint on SpaceWeb the way it was on Vercel).
- `audit.assistant24info.ru`'s nginx config currently has no IP allowlisting — anyone who discovers this subdomain could relay requests to Anthropic using whatever key the app has configured. Worth restricting it to SpaceWeb's outbound IP(s) only.

---

## Session Log — Per-Transaction Billing Verified, Rate Set, Landing Page Updated (August 7, 2026)

**Goal:** verify the July 15 per-transaction billing rework end-to-end, set a real global rate, and bring the public landing page's pricing section in line with the new model.

**What happened:**
1. **Billing verified.** Ran real audits for two clients on different rates — one using the global default, one with a `client_subscriptions.custom_price_rub` override — and confirmed both priced correctly (`transactionCount × rate`, correct rate selected in each case). Closes the P1 verification item opened July 15.
2. **Global rate set.** `billing_settings.price_per_transaction_rub` updated in Supabase from the 15.00 ₽ placeholder to **12.5 ₽/transaction** (applied manually via SQL/table editor, not the admin panel, per user preference this session).
3. **Landing page (`audit.html`) rewritten.** Found still showing the old flat 4-tier grid (8 000 ₽ / 15 000 ₽ / 30 000 ₽ / 75 000 ₽ with transaction caps) — stale since the July 15 billing rework, never updated at the time. Replaced with a single pricing card: 12.5 ₽/transaction, cost = count × rate, plus a note directing high-volume prospects (~250k+ tx/month) to contact sales for a custom rate. Section eyebrow changed from "Тарифы" (plural tiers) to "Стоимость" to match. Also fixed a leftover "тариф" reference in the how-it-works step copy.

**Not yet done:** the old `pricing_tiers` table and dead `client_subscriptions` columns (`tier_id`, `custom_max_tx`, `audits_purchased`, `audits_used`) are still not dropped — this session's verification was the explicit blocker noted for that cleanup (see P2 punch-list item), so it can now be unblocked. Drop statements are already written and commented out in `006_transaction_billing.sql`.

---

## Session Log — Duplicate-Findings Fix (August 6, 2026)

**Goal:** close the P1 punch-list item — mid-chat re-analysis (triggered by any document upload) was producing duplicate findings, since the report/record_findings pipeline reruns in full on every turn with no awareness of what was already saved.

**Root cause, confirmed by source review:**
1. **Prompt-level:** `buildAuditContext()` only ever passed `openFindings`/`criticalCount` as bare numbers into the system prompt. Sonnet had no way to know *which* findings were already recorded — only how many — so on every full re-analysis it had no basis to recognize "already reported" and would restate the same violations under the same or slightly reworded titles.
2. **App-level:** `saveFindings()` did an unconditional `insert()` — zero dedup check against the session's existing rows. The `findings` table itself also has no unique constraint that could have caught this at the DB level (confirmed via live schema dump).

**Fix — two layers, as scoped in the punch list:**

- **`lib/anthropic.ts`:**
  - `buildAuditContext()` signature extended with `existingFindings?: { title, risk_level, evidence_status }[]`. When present, renders an actual titled list ("Уже зафиксированные нарушения") into the context block, with an instruction not to re-pass these to `record_findings`.
  - `AUDIT_SYSTEM_PROMPT`'s "ФИКСАЦИЯ НАРУШЕНИЙ ЧЕРЕЗ ИНСТРУМЕНТ" section rewritten: Sonnet is now told to compare newly-identified findings against the existing list and pass only new-or-materially-changed ones to `record_findings`, while still being allowed to *mention* already-known findings in the prose report (e.g. in "Резюме аудитора") for a complete-reading report — the restriction is scoped to the tool call, not the text.

- **`app/api/chat/route.ts`:**
  - Before building the system prompt, now fetches all `open` findings for the session (`title, risk_level, evidence_status`) and passes them into `buildAuditContext` — this is what feeds the prompt-level fix above.
  - `saveFindings()` extended with an `existingTitles: string[]` parameter and a new word-overlap similarity check (`titleSimilarity()` / `normalizeTitle()`): normalizes each title to a set of words (lowercased, punctuation stripped, unicode-aware for Cyrillic, connector words ≤2 chars dropped), computes overlap ratio against the shorter title, and treats ≥70% overlap as a duplicate. Checked against **both** the DB's existing titles **and** other findings within the same `record_findings` batch (Sonnet could in principle emit two near-identical findings in one call, so within-batch dedup matters too). Duplicates are skipped with a `console.warn`, not inserted.
  - This is explicitly a **second, app-level safety net** on top of the prompt fix — the prompt instruction is a request, not an enforced constraint, same reasoning as the existing `toolCallSeen` guard it sits next to.

**Open items:**
- **Not yet verified against a real duplicate case.** The 70% similarity threshold and the >2-character word-length cutoff for "connector words" are untested heuristics, not validated against the actual repeated finding from the original bug report (missing-documents finding appearing as #1/#4/#7 in a real downloaded report). Should be checked against that same scenario, or a fresh equivalent, before this is considered closed. Risk of either direction: threshold too loose → genuinely distinct findings get silently dropped; too strict → duplicates still slip through.
- If the threshold needs tuning, the fix is contained to `titleSimilarity()`/`DUPLICATE_SIMILARITY_THRESHOLD` in `app/api/chat/route.ts` — no schema or prompt changes should be needed for a tuning pass alone.
- Existing-findings fetch only pulls `status = 'open'` rows — resolved/disputed findings are intentionally excluded from the "don't re-report" list (a resolved finding reappearing might be meaningful — e.g. same problem recurring — so it isn't silently swallowed by dedup). Worth confirming this is the intended behavior once tested.

---

## Session Log — Multi-File Chat Attachments (July 15, 2026, later same day)

**Goal:** close the P1 punch-list item — chat only supported attaching one file per message (`handleFileSelect` read `e.target.files?.[0]`, input lacked `multiple`, `uploadAndSend` handled one file per call).

**Key finding that simplified the fix:** `/api/chat`'s `getAllDocumentsContent` already re-fetches *every* document linked to the session on *every* turn — it was never scoped to "the file attached to this specific message." That meant the backend (`app/api/chat/route.ts`, `app/api/upload/route.ts`) needed **zero changes**. This was purely a frontend fix.

**Changes, all in `app/client/chat/page.tsx`:**
- `Message.fileName?: string` → `Message.fileNames?: string[]`.
- New state: `pendingFiles: File[]` replaces `pendingFile: File | null`.
- `handleFileSelect` now reads the full `FileList`, appends to any already-pending files (so the attach button can be used more than once before sending) rather than replacing.
- New `uploadFilesAndSend()` replaces `uploadAndSend()`: loops over pending files, uploading each individually via the unchanged `/api/upload` contract (sequential, not parallel — stops and surfaces an error on the first failed upload rather than sending a partial/confusing set), then makes **one** `/api/chat` call after all uploads succeed (relying on the all-documents-per-turn behavior above).
- `sendMessage()` updated to build `fileNames` from `pendingFiles`, clear the pending list on send, and branch to `uploadFilesAndSend` vs. the plain `/api/chat` call depending on whether files are attached.
- Message rendering: single file chip replaced with a wrapped row of chips, one per attached file.
- Pending-files preview (above the input box): list of files instead of one, each with its own remove (×) button.
- File input: added the `multiple` attribute.
- Attach/send button `disabled`/styling conditionals updated from `!pendingFile` to `pendingFiles.length === 0`.

**Verified:** not yet — user reported "works well" after applying the change and testing manually, but no specific multi-file test scenario (e.g. exact file count, mixed file types) was logged. Treat as working-per-user-report rather than independently verified against edge cases (e.g. one file in a batch failing mid-upload, very large batches).

**Known follow-on effect (expected, not a new bug):** this change makes the **duplicate-findings bug** (existing P1 item, not yet fixed) more visible/impactful — attaching N files in one message now means N documents' worth of content feeding a single `record_findings` call, and if that session already has findings from earlier turns, the duplication surface is larger. This was flagged to the user before the change was made; fixing the duplicate-findings item is the natural next step.

---

## Session Log — Per-Transaction Billing (July 15, 2026)

**Goal:** switch billing from flat per-tier pricing (fixed price per max-transaction bracket) to true per-transaction pricing, following a demo to a large prospective client running ~250,000–300,000 transaction audits/month. Requested capability: admin sets a price per transaction; audit cost = transaction count × rate; per-client custom rate override still supported.

**Schema (`006_transaction_billing.sql`, applied):**
- New `billing_settings` table — single row (`id = 1`, enforced by CHECK), holds `price_per_transaction_rub` (global default rate). Seeded at 15.00 ₽/transaction as a placeholder — **update via the admin pricing tab to the real rate before this goes live for the new client.**
- `client_subscriptions.custom_price_rub` — **repurposed**, not newly added. This column already existed (previously meant as a flat per-audit override tied to a tier) and was confirmed unused live. Now means: per-transaction override rate in RUB; `NULL` = use the global default. Column comment added in the migration documenting this reinterpretation.
- `pricing_tiers` table and the old tier-linkage columns on `client_subscriptions` (`tier_id`, `custom_max_tx`, `audits_purchased`, `audits_used`) are **left in place, not dropped**. FK check confirmed `client_subscriptions.tier_id → pricing_tiers.id` is the only reference to the table. Drop statements are written but commented out in the migration — intentionally deferred until the code below is deployed and confirmed working, to avoid a hard cutover with no rollback path.

**Code changes:**
- `lib/billing.ts` — removed `PricingTier` interface, `checkTierLimit()`, `suggestTier()` (hardcoded tier-price list). Added `calcAuditPrice(transactionCount, ratePerTransactionRub)`. `calcAiCostRub()` (internal AI token-cost tracking, unrelated to client billing) left untouched.
- `app/api/audit/calculate-price/route.ts` — replaced the tier-bracket lookup (`calcPrice()` scanning sorted tiers) with a rate lookup: `client_subscriptions.custom_price_rub` (most recent row for the client) if set, else `billing_settings.price_per_transaction_rub`. Response shape changed from `{ transactionCount, priceRub, tierName }` to `{ transactionCount, priceRub, rateRub, isCustomRate }`. Also fixed a latent bug in the old code: it wrote `tier_name` to `audit_sessions` on update, but that column doesn't exist in the live schema (confirmed via live schema dump this session) — would have silently failed or errored; removed.
- `app/client/audit/new/page.tsx` — `PriceResult` interface updated to match the new response shape; price-breakdown display in the Step 4 confirm screen now shows "Ставка за транзакцию" (rate, with a "(инд.)" tag if it's a custom override) instead of "Тарифный план" (tier name).
- `app/admin/pricing/page.tsx` — full rewrite. Old page was full tier CRUD (create/edit/delete tiers with max_transactions + price_rub). New page: (1) a global-rate editor (single number input + save, reads/writes `billing_settings`), (2) a per-client override table listing all clients with their current rate (custom or "по умолчанию"/default), inline edit, and a "Сбросить" (reset) button to clear back to default.
- `app/api/admin/pricing/route.ts` — full rewrite. `GET` returns the global rate. `PATCH` takes `{ scope: "global", price_per_transaction_rub }` or `{ scope: "client", clientId, custom_price_rub }` (null clears the override). Client-scope PATCH upserts against the client's most recent `client_subscriptions` row (or inserts a new one if none exists).
- `app/api/data/route.ts` — added new `admin_client_rates` action (returns all clients + their current `custom_price_rub`, used by the new pricing-tab table). Fixed `admin_clients` and `client_dashboard` actions, both of which previously joined `pricing_tiers(name, price_rub, ...)` through `client_subscriptions` — these joins would have returned stale/broken tier data post-cutover since the tier table is no longer the source of truth. `client_dashboard` now also computes and returns `effectiveRate` (client override → global fallback), though `app/client/dashboard/page.tsx` doesn't currently consume it — confirmed it only destructures `{ profile, sessions, findings }`, so it needed no changes.
- `app/client/dashboard/page.tsx` — reviewed, **no changes needed**. Confirmed it never referenced tier/pricing fields; all cost display there is computed from `session.cost_rub`, unaffected by this change.

**Open items from this session:**
- **Not yet verified end-to-end against a real deploy.** Only the migration has been run and confirmed; the code changes above have been handed off but not yet observed passing a build or a live test (new-audit wizard → price shown as count × rate → admin tab edits both global and per-client rates). Run one full flow before treating this as done.
- `app/api/admin/pricing` still has **no admin-role check** — same P0 gap as the rest of `/api/admin/*`, unchanged by this session; flagged again for visibility since this route now handles live pricing data for a large prospective client.
- `client_subscriptions` upsert-by-most-recent-row assumption (in the PATCH client-scope handler) may be wrong if subscriptions are meant to be period-scoped (the table has `valid_from`/`valid_to`, suggesting historical rows are expected) — flagged to the user, not yet resolved either way. If period-scoping matters, this should insert a new row instead of updating the latest one.
- Old `pricing_tiers` table, its now-dead columns on `client_subscriptions`, and the admin CRUD/route code for them are still live but unused — cleanup deferred until the new code is confirmed solid in production, per the migration's own comments.

---

## Session Log — PDF/Image Parsing Fixes, Chat File Chip, tool_use Guard (July 4, 2026, evening)

**Goal:** verify the `record_findings` tool_use extraction end-to-end (P1 punch-list item), then fix file-parser gaps found along the way (PDF and images both silently failing).

### Part 1 — record_findings duplicate-call guard

Live test confirmed the common case works (single Sonnet call, `stop_reason: tool_use`, 10 findings saved, no continuation needed). But the code had no guard against the model calling `record_findings` more than once across a `max_tokens` continuation loop — `toolFindings` was `.concat()`-ed with no limit. Fixed in `app/api/chat/route.ts`: added a `toolCallSeen` flag; a second call in the same turn is now logged (`console.warn`) and dropped instead of silently merged. Not yet stress-tested against a real multi-continuation run (report was short enough to finish in one call every time tested).

### Part 2 — PDF parsing, three bugs in sequence

1. **`pdf-parse@2.4.5` API mismatch.** Installed version is a full rewrite (`PDFParse` class, no callable default export) but code called the old v1 function API. Every PDF silently fell back to "could not read PDF." Fixed to use `new PDFParse({data}).getText()` — **later abandoned, see #2.**
2. **Nested `pdfjs-dist` worker untraceable.** `pdf-parse` bundles its own internal `pdfjs-dist` copy; Vercel's file-tracing didn't reliably include its worker `.mjs` file no matter what `serverExternalPackages` said. **Decision: dropped `pdf-parse` entirely.** `parsePDF()` now uses the top-level `pdfjs-dist` directly (`getTextContent()` per page) — the same package already used successfully for scanned-PDF rendering, already correctly externalized. `npm uninstall pdf-parse` recommended.
3. **`workerSrc` config, three failed attempts before the fix:** empty string (falsy, treated as unset) → `require.resolve()` (Turbopack returned a non-string, "Invalid workerSrc type") → `createRequire` (same error) → **fixed** with `new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString()`, the bundler-recognized asset-reference pattern. Also briefly tried switching to the CJS legacy build (`pdf.js` instead of `.mjs`) — doesn't exist in pdfjs-dist v4+, reverted.
4. **Detached ArrayBuffer.** Once PDF parsing worked, `parsePDF()`'s `getDocument()` call was transferring/detaching the shared buffer, so the following `renderPDFPagesAsImages()` call (scanned-PDF → vision path) crashed on the same request. Fixed with `.slice(0)` copies in both functions. Also pre-emptively fixed the same `workerSrc=""` bug in `renderPDFPagesAsImages()`, which hadn't surfaced yet only because the buffer bug fired first.

**Verified working end-to-end** on real client files: a text-layer PDF (`ПРОТОКОЛ №1.pdf`) and a scanned PDF (`Новация 2.pdf`, correctly detected as `likelyScanned: true` and routed to vision) both processed successfully in a live chat session, producing real findings referencing their content.

### Part 3 — Images unreachable, then invisible in UI

1. **Picker filtering images out.** `app/client/chat/page.tsx`'s attachment `accept` attribute had no `.jpg/.jpeg/.png` — server-side handling (`/api/upload`'s `ALLOWED_TYPES`) already supported images correctly, only the picker was blocking selection. One-line fix.
2. **Uploaded file invisible in the chat transcript.** Confirmed working via vision after the accept fix, but the user message bubble never showed which file was attached — `Message` only carried `content` (plain text), not file metadata. Fixed: `Message` type extended with optional `fileName`/`fileType`; `sendMessage()` attaches them; bubble renders a 📎 chip. Chip styling iterated once: initial semi-transparent-white chip blurred into the blue bubble — changed to light background (`#e8edf8`) / dark text (`#0c1220`) for contrast.

**Verified working** on a real session — image upload analyzed correctly by the model (correctly identified an irrelevant recruitment ad and asked for the right document instead of hallucinating a finding from the filename).

### Part 4 — Two bugs found, scoped for next session (not fixed yet)

Found while reviewing a full downloaded PDF report:

1. **Chat only supports single-file attachment.** `handleFileSelect` takes `e.target.files?.[0]` — no `multiple` on the input, no loop over multiple files in `uploadAndSend`.
2. **Re-analysis duplicates findings instead of updating them.** The downloaded report showed the same violation restated near-verbatim 3 times (e.g. "Отсутствие подтверждающих документов" as findings #1, #4, #7; "Новация трудовой задолженности" as #3, #6, #9). Each mid-chat document upload appears to trigger a fresh `record_findings` call that **appends** to the `findings` table rather than checking for/updating an existing matching finding from an earlier turn in the same session. Needs investigation into whether Sonnet is re-stating already-known findings each turn (prompt issue — should only report *new* findings) and/or whether `saveFindings()` needs a dedup/upsert strategy against existing rows for the session.

---



**Trigger:** running the same 71-transaction bank statement through three separate AI runs produced three different behaviors — two full analyses with different risk-tier conclusions on the same facts (concentration risk flipped between СУЩЕСТВЕННО and НЕСУЩЕСТВЕННО; personal-expense mixing flipped the other way), and a third run that stopped to ask clarifying questions (tax regime, audit purpose) before analyzing at all. All three are consistent with the same prompt, because nothing in the prompt governed whether to ask or what to assume.

### Part 1 — Tax-Profile Gate (legal form, tax regime, VAT status)

Moved to a hard application-level gate rather than a prompt instruction, since the whole premise of this session was that non-deterministic sampling can't be trusted to reliably ask (or not ask) about facts that change correctness. Full details in the new "Tax-Profile Gate" section above. Summary: new `audit_sessions` columns (migration `006`), new `lib/audit-constants.ts` as shared source of truth, wizard UI gets three new required fields, `create_audit_session` validates server-side, `confirm_audit` re-validates as defense-in-depth, and the `get_or_create_session` bypass is closed by redirecting the chat page to the wizard instead of calling it when no session ID is present. `buildAuditContext()` now renders these as stated facts.

Product decisions made during this work: captured fresh per-session, not inherited from a client profile (client re-enters every audit); `audit_purpose` stays prompt-only rather than becoming a 4th gate (see Part 2).

### Part 2 — Audit-Purpose Prompt Gate

`AUDIT_SYSTEM_PROMPT` now instructs: if audit purpose hasn't been stated, the model's first response must be only that question, before any report. This directly codifies behavior that was previously emergent (present in one of the three test runs, absent in the other two). **Explicitly flagged as unverified** — this is a prompt instruction, not a code-enforced gate, so it carries the same reliability risk being fixed for the other three fields in Part 1. Added to punch list as an item to test against repeated real runs.

A real contradiction was caught and fixed while writing this: the pre-existing "file is already loaded, start analysis immediately" instruction directly conflicted with "ask about purpose first." Reworded so the model won't claim the file is missing, but also won't skip the purpose question because of that instruction.

### Part 3 — Communication style fixes

Two issues found in real output, fixed via prompt edits only (no code changes):
- Sonnet was self-introducing ("Здравствуйте! Меня зовут ИИ Старший Аудитор...") at the start of responses — emergent, not scripted. Added explicit instruction against this; model is told it's a corporate tool, not a conversational partner.
- "Резюме аудитора" was prose (3–5 sentences) per the original spec, but real output was dense and hard to scan. Changed the spec to require a 4–6 point bullet list instead: what was checked, legal form + tax regime, income/expense sources, key issues, risk rating.

Verified against a real deployed session (screenshot review) — both fixes confirmed working: no greeting, purpose question fired with the tax-profile facts already known and not re-asked, summary rendered as bullets.

### Part 4 — Chat UX: real markdown rendering

The screenshot review in Part 3 surfaced a separate, unrelated problem: the chat page renders message text as plain strings, so headers and bold markdown syntax (`## Резюме аудитора`, `**Уровень риска:**`) were showing up as literal `#` and `*` characters instead of rendering. Fixed in `app/client/chat/page.tsx`:
- Added `react-markdown` dependency (`npm install react-markdown` required — no `remark-gfm` needed)
- Custom themed component overrides for `h1`/`h2`/`h3`/`p`/`strong`/`ul`/`ol`/`li`/`hr`/`code` matching the existing dark palette
- Only applied to **finished** assistant messages — the actively-typing message (via `TypewriterMessage`) still renders as plain text, since partial/unclosed markdown mid-animation (e.g. `**Провер`) would render incorrectly. User messages stay plain text always.
- Iterated twice on the `h3` (finding subheader) style based on visual feedback: first added a background chip + heavy weight (800) to make findings stand out from body text, then reduced weight to 600 per feedback that it read as "too bold," then restored the background chip while keeping the lighter weight per further feedback — final state is background chip + `fontWeight: 600`.
- Also changed the `strong` (bold label) color from `#a9c1f0` to `#4d91ff` — the original was too close in lightness to the body text color (`#e8edf8`) to read as distinct at a glance; reused the same saturated blue already used for `h2`/`h3` accents rather than introducing a third accent color.

**Not yet done:** no `h4`+ style override exists. The prompt only asks for two heading levels (`##`/`###`), so risk is low, but if the model ever emits a deeper heading it will render unstyled against the dark theme.

---

## Session Log — Haiku Removal & Sonnet 5 Upgrade (July 3, 2026)

**Goal:** upgrade `SONNET_MODEL` from Sonnet 4.6 to Sonnet 5, then evaluate whether the Haiku 4.5 findings-extraction step was still worth keeping now that real usage data existed.

### Part 1 — Sonnet 5 upgrade

**Change:** `lib/anthropic.ts` — `SONNET_MODEL` changed from `"claude-sonnet-4-6"` to `"claude-sonnet-5"`.

**Behavior differences vs 4.6 confirmed not to be a problem for this codebase:** Sonnet 5 rejects (400 error) manual `thinking.budget_tokens` config and non-default `temperature`/`top_p`/`top_k`. `app/api/chat/route.ts` was checked — it only sets `max_tokens`, `system`, and `messages` (now also `tools`/`tool_choice`, added in Part 2), no sampling params or manual thinking config, so no incompatibility.

**Not yet done:** `SONNET_PRICING` in `lib/anthropic.ts` was deliberately left at the standard $3/$15-per-1M rate rather than updated to Sonnet 5's introductory $2/$10 rate (valid through August 31, 2026) — bundled into the existing P2 punch-list item about reconciling pricing constants across `lib/anthropic.ts` and `lib/billing.ts`, to fix once rather than twice.

### Part 2 — Haiku removed, consolidated to single-call tool_use

**Investigation:** before deciding whether to drop Haiku, real console usage data from June 30, 2026 (a heavy real-audit-testing day) was reviewed — daily token cost and token usage broken down by model. Haiku accounted for ~$0.20 of a $7.63 daily total (≈2.6%) and 76K of 2.26M total tokens. This settled the cost question: Haiku's presence in the pipeline was not meaningfully reducing spend.

**Decision driver:** cost being negligible shifted the question to quality risk, and the two-call split had already caused a real bug — the `evidence_status` field (fixed July 1, see below) was computed by Sonnet but silently dropped because Haiku's extraction schema didn't request it. A second live risk was identified but not yet observed in production: Haiku's extraction call was gated by a keyword regex (`нарушени`, `критич`, `риск`, `штраф`, etc.) on Sonnet's response text — a finding phrased outside that keyword list would never trigger extraction and would be silently absent from the findings table despite being visible in the chat transcript.

**Fix — consolidated to one Sonnet call with `tool_use`:**
1. **`lib/anthropic.ts`** — removed `HAIKU_MODEL` and `HAIKU_PRICING`. Added `FINDINGS_TOOL`, a `record_findings` tool schema mirroring the fields the old Haiku prompt requested (title, risk_level, evidence_status, description, legal_basis, recommendation), with the same "default to risk_flag, never confirmed on ambiguity" instruction now embedded in the schema description. Appended a new section to `AUDIT_SYSTEM_PROMPT` instructing Sonnet to write the full report first, then call `record_findings` exactly once with everything found — or not call it at all if there's nothing to report.
2. **`app/api/chat/route.ts`** — removed `extractAndSaveFindings()` (the Haiku call, regex gate, markdown-fence-stripping, and fallback JSON parsing) entirely. Replaced with `saveFindings()`, which only validates and inserts what the tool call already produced — no LLM call, no JSON parsing, since `tool_use` input arrives as a typed object from the SDK. The generation loop now attaches `tools: [FINDINGS_TOOL]` and walks every content block in the response instead of assuming `content[0]` is text, since a single response can now legitimately contain a text block and a tool_use block together. `stop_reason: "tool_use"` is treated as a normal completion (model finished the report and made its one findings call), distinct from `stop_reason: "max_tokens"` (real truncation, still auto-continues exactly as before).
3. **DB-side validation intentionally kept**, not removed: `saveFindings()` still checks `risk_level`/`evidence_status` against valid enum sets and defaults ambiguous/missing `evidence_status` to `risk_flag`, never `confirmed`. Tool_use input is schema-*guided* by the tool definition, not schema-*enforced* — the model can still in principle return an out-of-enum value, and that must not silently overstate certainty or corrupt the DB.

**What this closes:** the class of bug that caused the July 1 `evidence_status` incident (a field Sonnet reasons about but a second model's schema doesn't request) is now structurally impossible, since there's no second interpretation step. The keyword-regex extraction gate is also gone — no finding can be silently skipped for not matching a keyword list.

**Not yet verified:** whether Sonnet 5 reliably calls `record_findings` after finishing the report text (not mid-report, not skipped) is a behavioral assumption backed only by the system prompt instruction, not yet confirmed against a real audit. **Run one full end-to-end audit and check `findings_ct`/the `findings` table populates correctly, with correct `evidence_status` values, before treating this as done** — same verification standard already applied to the July 1 fix, now needs to be re-cleared under the new architecture.

**Also updated same session:** `PUNCH_LIST.md` — added a P1 item for the tool_use verification above, updated the P2 pricing-reconciliation item to reflect `HAIKU_PRICING`'s removal, and noted the P3 usage-logging item is simpler now (one `usage` object per chat turn instead of two to reconcile).

---

## Session Log — Russia Login Bypass Fix & Evidence-Confidence Status (July 1, 2026)

**Goal:** fix intermittent login failures without VPN reported ahead of a Moscow demo, then close the evidence-confidence-tier gap identified in a system-prompt review.

### Part 1 — Russia login bypass

**Symptom:** login worked reliably with VPN, but was flaky without it from a Russian connection.

**Investigation path:** `lib/supabase-client.ts`, `lib/supabase-server.ts`, `app/(auth)/login/page.tsx`, and `app/api/auth/login/route.ts` were all confirmed clean — the login POST itself was correctly proxied server-side through Vercel with no direct browser-to-Supabase call. The bug was found one layer downstream, in the two portal layouts that run immediately after a successful login.

**Root cause:** `app/admin/layout.tsx` and `app/client/layout.tsx` both called `createClient()` from `lib/supabase-client.ts` — a legitimate `@supabase/ssr` browser client — solely to have a reference for the logout button's `supabase.auth.signOut()`. Constructing that client is not inert: `@supabase/ssr`'s browser client auto-initializes and, sharing cookies with the server-side session set by `/api/auth/login`, can issue its own direct browser → `*.supabase.co` calls for session validation/refresh. That request bypasses Vercel entirely, silently, with `autoRefreshToken` defaulting to true. This produced exactly the reported symptom: works with VPN, flaky without it, even though the architecture diagram and the login route itself were correct.

**Fix:**
1. Removed `createClient()`/`@supabase/ssr` import from both layouts entirely.
2. Added `POST /api/auth/logout` (`app/api/auth/logout/route.ts`) — runs `signOut()` server-side, cookie-clearing pattern mirrors `/api/auth/login`.
3. Both layouts' `handleLogout()` now call `fetch("/api/auth/logout", { method: "POST" })` instead.

**Full-tree audit performed to rule out the same pattern elsewhere:** every page under `app/` was checked individually for `createClient`/`@supabase/ssr` imports — `documents/page.tsx`, `admin/clients/page.tsx`, `admin/clients/new/page.tsx`, `admin/pricing/page.tsx`, `client/chat/page.tsx`, `client/audit/new/page.tsx`, `client/audit/[id]/page.tsx`, `client/dashboard/page.tsx`, `admin/page.tsx` — all clean, all already routed through `/api/*`. The two layouts were the only offenders.

**Not fully closed:** `*.vercel.app` is shared hosting infrastructure; Roskomnadzor blocking sometimes targets IP ranges/SNI rather than specific sites, so collateral blocking unrelated to this app's own code is still possible. Recommended follow-up: move off the `.vercel.app` URL to a custom domain (`assistant24tech.ru` subdomain, CNAME'd to Vercel) before the next Russia-based demo.

**Verified:** login tested from a real Russian connection with VPN off after deploy — confirmed working.

### Part 2 — Evidence-confidence status gap

**Found during:** a review of `AUDIT_SYSTEM_PROMPT` for professional/senior-auditor tone and rigor.

**Root cause:** the prompt has always mandated a `**Статус:**` field per finding (`Подтверждённое нарушение` / `Признак риска` / `Косвенный признак`) as a confidence tier distinct from risk-level severity — but the Haiku extraction step's JSON schema in `app/api/chat/route.ts` never asked for it. Sonnet computed the distinction; Haiku discarded it before the DB write. A proven violation and a weak indirect signal were indistinguishable in the dashboard and downloadable PDF.

**Fix:**
1. **Migration `005_finding_evidence_status.sql`** — adds `finding_evidence_status` ENUM (`confirmed`/`risk_flag`/`indirect`) and `findings.evidence_status` column, default `'risk_flag'`. Verified against live schema before writing (confirmed no drift on `findings`; separately reconfirmed `audit_sessions.paid` is live and still absent from migration files — pre-existing gap, unchanged).
2. **`lib/billing.ts`** — added `EvidenceStatus` type + `getEvidenceStatusLabel/Color/BgColor()` helpers, deliberately a different color palette from risk-level badges so the two axes never visually blur.
3. **`app/api/chat/route.ts`** — Haiku extraction prompt now requests `evidence_status`, with explicit Russian-text-to-enum mapping rules. Defaults to `risk_flag` — never `confirmed` — whenever the source text is ambiguous or the field is missing, so extraction can never overstate certainty. `max_tokens` for the Haiku call raised 1500 → 4096 (longer reports can produce more findings to extract as JSON than the old cap allowed).
4. **`app/client/audit/[id]/page.tsx`** — confidence badge added next to the risk-level badge in the on-screen findings list; also added to the client-side PDF generator's per-finding block (italic label under the title).
5. **`app/client/dashboard/page.tsx`** — same badge added to the "Открытые нарушения" panel for consistency.

**Verified:** migration applied cleanly on live Supabase (`information_schema.columns` confirms `evidence_status`/`USER-DEFINED`). **Not yet independently confirmed post-deploy that a real Sonnet→Haiku round trip produces a non-default value (`confirmed`/`indirect`)** — only backfilled/pre-migration rows and a preliminary (non-full) test were checked, all showing the `risk_flag` default as expected. Run one full audit end-to-end and check `findings.evidence_status` on a fresh row before treating this as fully verified.

### Part 3 — Local git repo location

Confirmed via file explorer: `.git` is at `H:\AI Work\audit-agent\ai-senior-auditor`, one level deeper than `H:\AI Work\audit-agent` (where git commands were initially — incorrectly — being run, producing `fatal: not a git repository`). No repo content was lost; this was purely a wrong-working-directory issue. Noted at the top of this doc to prevent recurrence.

---

## Session Log — File Parsing & Chat Route Overhaul (June 30, 2026)

**Goal:** fix the file-parsing gaps from the original punch list (multi-sheet XLSX/XLS, `.txt` unreachable from UI, no PDF support) plus a UI polish request (typewriter speed).

**What changed:**
1. `app/client/chat/page.tsx` — typewriter effect doubled in speed via `CHARS_PER_TICK = 2` (interval kept at the original frame-safe 18ms; shrinking the interval alone wouldn't have worked since RAF clamps to the display refresh rate, ~16.6ms on 60Hz).
2. `lib/file-parser.ts` — `parseXLSX()`/`parseXLS()` rewritten to read all sheets with real sheet-name resolution; added `parsePDF()` (text-layer extraction via `pdf-parse`) and `renderPDFPagesAsImages()` (scanned-PDF rasterization via `pdfjs-dist` + `@napi-rs/canvas`, capped at 10 pages).
3. `app/api/chat/route.ts` — `getAllDocumentsContent()` rewritten to trust the DB's `file_type` column instead of re-deriving from filename extension (the actual root cause of `.doc`/`.txt`/`.pdf` being silently mis-parsed). Images now routed to native vision as base64 blocks on the outgoing message.
4. `app/client/documents/page.tsx` — `.xls`, `.doc`, `.txt` added to file picker `accept`; missing file-type icons (xls, doc, 1c_txt) added.
5. `app/client/audit/new/page.tsx` — `.txt` added to file picker `accept`.
6. `next.config.ts` — added `serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"]` so Turbopack stops trying to bundle their native/WASM bindings into an ESM chunk.

**Deploy issues hit and fixed (two failed Vercel builds before a clean one):**
- Build 1: TS error — `(await import("pdf-parse")).default` doesn't exist on the installed version's ESM type declarations. Fixed by casting the import to `any` and falling back to the namespace itself (`pdfParseModule.default ?? pdfParseModule`).
- Build 2: Turbopack failed to bundle `@napi-rs/canvas`'s native binding (`js-binding.js` — "non-ecmascript placeable asset"). Fixed via `serverExternalPackages` in `next.config.ts`.
- Build 3: the `any`-typed pdf-parse cast leaked into `rawText`/`numPages`, causing an implicit-`any` error on a downstream `.filter(l => ...)` callback. Fixed by explicitly typing `rawText: string` and `numPages: number` at the point they're read from `result`.
- **As of this writing, the build has not yet been confirmed clean past build 3** — last known state is the fix was pushed, no build log reviewed yet to confirm success.

**Explicitly NOT done / open items from this session:**
- No real Vercel deployment has been confirmed working end-to-end yet — only confirmed to *build*. Cold-start latency, function bundle size, and whether `@napi-rs/canvas`'s prebuilt binary actually matches Vercel's runtime are all still unverified.
- Multi-sheet parser fix not yet re-tested against the real 135+178 row client file post-deploy.
- Scanned-PDF rendering not yet tested against a real scanned document.
- Chat page attachment button's `accept` attribute still excludes `.txt`/`.doc` — left as-is pending a decision.
- Mixed-content PDFs (typed + handwritten) will misclassify per the whole-document averaging heuristic — known limitation, not fixed.

**Suggested next session starting point:** confirm the latest Vercel build is green, then do real-file testing (multi-sheet XLS, 1C `.txt`, text PDF, scanned PDF) against the live deploy before moving to the next punch-list item (P0 auth checks are still the biggest open risk — see PUNCH_LIST.md).
