# AI Senior Auditor — Project Status

> Last updated: June 2026. Reconstructed from full source code review.
> GitHub: https://github.com/Aris1672/Ai--senior-audit
> Live demo: https://ai-senior-audit.vercel.app
> Admin login: support@assistant24.tech (role set manually in Supabase)

---

## Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js App Router, TypeScript | 16.2.6 |
| Runtime | React | 19.2.4 |
| Database + Auth | Supabase (PostgreSQL + Auth + Storage) | @supabase/supabase-js 2.105.4 |
| Hosting / Proxy | Vercel | — |
| AI — primary | Claude Sonnet 4.6 | @anthropic-ai/sdk 0.96.0 |
| AI — extraction | Claude Haiku 4.5 | same SDK |
| XLSX parsing | fflate (hand-rolled) + xlsx (legacy .xls only) | 0.8.3 / 0.18.5 |
| DOCX parsing | fflate (hand-rolled) | same |
| DOC parsing | mammoth | 1.12.0 |
| PDF generation | pdfmake | 0.3.8 |

---

## Architecture: Russia → Vercel Proxy

All external calls are routed through Vercel serverless functions because direct connections from Russia to Supabase and Anthropic are blocked by local network restrictions.

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

---

## AI Agent: Hybrid LLM Architecture

### Models

| Model | Role | Max tokens |
|---|---|---|
| Claude Sonnet 4.6 (`claude-sonnet-4-6`) | Main audit reasoning — deep legal and financial analysis | 4096 |
| Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | Findings extraction — cost-efficient JSON parsing only | 1500 |

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
    ├─ Claude Sonnet 4.6 → full audit analysis (4096 tokens)
    │   └─ Deep legal reasoning, Russian regulatory citations, risk classification
    │
    └─ Response text contains violation keywords?
        ├─ NO  → save message to DB, return
        └─ YES → Claude Haiku 4.5 → extract structured JSON findings (1500 tokens)
                  └─ Parse findings JSON → validate risk levels → insert into findings table
                  └─ Increment findings_ct on audit_sessions
                  (Both DB writes run in parallel via Promise.all)
```

**Cost rationale:** Haiku is ~5× cheaper than Sonnet. Findings extraction is pure JSON parsing with no reasoning required, so Haiku is used only for that step. Haiku is only called when the Sonnet response contains at least one of: `нарушени`, `критич`, `риск`, `штраф`, `КРИТИЧНО`, `СУЩЕСТВЕННО`, `НЕСУЩЕСТВЕННО` (regex gate).

**Haiku JSON extraction is hardened against model non-compliance:**
1. Strip markdown fences (``` json ``` — Claude sometimes ignores system prompt instructions)
2. `JSON.parse()` the cleaned string
3. On failure: regex scan for `[{...}]` pattern anywhere in the response
4. On second failure: log warning and silently skip (findings extraction is non-critical — never throws)

### System Prompt (`lib/anthropic.ts` — `AUDIT_SYSTEM_PROMPT`)

The system prompt is written entirely in Russian and instructs the AI to operate as a senior corporate auditor for Russian enterprises. Key capabilities defined:

**Regulatory framework:** ФЗ №402-ФЗ (accounting), ПБУ 1–24 (accounting standards), НДС гл.21 НК РФ, налог на прибыль гл.25 НК РФ, НДФЛ гл.23 НК РФ, ФНС/ПФР/СФР/Росстат requirements, ФСАД (federal audit standards).

**Three-tier evidence confidence system:**
- `ПОДТВЕРЖДЁННОЕ НАРУШЕНИЕ` — only when data directly and unambiguously proves the violation
- `ПРИЗНАК РИСКА` — possible problem requiring additional documents; must name the specific docs needed
- `КОСВЕННЫЙ ПРИЗНАК` — weak signal requiring monitoring only

**Three-tier risk classification (used throughout DB and UI):**
- `КРИТИЧНО` — direct tax sanctions, fraud indicators, balance sheet distortion >5%, cash-out patterns, missing primary documents on material transactions
- `СУЩЕСТВЕННО` — PBU methodology violations, partial missing docs affecting tax base, systematic account correspondence errors, missed ФНС/СФР deadlines
- `НЕСУЩЕСТВЕННО` — technical errors without tax impact, single document deficiencies without financial consequences

**Anti-hallucination constraints:** Explicitly prohibits citing specific legal articles without certainty, inventing document details or counterparty data, making legal conclusions without direct data support.

**Transaction analysis checklist:** Document verification (ТОРГ-12, УПД, Счёт-фактура, КС-2/КС-3, ЕГРЮЛ), account correspondence validation, anomaly detection (duplicate payments, round-number transactions, after-hours operations 22:00–06:00 МСК, manual journal entries bypassing 1C workflow, shell company indicators), quantitative flags (payments >200% of per-counterparty average, >30% payment concentration on one counterparty).

**Mandatory output format:** Each finding must include: risk level, status, description with supporting data, legal basis, confirming data points from the document, recommendation with timeframe.

**Report structure:** Auditor summary (3–5 sentences) → confirmed violations (by descending risk) → risk indicators → indirect indicators → quality assessment → priority recommendations (max 5, numbered).

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

**1C Client Bank Exchange parser** is the most complete parser in the system. Capabilities:
- Detects files by magic string `1CClientBankExchange` (first 64 bytes) via `is1CClientBankExchange()`
- Hand-coded Windows-1251 (CP1251) → UTF-16 decoder with hardcoded 128-entry byte table — zero external dependencies, works on all runtimes including Vercel Edge
- Parses `СекцияРасчСчет` block to a typed `C1AccountSummary`: account number, period start/end, opening/closing balance, total credits, total debits
- Parses all `СекцияДокумент…КонецДокумента` blocks to typed `C1Transaction[]`: payer/receiver INN, bank, BIK, BIC, payment purpose, direction (credit/debit), payment type
- Outputs CSV-style text with a balance summary header for AI consumption, capped at 500 transactions / 50K chars

### XML heuristic detection

1. Try known 1C and generic transaction tag names: `ХозяйственнаяОперация`, `Документ`, `Document`, `transaction`, `Transaction`, `entry`, `Entry`, `record`, `Record`, `row`, `Row`
2. If none match: frequency-analyse all tags in the document, use the most-repeated tag as the row element

### Known gaps

**Multi-sheet XLS/XLSX:** Both `parseXLSX()` and `parseXLS()` read only the first sheet (`xl/worksheets/sheet1.xml` / `workbook.SheetNames[0]`). For 1C XLS exports with two sheets (e.g. "Без подтверждающих документов" + "Полный список"), the second sheet is silently ignored. Fix location: `parseXLSX()` line ~212, `parseXLS()` line ~152. **This is a confirmed production gap tested with a real 135-row client file.**

**PDF content extraction:** PDF files are accepted for upload and stored in Supabase Storage, but no PDF parser exists in `file-parser.ts`. `pdf-parse` is installed as a dependency but never called. PDFs reach the AI context only with a `[Документ: X — ошибка загрузки]` placeholder.

**1C `.txt` unreachable from UI:** The 1C bank statement parser is fully built, but the file input `accept` attribute on all three upload surfaces (Documents page, chat page attachment, new-audit wizard) does not include `.txt`. Users cannot select 1C bank export files through normal file picking without bypassing the browser's file filter.

**Fallback byte-size estimation:** Every parser's `catch` block returns `parseMethod: "fallback"` with `rowCount: Math.floor(buffer.byteLength / 200)`. This produces a plausible-looking but fictitious row count that flows into the billing `calculate-price` route, potentially resulting in incorrect pricing on parse failure.

---

## Pricing & Billing System

### Default tiers (seeded in `002_billing_and_tiers.sql`)

| Tier | Max transactions | Price |
|---|---|---|
| Базовый | 500 | 8 000 ₽ |
| Стандарт | 2 000 | 15 000 ₽ |
| Профи | 5 000 | 30 000 ₽ |
| Корпоратив | 20 000 | 75 000 ₽ |

Tiers are fully editable from the admin panel. Custom per-client price and transaction limit overrides are supported via the `client_subscriptions.custom_price_rub` and `custom_max_tx` columns.

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
| `get_or_create_session` | Chat page (no session param) | Latest active session or new one |
| `save_message` | Chat page | Insert to audit_messages |
| `update_client_status` | Admin clients page | profiles.status |
| `create_audit_session` | New audit wizard | Insert audit_sessions |
| `confirm_audit` | New audit wizard | Write cost_rub + transactions_ct to session |
| `get_session_context` | Chat page (with session param) | Session data + company/period parsed from title |
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

---

## Database Schema

Migrations: `supabase/migrations/001–004.sql`

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
| findings_ct | INTEGER | Incremented by chat route after Haiku extraction |
| cost_rub | NUMERIC(10,2) | Set by `confirm_audit` action |
| paid | BOOLEAN | **Not in migration file** — added outside version control |
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
| risk_level | `risk_level` ENUM | `'КРИТИЧНО'`, `'СУЩЕСТВЕННО'`, `'НЕСУЩЕСТВЕННО'` |
| risk_score | INTEGER | Not populated by current extraction |
| title | TEXT | Max 100 chars (enforced in app) |
| description | TEXT | Max 500 chars |
| legal_basis | TEXT | Max 200 chars |
| recommendation | TEXT | Max 300 chars |
| status | `finding_status` ENUM | `'open'`, `'resolved'`, `'disputed'` |

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
| `/api/auth/me` | GET | Returns current Supabase user from cookies |
| `/api/auth/profile` | POST | Returns `role`, `status`, `company_name` for a userId |

### AI & Chat
| Route | Method | Description |
|---|---|---|
| `/api/chat` | POST | Sonnet 4.6 audit reasoning + conditional Haiku 4.5 findings extraction |

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

**Authentication:** Client-side guard in `admin/layout.tsx` — calls `/api/auth/me` → `/api/auth/profile` and redirects to `/login` if not admin. No server-side middleware enforcement.

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

**Authentication:** Client-side guard in `client/layout.tsx` — same pattern as admin. Redirects non-clients and paused accounts to `/login`.

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
| `@anthropic-ai/sdk ^0.96.0` | Claude API calls (Sonnet + Haiku) |
| `@supabase/ssr ^0.10.3` | Cookie-based Supabase client for SSR/API routes |
| `@supabase/supabase-js ^2.105.4` | Admin client (service role, bypasses RLS) |
| `fflate ^0.8.3` | XLSX and DOCX unzipping (no native dep needed) |
| `mammoth ^1.12.0` | Legacy .doc binary text extraction |
| `xlsx ^0.18.5` | Legacy .xls binary parsing only (not used for .xlsx) |
| `pdfmake ^0.3.8` | Client-side PDF report generation |
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
- **AI:** Claude Sonnet 4.6 (audit) + Claude Haiku 4.5 (findings extraction)
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
- GigaChat Max → replaces Claude Sonnet 4.6 (deep audit reasoning)
- GigaChat Pro → replaces Claude Haiku 4.5 (findings extraction)
- GigaChat Lite → not suitable for audit use

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
- [ ] Fix multi-sheet XLS/XLSX parser in `lib/file-parser.ts`
- [ ] Add `.txt` to file input `accept` attributes (chat page, documents page, new audit wizard)
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
- [ ] Remove unused deps: `pdf-parse`, `papaparse`, `chart.js`
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
- Client portal: new audit wizard (file upload + live 1C, 4-step flow with price confirmation)
- Client portal: AI chat with typewriter animation, file attachment, complete-audit flow
- Client portal: audit detail page with findings, chat history, canvas donuts, PDF download
- Client portal: documents page (built, but hidden from navigation)
- Client portal: usage history (event log — minimal data currently)
- File parser: XLSX, XLS, CSV, XML, DOCX, DOC, 1C bank export (Windows-1251)
- PDF report generation (client-side, pdfmake, full Russian audit report with branding)
- Hybrid AI: Sonnet 4.6 reasoning + Haiku 4.5 findings extraction
- Pay-per-audit pricing with tier lookup and per-client overrides
- Supabase Storage upload with background parse and result caching

### Not yet built
- [ ] Multi-sheet XLS/XLSX parser
- [ ] `.txt` file input support for 1C bank exports
- [ ] Subscription creation when creating a new client
- [ ] Server-side authentication on API routes
- [ ] Email notifications (SMTP configured in plan, not in code)
- [ ] 1C live connection — UI is built and the OData call is wired, but needs real 1C server testing
- [ ] Report sharing via URL (server-side PDF route existed but was orphaned)
- [ ] `transactions` table population (designed, never written to)
- [ ] AI token usage logging (schema supports it, chat route doesn't write it)
- [ ] `audit_sessions.paid` migration file
