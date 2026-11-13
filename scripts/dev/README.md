# Development helpers (Python, not part of the app)

Run by hand when needed; none of them is used by the application or its tests.
They need `reportlab`, `python-docx`, `Pillow`, `pytesseract` and the
`tesseract` / `poppler-utils` programs.

| Script | What it does |
|---|---|
| `make-stage2-docs.py <out-dir>` | Builds the **stage-2 test pack** for the mock company ООО «Вектор-Трейд» (all names invented): contract + 3 acts for the supplier paid without documents; contract + 4 of 6 acts and a fifth act with a wrong amount for the sole trader; the invoice and the reconciliation act for the double payment; НПД certificate + 6 receipts for the individual; an explanation letter with no documents. Expected results are in `PROJECT_STATUS.md` (entry of Nov 13, 2026 on stage 2). |
| `ocr-experiment.py <pdf>:<page> …` | Turns PDF pages into images in three conditions (clean scan; stamp + skew + blur; poor phone photo) and measures Tesseract (`rus+eng`): share of words and of amounts read, the engine's confidence, time per page. Writes temporary files to `/tmp/ocr` (create it first). Results of Nov 13, 2026 are in `PROJECT_STATUS.md`. |
| `make-ocr-table.py <out-dir>` | A one-page invoice with a ruled table of eight goods lines (small print) — the case where amounts in table cells were lost before the service removed table lines. |
| `make-scans.py <out-dir> <pdf> …` | Turns text PDFs into test scans: `<name>_scan.pdf` (clean, no text layer), `<name>_stamp.pdf` (stamp, signature, skew, blur), `<name>_photo.jpg` (first page as a poor phone photo — should fail the confidence gate). Upload them through the app to test recognition end to end. |
| `trim-1c-metadata.py <full $metadata.xml> <out.xml> <out.json>` | Cuts the full 1C structure export (about 7 MB, not kept in the repo) down to the objects the mock and the reader use — produces `services/mock-1c/metadata.xml` and `structure.json`. |
