# AI Senior Auditor

An AI auditor for Russian small businesses (ООО, ИП). The client uploads bank
statements, 1C exports and supporting documents, or connects a 1C base
directly. The agent analyses them and records findings with risk levels. In
stage 2 the client uploads supporting documents, and the agent proposes closing
findings for the client to confirm.

Live at `auditor.assistant24info.ru`. The current state, decisions and next
steps are in [`PROJECT_STATUS.md`](PROJECT_STATUS.md) (newest at the top) and
[`PUNCH_LIST.md`](PUNCH_LIST.md).

> This Next.js version has breaking changes. Read `AGENTS.md` and
> `node_modules/next/dist/docs/` before writing Next code.

## Architecture

All parts run on our own Coolify server (`assistant_vps_4`), each as its own
Coolify app built from this repository:

| Part | Where | What it does |
|---|---|---|
| **Auditor** (this app) | repo root, `Dockerfile` | Next.js 16: client screens, upload and pricing, chat with the audit agent, findings, PDF report |
| **Database and files** | self-hosted Supabase | users, audits, documents, findings; files in the `audit-documents` bucket. Schema: `supabase/migrations/001…006` |
| **Audit model** | DeepSeek V4 Pro (Anthropic-compatible API) | analysis. It receives **coded** text only: names of individuals are replaced before sending and put back in the reply |
| **Name detection** | [`services/ner`](services/ner/README.md) (Natasha) | finds people's names in Russian text for the coding step. If the service is configured and down, the audit is blocked |
| **Text recognition (OCR)** | [`services/ocr`](services/ocr/README.md) (Tesseract) | reads scans and photos of documents, so scans never leave our server |
| **Demo / mock 1C** | [`services/mock-1c`](services/mock-1c/README.md), served by the app at `/api/mock-1c` | an invented 1C base with 8 planted errors — for tests, and for demonstrations when an admin switches it on («Демо 1С») |

## Text recognition (OCR)

Scans and photos (JPG, PNG, or a PDF without a text layer) are recognised
**once, at upload**, by `services/ocr` on our own server:

1. **Reading.** PDF pages are rendered at 300 dpi and photos are turned upright.
   Table lines are removed before reading; without this, most amounts in
   table cells were lost. Tesseract `rus+eng` then reads each page, and a page
   scanned sideways is turned and read again. Numbers read with low confidence
   are marked `[?]`.
2. **Quality threshold.** A page whose confidence is below `OCR_MIN_CONFIDENCE`
   (default **75**), or that has almost no words, counts as "not reliably
   recognised". It is not analysed and not charged. In our measurements,
   ordinary scans score 89–95 and poor phone photos 22–49.
3. **Stored once.** The result is saved beside the file as `<file>.ocr.json`.
   Each chat turn reads that file and never recognises the scan again.
4. **Price.** 20 ₽ per reliably recognised page. The client sees the count and
   confirms before analysis, for example «скан, 3 страницы; распознано надёжно —
   2 × 20 ₽ = 40 ₽; ещё 1 страница не распознана надёжно — не оплачивается».
5. **What the agent is told.** The text came from a scan and may contain
   errors. An amount from a scan can support closing a finding only if it
   matches a figure already in the 1C base or the bank statement, and a `[?]`
   number cannot be the basis of a finding. Recognised text goes through name
   detection and coding like any other document.
6. **Service down at upload.** The document is not analysed, costs 0 ₽, and
   the client is asked to upload it again later. If `OCR_URL` is not set,
   scans and photos are not analysed, as before OCR existed.

Code: `lib/ocr.ts` (threshold, stored result, text for the agent),
`lib/ocr-client.ts` (service client), `app/api/upload/route.ts`,
`app/api/chat/route.ts`, `lib/doc-billing.ts` (billing kind `scan`).
Deployment of the service: [`services/ocr/README.md`](services/ocr/README.md).

## Billing in short

- **Analysis:** per operation at the client's rate (default 12,50 ₽). Each
  operation is charged once per audit, even when files overlap.
- **Supporting documents:** 20 ₽ per page. A page is one PDF page, one image
  or 1 800 characters of text. For scans, only reliably recognised pages are
  charged.
- Prices are computed on the server. The client confirms the cost before any
  analysis, and the amount is frozen when the audit is completed.

## Environment variables (auditor app)

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase |
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_THINKING`, `LLM_EFFORT`, `LLM_REVIEW`, `LLM_CONTEXT_TOKENS`, `LLM_MAX_REQUEST_CHARS` | audit model (`lib/llm.ts`) |
| `LLM_PSEUDONYMIZE` | coding of individuals before anything is sent to the model (on in production) |
| `NER_URL`, `NER_TOKEN` | name-detection service (`http://ner:8000`) |
| `OCR_URL`, `OCR_TOKEN` | text-recognition service (`http://ocr:8000`) |
| `OCR_MIN_CONFIDENCE` | OCR quality threshold, default 75 |
| `C1_ALLOW_PRIVATE_HOSTS` | lets the 1C connection reach local addresses. **Not needed any more** for the mock (the demo base is served by the app, switched in «Демо 1С»); remove it |

The OCR service has its own variables: `OCR_TOKEN`, plus the optional
`OCR_WORKERS` and `OCR_MAX_PAGES`.

## Development

```bash
npm ci
npm run dev                # http://localhost:3000
npm run mock:1c            # mock 1C base on http://localhost:8081
```

Tests that need no model and no database:

```bash
npm run test:facts && npm run test:volume && npm run test:billing && npm run test:pii \
  && npm run test:xlsx && npm run test:mock1c && npm run test:1c && npm run test:findings \
  && npm run test:ocr
```

`npm run test:ocr -- file.pdf photo.jpg` also recognises real files when
`OCR_URL` and `OCR_TOKEN` point at a running OCR service. The checks that use
the model are `npm run check:llm` and `npm run check:audit` (three audits of a
fixture, about $0.39).

Helper scripts for test documents, including scanned versions for OCR
(`make-scans.py`), are in [`scripts/dev`](scripts/dev/README.md).
