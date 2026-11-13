# Mock 1C server

A stand-in for a 1С:Бухгалтерия предприятия database, for building and
testing the live 1C connection without a real client database.

```
npm run mock:1c        # http://localhost:8081/mock/odata/standard.odata/
npm run test:mock1c    # checks the interface and that the books balance
```

**For demonstrations** the same base is served by the app itself, switched on
and off by an admin (admin area → «Демо 1С», migration `009_app_settings.sql`):
`https://<app>/api/mock-1c`, base `mock`, same login and password. While it is
off the address answers 404. The new-audit wizard then offers «Заполнить данные
демо-базы». The app's 1C reader answers that address in-process (no network,
no `C1_ALLOW_PRIVATE_HOSTS` needed). Code: `lib/demo-1c.ts`,
`app/api/mock-1c/[...path]/route.ts`; test: `npm run test:demo1c`.

`demo-docs/` holds the stage-2 supporting documents for demonstrations (made by
`scripts/dev/make-stage2-docs.py`, invented data, marked as test data); admins
download them from «Демо 1С» as a ZIP or one by one (`lib/demo-docs.ts`).

Login is HTTP Basic, like 1C's "automatic REST service" user. Settings (env):
`MOCK_1C_PORT` (8081), `MOCK_1C_BASE` ("mock" — the part of the address before
`/odata/…`), `MOCK_1C_USER` (odata.user), `MOCK_1C_PASSWORD` (mock-password),
`MOCK_1C_YEAR` (2025), `MOCK_1C_SCALE` (1 ≈ 770 documents a year; 4 ≈ 2 500).

## What it is built from

- `metadata.xml` — a **trimmed copy of a real structure file** (`$metadata`)
  exported on Nov 12, 2026 from a 1С:Фреш «Бухгалтерия предприятия» trial
  database through the standard OData interface. Only the objects the audit
  reads are kept; links to dropped objects are removed. Field names and types
  only — no data. The full export (about 7 MB) is not kept in the repository.
- `structure.json` — the same objects as a plain list of fields. Every object
  the mock serves has **all** fields of its real type; a field name that is not
  in the real structure is an error at start-up.
- `data.ts` — the invented company and its year. `odata.ts` — the interface.
  `server.ts` — HTTP.

## The company

ООО «Вектор-Трейд», УСН «Доходы минус расходы», wholesale of office supplies,
three employees. One year: purchases of goods (paid 5–20 days later), rent and
delivery, sales (paid 3–25 days later), monthly payroll with НДФЛ,
contributions and injury insurance, bank charges, УСН advances accrued each quarter, month-end
closing of costs and results, the year's tax, and the year-end closing of accounts 90, 91
and 99. Bank documents never fall on a weekend. Opening balances are entered
on 31 December of the previous year. All names, ИНН and account numbers are
invented. The same year always produces the same data.

## Errors planted on purpose

| id | What is wrong |
|---|---|
| `double-payment` | Supplier invoice № 20781 (64 380,50) paid twice, 14.05 and 29.05; one goods receipt |
| `no-documents` | ООО «Меридиан-Сервис»: three payments, 480 000 in total, no acts, no contract — debit balance on 60.01 |
| `round-consulting` | Six payments of 100 000 to a sole trader for "consulting", booked straight to 44.01, no acts |
| `individual-no-tax` | An individual paid 240 000 for services; no НДФЛ or contributions |
| `director-loan` | Interest-free loan of 900 000 to the director, not repaid (58.03) |
| `dividends-no-ndfl` | Dividends of 1 200 000 paid in full; НДФЛ not withheld or paid |
| `unposted-sale` | A shipment of 312 400 left unposted — paid by the customer, no revenue in the ledger |
| `usn-q2-missing` | УСН advances are accrued for Q1 (28 000), half-year (30 000) and 9 months (27 000); Q1 and 9 months are paid, the half-year one is not. The year's tax (minimum tax, 93 120 after advances) is accrued on 31 December and is not yet due, so 68.12 ends at Кт 123 120 |

There is also one sale marked for deletion, which a reader must ignore.
The list is available to tests as `base.planted`; it is never served.

## What is served

`$metadata`; the collections (documents: bank receipts and write-offs, goods
and services received, sales, manual entries; catalogues: organisation,
counterparties, contracts, bank accounts, individuals, currencies; chart of
accounts) with `$format=json`, `$filter` (eq ne gt ge lt le, and / or / not,
`datetime'…'`, `guid'…'`, `substringof` / `startswith` / `endswith`),
`$select`, `$orderby`, `$top`, `$skip`, `$inlinecount=allpages`, `/$count`,
one object by `(guid'…')`; and the ledger's virtual tables
`RecordsWithExtDimensions`, `Balance`, `Turnovers`, `BalanceAndTurnovers`
(grouped by account and its first analytic; `AccountCondition`, `Condition`).

## What it is not

It is written from the protocol description and a real structure file, not
copied from 1C. Things only a real base shows — time-outs, paging limits,
quirks of platform versions, the exact wording of errors, tabular sections of
documents (served empty here), `$expand` — must be checked on the 1С:Фреш
trial base before the connection is offered to clients. Not in the structure
export: invoices (СчетФактура…), the tax-system and accounting-policy
registers, cash-flow items.
