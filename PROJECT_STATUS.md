# AI Senior Auditor — Project Status

## Stack
- Next.js 16.2.6 (App Router, TypeScript)
- Supabase (Auth + PostgreSQL + Storage)
- Claude Sonnet 4.6 + Claude Haiku 4.5 (hybrid) via Anthropic API
- Vercel (proxy for all external calls — Russia restriction)
- GitHub: https://github.com/Aris1672/Ai--senior-audit

## Live URL
https://ai-senior-audit.vercel.app

## Admin Login
- Email: support@assistant24.tech
- Role: admin (set manually in Supabase)

## Architecture
All DB and AI calls go through Vercel API routes.
Browser (Russia) → Vercel → Supabase/Anthropic
Never direct from Russia to Supabase or Anthropic.

## LLM Hybrid Architecture (Demo)

| Model | Role | Where used | Max tokens |
|---|---|---|---|
| **Claude Sonnet 4.6** | Main audit reasoning | `/api/chat` — primary response | 4096 |
| **Claude Haiku 4.5** | Findings extraction | `/api/chat` — post-processing only | 1500 |

**Flow:**
```
User message
    → Sonnet 4.6 — full audit analysis (deep legal + financial reasoning)
                        ↓
           Response contains violation keywords?
                        ↓ yes
           Haiku 4.5 — extract structured JSON findings (cost-efficient)
                        ↓
           Save findings to DB (findings table)
```

**Cost rationale:** Haiku is ~5x cheaper than Sonnet. Findings extraction is pure JSON parsing — no deep reasoning needed — so Haiku is the right tool for that step.

**Files:**
- `lib/anthropic.ts` — model constants, pricing, system prompt, context builder
- `app/api/chat/route.ts` — hybrid call logic

---

## LLM Selection Testing — GigaChat vs YandexGPT (Phase 2 Decision)

Three rounds of testing conducted with a real 1C bank transaction file (Апрель–Сентябрь 2024, 135 operations, 7 461 326.61 руб.).

### Test Results Summary

| Category | GigaChat Max | YandexGPT 5 Pro |
|---|---|---|
| Quantitative accuracy | ⭐⭐⭐ | ⭐ |
| Finding depth | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Legal citations | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| System prompt compliance | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| Hallucination resistance | ⭐⭐⭐ | ⭐ |
| Actionability | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Overall** | **⭐⭐⭐⭐** | **⭐⭐** |

### Key Findings
- GigaChat correctly cited ст. 54.1 НК РФ (anti-abuse), ст. 252 НК РФ, ФСАД 8/2018 — YandexGPT missed these entirely
- GigaChat found the duplicate payment (ИП Радюков, 70 000 руб.) — YandexGPT missed it in all tests
- YandexGPT produced wildly wrong totals (24.8M руб. vs actual 7.46M руб.) — disqualifying for a financial audit tool
- GigaChat correctly identified card2card payments to individuals with specific row references

### XLS Multi-Sheet Discovery
The 1C XLS export contains **two sheets**:
- **Sheet 1 "Без подтверждающих документов"** — 135 rows, Apr–Sep 2024, 7 461 326.61 руб. (audit focus)
- **Sheet 2 "Полный список"** — 178 rows, full transaction list including partially documented operations

**Action required:** Update `lib/file-parser.ts` to handle multi-sheet XLS files and expose both sheets to the audit agent for complete analysis.

**Critical rule confirmed by testing:** Never send raw XLS binary files directly to the LLM. Always use `lib/file-parser.ts` to parse and convert to structured text first. The existing parser architecture is correct and essential.

### Decision
**GigaChat Max confirmed as Phase 2 LLM** for main audit reasoning.
**GigaChat Pro** for findings extraction (replaces Haiku 4.5).

---

## Deployment Strategy

### Phase 1 — Demo (Current)
Keep the existing stack as-is for demo and client acquisition:
- Vercel + Supabase + Claude Sonnet 4.6 (audit) + Claude Haiku 4.5 (findings extraction)
- Used to demonstrate the product and close first contracts

### Phase 2 — Production (Per Russian Client, on contract signing)
When a client is ready to sign, spin up a **dedicated instance** for that client with a fully compliant Russian stack.

**Infrastructure provider: SpaceWeb Cloud** (`vps.sweb.ru`) — account registered, domain purchased, single billing, all services in one place.

| Component | Demo (Current) | Production (Per Client) |
|---|---|---|
| Hosting | Vercel (US) | SpaceWeb Облачный сервер / VPS (Russia) |
| Database | Supabase PostgreSQL (US) | SpaceWeb DBaaS — Managed PostgreSQL 17 (Russia) |
| File Storage | Supabase Storage (US) | SpaceWeb S3-хранилище — S3-compatible (Russia) |
| Email | — | SpaceWeb Почта — SMTP via `assistant24.tech` |
| Auth | Supabase Auth | NextAuth.js + own PostgreSQL |
| LLM | Sonnet 4.6 (audit) + Haiku 4.5 (findings extraction) | GigaChat Max (audit) + GigaChat Pro (findings extraction) |
| Compliance | Demo only | Federal Law No. 242-FZ compliant |

### Why SpaceWeb
- Account already registered at `vps.sweb.ru` ✅
- DBaaS = managed PostgreSQL 17, no manual DB admin
- S3-compatible storage = near-zero code changes (swap endpoint URL only)
- Single billing for all infrastructure
- Physically located in Russia — fully 242-FZ compliant

### Why Dedicated Instances
- Each Russian client gets their own isolated deployment
- Satisfies 242-FZ (personal data stored on Russian servers)
- Data isolation between clients — critical for audit confidentiality

### GigaChat Model Hierarchy (Production)
- **GigaChat Max** — deep document analysis, risk assessment, complex audit queries (replaces Sonnet 4.6)
- **GigaChat Pro** — findings extraction, summaries, follow-up questions (replaces Haiku 4.5)
- **GigaChat Lite** — not suitable for audit use

### Domain Strategy
- **`assistant24tech.ru`** — dedicated to AI Senior Auditor client deployments ✅
  - Registered in SpaceWeb Cloud (`vps.sweb.ru`) ✅
  - Paid until 27.05.2027 ✅
  - SSL: ❌ not yet issued — request Let's Encrypt via SpaceWeb Cloud domain panel (free, auto-renews every 90 days)
  - Автопродление: enable before expiry
  - Per client: `client1.assistant24tech.ru`, `client2.assistant24tech.ru`, etc.
  - DNS: add A record in SpaceWeb Cloud pointing subdomain → VPS IP
- **`assistant24.tech`** — kept separate, company homepage and landing pages only. Do not use for client deployments.
  - SSL ✅ active (via `cp.sweb.ru`)
  - DDoS protection ✅ active

### SMTP / Email
- **Resolved** — SpaceWeb Почта on `cp.sweb.ru` with `assistant24.tech` is already available
- Configure Next.js app with SpaceWeb SMTP credentials (port 465 SSL or 587 TLS)
- No Yandex 360 or external mail provider needed

### CI/CD — GitHub Actions + PM2
- Vercel auto-deploys are lost on VPS — replace with GitHub Actions
- On every push to `main`: GitHub Actions SSH into VPS → `git pull` → `npm run build` → `pm2 restart`
- PM2 keeps Next.js running as background process, auto-restarts on crash
- Cost: free (GitHub Actions 2,000 min/month)
- Workflow file: `.github/workflows/deploy.yml` (~30 lines YAML)

### External Dependencies (Phase 2)
| Dependency | Where | Status |
|---|---|---|
| GigaChat B2B API | developers.sber.ru/gigachat | 🔲 Need to register |
| Russian CA certificate | gosuslugi.ru (free download) | 🔲 Required for GigaChat SSL |

### Phase 2 Migration Checklist (per client)
**Before starting**
- [ ] Register GigaChat B2B API — developers.sber.ru/gigachat
- [ ] Download Russian CA certificate — gosuslugi.ru (`russian_trusted_root_ca.cer`)
- [ ] Enable Автопродление for `assistant24tech.ru` in SpaceWeb Cloud

**Infrastructure (SpaceWeb Cloud)**
- [ ] Provision SpaceWeb Cloud VPS (`vps.sweb.ru` → Виртуальные серверы)
- [ ] Create SpaceWeb DBaaS PostgreSQL 17 instance (398 ₽/мес, enable replicas)
- [ ] Create SpaceWeb S3 bucket for audit documents
- [ ] Add DNS A record: `clientN.assistant24tech.ru` → VPS IP
- [ ] Issue SSL certificate for the subdomain (already have SSL on root domain)
- [ ] Configure Nginx reverse proxy on VPS (subdomain → Next.js port)
- [ ] Install PM2 on VPS (`npm install -g pm2`)
- [ ] Whitelist only VPS IP in SpaceWeb DBaaS access rules (never 0.0.0.0/0)

**CI/CD**
- [ ] Add SpaceWeb VPS SSH key to GitHub Actions secrets
- [ ] Create `.github/workflows/deploy.yml` — auto deploy on push to `main`

**Database**
- [ ] Run existing migration files (001–004) on SpaceWeb PostgreSQL
- [ ] Verify all tables: profiles, pricing_tiers, client_subscriptions, audit_sessions, transactions, findings, audit_messages, documents, usage_events

**Code changes**
- [ ] Update `lib/file-parser.ts` — handle multi-sheet XLS files, expose both sheets to audit agent
- [ ] Swap Supabase DB client → `pg` (node-postgres) pointed at SpaceWeb DBaaS
- [ ] Swap Supabase Storage → `@aws-sdk/client-s3` pointed at SpaceWeb S3 endpoint
- [ ] Install NextAuth.js, configure Credentials provider against own PostgreSQL (biggest dev task)
- [ ] Create `lib/gigachat.ts` — OAuth2 token caching, Russian CA cert bundle, GigaChat Max/Pro config
- [ ] Replace `/api/chat` Anthropic calls with GigaChat client
- [ ] Rewrite system prompt for GigaChat (already in Russian — minor adjustment)
- [ ] Configure SpaceWeb Почта SMTP credentials in env vars
- [ ] Remove `@anthropic-ai/sdk` from package.json
- [ ] Remove all Vercel and Supabase env vars, add SpaceWeb + GigaChat env vars

---

## Completed Features
- Login page with role-based redirect (admin/client)
- Admin portal: dashboard, clients list, new client, pricing tiers
- Admin portal: per-client audit billing log (paid/unpaid toggle per session)
- Admin dashboard: unpaid metric card + paid vs unpaid donut chart
- Client portal: dashboard, AI chat, documents upload, usage tracking
- Pay-per-audit pricing model (automatic based on transaction count)
- New audit flow: file upload OR live 1C connection
- All 4 pricing tiers manageable from admin panel
- File parser: row counting for xlsx / csv / xml (incl. 1C exports)
  - lib/file-parser.ts — shared pure parser library (no HTTP, no side effects)
  - /api/parse-file — dedicated parse endpoint with result caching
  - /api/upload — auto-triggers background parse after upload
  - /api/audit/calculate-price — uses cached parse result, on-demand fallback
  - types/index.ts — core TypeScript interfaces created

## API Routes
- /api/auth/me — get current user (server-side)
- /api/auth/profile — get user role and status
- /api/data — all frontend data operations
- /api/chat — Sonnet 4.6 (audit reasoning) + Haiku 4.5 (findings extraction)
- /api/upload — file upload to Supabase Storage + background parse trigger
- /api/parse-file — parse xlsx/csv/xml and cache row count in documents table
- /api/admin/clients — CRUD clients
- /api/admin/pricing — CRUD pricing tiers
- /api/audit/calculate-price — count transactions + price (uses parser)
- /api/billing/check-limit — enforce limits

## Database Tables
profiles, pricing_tiers, client_subscriptions,
audit_sessions, transactions, findings,
audit_messages, documents, usage_events

## Dependencies Added
- fflate — pure-JS zip decompressor for XLSX parsing (npm install fflate)

## What Still Needs Building
- [x] File parser (count rows from xlsx/csv/xml)
- [x] Admin: per-client audit billing log
- [x] Admin dashboard: unpaid metrics + donut chart
- [x] Client portal: audit history page (audits currently open chat only; no standalone history/detail view)
- [ ] Multi-sheet XLS parser (lib/file-parser.ts — expose both sheets to audit agent)
- [ ] 1C live connection testing
- [ ] Report generation in Russian
- [ ] Email notifications
