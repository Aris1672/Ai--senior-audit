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
When a client is ready to sign, spin up a **dedicated instance** for that client with a fully compliant Russian stack:

| Component | Demo (Current) | Production (Per Client) |
|---|---|---|
| Hosting | Vercel (US) | Selectel / Timeweb VPS (Russia) |
| Database | Supabase PostgreSQL (US) | Self-hosted PostgreSQL (Russia) |
| File Storage | Supabase Storage (US) | Yandex Object Storage (Russia) |
| Auth | Supabase Auth | NextAuth.js + own PostgreSQL |
| LLM | Sonnet 4.6 (audit) + Haiku 4.5 (findings extraction) | GigaChat Max / Pro (Sberbank) |
| Compliance | Demo only | Federal Law No. 242-FZ compliant |

### Why Dedicated Instances
- Each Russian client gets their own isolated deployment
- Satisfies 242-FZ (personal data stored on Russian servers)
- Bonus: data isolation between clients (important for audit confidentiality)
- System prompt rewritten in Russian for GigaChat

### GigaChat Model Hierarchy (Production)
- **GigaChat Max** — deep document analysis, risk assessment, complex audit queries
- **GigaChat Pro** — standard chat, summaries, follow-up questions (cost optimization)
- **GigaChat Lite** — not suitable for audit use

### Phase 2 Migration Checklist (per client)
- [ ] Provision Russian VPS (Selectel / Timeweb Cloud)
- [ ] Set up PostgreSQL, run existing migration files (001–004)
- [ ] Set up Yandex Object Storage (S3-compatible, minimal code change)
- [ ] Swap Supabase client → `pg` (node-postgres)
- [ ] Swap Supabase Storage → `@aws-sdk/client-s3` pointed at Yandex endpoint
- [ ] Install NextAuth.js, configure Credentials provider against own DB
- [ ] Obtain GigaChat B2B API credentials (developers.sber.ru/gigachat)
- [ ] Update `lib/gigachat.ts` — token caching, SSL (Russian CA cert), model config
- [ ] Rewrite system prompt in Russian for audit domain
- [ ] Remove `@anthropic-ai/sdk`, remove Vercel and Supabase env vars
- [ ] Configure Nginx reverse proxy + SSL on VPS

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
