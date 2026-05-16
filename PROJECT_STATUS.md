# AI Senior Auditor — Project Status

## Stack
- Next.js 16.2.6 (App Router, TypeScript)
- Supabase (Auth + PostgreSQL + Storage)
- Claude Haiku 4.5 via Anthropic API
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

## Completed Features
- Login page with role-based redirect (admin/client)
- Admin portal: dashboard, clients list, new client, pricing tiers
- Client portal: dashboard, AI chat, documents upload, usage tracking
- Pay-per-audit pricing model (automatic based on transaction count)
- New audit flow: file upload OR live 1C connection
- All 4 pricing tiers manageable from admin panel

## API Routes
- /api/auth/me — get current user (server-side)
- /api/auth/profile — get user role and status
- /api/data — all frontend data operations
- /api/chat — Claude Haiku 4.5
- /api/upload — file upload to Supabase Storage
- /api/admin/clients — CRUD clients
- /api/admin/pricing — CRUD pricing tiers
- /api/audit/calculate-price — count transactions + price
- /api/billing/check-limit — enforce limits

## Database Tables
profiles, pricing_tiers, client_subscriptions,
audit_sessions, transactions, findings,
audit_messages, documents, usage_events

## What Still Needs Building
- [ ] File parser (count rows from xlsx/csv/xml)
- [ ] 1C live connection testing
- [ ] Client portal: audit history page
- [ ] Admin: per-client audit billing log
- [ ] Report generation in Russian
- [ ] Email notifications