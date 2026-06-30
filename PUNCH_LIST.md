# AI Senior Auditor — Punch List

Prioritized by what it blocks. Derived from full source review (see PROJECT_STATUS.md for details on each item).

---

## P0 — Security (fix before any real client data touches this, demo included)

- [ ] **Add auth checks to `/api/data`.** Single dispatcher handles 19 actions including admin-only ones (`admin_stats`, `admin_clients`, `delete_client`) with zero authentication. Anyone who knows an action name can read or write any client's data.
- [ ] **Add admin-role check to `/api/admin/clients` and `/api/admin/pricing`.** No server-side check that the caller is actually an admin — only a client-side React redirect, which doesn't protect the API itself.
- [ ] **Add auth to `/api/report/[id]`.** Publicly downloads full audit report (findings, chat history, company data) for any guessable session UUID, no login required.
- [ ] **Delete `/api/report/[id]` and `/api/report/test`.** Both are orphaned — the real report generator is client-side (`pdfmake` in the audit detail page). Leaving these deployed is unnecessary attack surface for zero benefit.
- [ ] **Add auth to `/api/chat` and `/api/upload`.** Same pattern — currently trust whatever `clientId`/`sessionId` is passed in.

---

## P1 — Blocks the core demo flow from working end-to-end

- [x] ~~New client creation doesn't create a `client_subscriptions` row.~~ **Verified not a blocker (June 2026 test).** A freshly created client with no `client_subscriptions` row was able to complete the full audit flow successfully — price calculation, confirmation, AI chat, and findings all worked. This confirms `/api/billing/check-limit` is **not actually called anywhere in the new-audit wizard** (`calculate-price` → `confirm_audit` is the real path; `check-limit` is skipped entirely). The route and its underlying `get_client_limit()` Postgres function are fully built but currently unused — reclassified below as a P2 cleanup/decision item, not a P1 blocker.
- [ ] **Add `audit_sessions.paid` to a tracked migration.** The column is used everywhere (admin billing log, both dashboards' donut charts) but isn't in `001–004.sql` — it was added outside version control. If this gets lost or a fresh DB is provisioned from migrations alone (e.g. for Phase 2 SpaceWeb setup), all paid/unpaid tracking silently breaks.
- [ ] **Fix multi-sheet XLSX/XLS parsing.** Both parsers read only the first sheet. Confirmed in real client testing: a 1C export with "Без подтверждающих документов" (135 rows, audit-relevant) + "Полный список" (178 rows) only ever surfaces sheet 1 to the AI. This directly affects audit accuracy/completeness on real client files.
- [ ] **Add `.txt` to file input `accept` attributes.** The most fully-built parser (1C Client Bank Exchange, Windows-1251 decoding, transaction-level detail) is unreachable through any of the three upload UIs because the file picker filters it out. Either add `.txt` to the accept lists or relax/remove the filter.
- [ ] **Add PDF text extraction.** `pdf-parse` is already installed but never wired into `file-parser.ts`. PDFs currently upload fine but contribute nothing to the AI's analysis — silent capability gap for a common document type in this domain (invoices, contracts, statements often arrive as PDF).

---

## P2 — Correctness issues that produce misleading output, not hard failures

- [ ] **Reconcile `types/index.ts` with the real schema.** Risk levels, account status, and session status enums are all wrong in this file (English placeholders vs. the actual Russian-string enums in the SQL). Low runtime risk since most routes define inline types instead of importing this file, but it actively misleads anyone (including future-you, or another AI session) who trusts it.
- [ ] **Stop encoding company name/period into `audit_sessions.title` + regex-parsing it back out.** Breaks silently if a company name contains `(`. The schema already has unused `period_from`/`period_to` columns — use them, and add a `company_name` column or pull from `profiles.company_name` instead.
- [ ] **Fix the `paid` status check inconsistency in `/api/auth/login`.** Login blocks `status === 'paused'` but not `'deleted'`, while `check-limit` blocks both. A soft-deleted client could potentially still log in.
- [ ] **Decide on one data-access convention.** Right now `/api/data`'s action dispatcher and dedicated REST routes (`/api/admin/clients`, `/api/admin/pricing`) coexist for overlapping concerns. Pick one pattern going forward to avoid the inconsistency compounding as features are added.
- [ ] **Decide the fate of `/api/billing/check-limit` and `client_subscriptions`.** Confirmed unused — the new-audit wizard never calls it, so audits/pricing have no actual cap right now regardless of tier or subscription state. Either wire it into the wizard (if usage limits matter for the business model) or remove it/document it as aspirational, so it doesn't mislead anyone reading the code into thinking limits are enforced.
- [ ] **Reconcile token pricing constants.** `lib/anthropic.ts` and `lib/billing.ts` have different, non-matching per-1K-token rates for the same models — whichever one is used for client-facing cost estimates is currently wrong relative to the other.

---

## P3 — Cleanup (no functional impact, reduces future confusion/bundle size)

- [ ] Remove unused dependencies: `pdf-parse` (until wired up per P1), `papaparse` (CSV is hand-rolled), `chart.js` (all charts are hand-rolled SVG/canvas).
- [ ] Consolidate the three independent donut chart implementations (admin dashboard SVG, client dashboard canvas, audit detail canvas) into one shared component.
- [ ] Remove or document `proxy.ts` — it's currently a no-op middleware; either give it a real purpose (e.g. server-side auth gating, which would also help with P0) or delete it so it doesn't imply protection that isn't happening.
- [ ] Wire `audit_messages.tokens_in`/`tokens_out` and `usage_events` AI-message logging — schema supports per-message token/cost tracking but the chat route never writes it, so the `UsageBreakdown` type in `billing.ts` and the client usage page can't show real cost data.
- [ ] Decide the fate of the `transactions` table — either start populating it for structured per-transaction analysis (likely needed eventually for risk_score work) or remove it from the schema if the flat-text-to-LLM approach is the permanent design.
- [ ] Remove the unused `increment_session_cost()` Postgres function if nothing will call it.

---

## Suggested order of attack

1. P0 security items — these are the difference between "demo" and "incident," especially with real client financial data
2. Subscription creation + `paid` migration (P1) — both are quick fixes that unblock the actual sales demo flow
3. Multi-sheet parser fix + `.txt` accept fix (P1) — directly affects whether the AI sees complete data, which is the whole value proposition
4. Everything else as time allows before Phase 2 (SpaceWeb/GigaChat) migration begins, since several P1/P2 items are also called out in the Phase 2 migration checklist and are easier to fix once than to fix twice across two stacks
