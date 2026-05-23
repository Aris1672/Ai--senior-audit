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

## Deployment Strategy

### Phase 1 — Demo (Current)
Keep the existing stack as-is for demo and client acquisition:
- Vercel + Supabase + Claude Sonnet 4.6 (audit) + Claude Haiku 4.5 (findings extraction)
- Used to demonstrate the product and close first contracts

### Phase 2 — Production (Per Russian Client, on contract signing)
When a client is ready to sign, spin up a **dedicated instance** for that client with a fully compliant Russian stack.

**Infrastructure provider: SpaceWeb** (cp.sweb.ru) — existing account, single billing, all services in one place.

| Component | Demo (Current) | Production (Per Client) |
|---|---|---|
| Hosting | Vercel (US) | SpaceWeb Облачный сервер / VPS (Russia) |
| Database | Supabase PostgreSQL (US) | SpaceWeb DBaaS — Managed PostgreSQL (Russia) |
| File Storage | Supabase Storage (US) | SpaceWeb S3-хранилище — S3-compatible (Russia) |
| Email | — | SpaceWeb Почта — SMTP (Russia) |
| Auth | Supabase Auth | NextAuth.js + own PostgreSQL |
| LLM | Sonnet 4.6 (audit) + Haiku 4.5 (findings extraction) | GigaChat Max (audit) + GigaChat Pro (findings extraction) |
| Compliance | Demo only | Federal Law No. 242-FZ compliant |

### Why SpaceWeb
- Existing account — no new vendor onboarding
- DBaaS = managed PostgreSQL, no manual DB admin
- S3-compatible storage = near-zero code changes (swap endpoint URL only)
- Built-in email (SpaceWeb Почта) covers email notifications TODO
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
- **No new domain needed** — use subdomains of existing `assistant24.tech`
- Per client: `client1.assistant24.tech`, `client2.assistant24.tech`, etc.
- DNS: add an A record in `cp.sweb.ru` pointing the subdomain to the SpaceWeb VPS IP
- SSL: GlobalSign AlphaSSL available free via `cp.sweb.ru` ✅
- ⚠️ **URGENT: `assistant24.tech` expires 15.07.2026** — renew before Phase 2 setup (7,607 ₽)

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
- [ ] ⚠️ Renew `assistant24.tech` — expires 15.07.2026 (7,607 ₽)
- [ ] Register GigaChat B2B API — developers.sber.ru/gigachat
- [ ] Download Russian CA certificate — gosuslugi.ru (`russian_trusted_root_ca.cer`)

**Infrastructure (SpaceWeb)**
- [ ] Provision SpaceWeb Cloud VPS (`vps.sweb.ru` → Виртуальные серверы)
- [ ] Create SpaceWeb DBaaS PostgreSQL 17 instance (398 ₽/мес, enable replicas)
- [ ] Create SpaceWeb S3 bucket for audit documents
- [ ] Add DNS A record in `cp.sweb.ru`: `clientN.assistant24.tech` → VPS IP
- [ ] Issue GlobalSign AlphaSSL certificate for the subdomain (free via `cp.sweb.ru`)
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
- [ ] 1C live connection testing
- [ ] Report generation in Russian
- [ ] Email notifications
