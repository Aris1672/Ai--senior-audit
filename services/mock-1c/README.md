# Mock 1C server (in progress)

A stand-in for a 1С:Бухгалтерия предприятия database, for building and
testing the live 1C connection without a real client database.

- `metadata.xml` — a **trimmed copy of a real structure file** (`$metadata`)
  exported on Nov 12, 2026 from a 1С:Фреш «Бухгалтерия предприятия» trial
  database through the standard OData interface. Only the objects the audit
  reads are kept (bank receipts and write-offs, purchases, sales, manual
  entries, the accounting ledger with its balance / turnover functions, the
  chart of accounts, organisations, counterparties, contracts, bank accounts,
  individuals, goods, currencies). Links to objects that were dropped are
  removed. It contains field names and types only — no data.
- `structure.json` — the same objects as a plain list of fields, for code.

The full export is about 7 MB and is not kept in the repository.

Not in the export (to be ticked in 1C's OData settings when needed):
invoices (СчетФактураПолученный / Выданный), the tax-system and
accounting-policy registers, cash-flow items.

Next: the server itself (answers the same addresses as real 1C with invented
data and planted errors), then the reader in the app.
