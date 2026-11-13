# AI Senior Auditor — Project Status

> **Update November 14, 2026, 00:10 — demo documents downloadable from the admin page.** The seven stage-2 test documents of the invented company (each marked «Тестовые данные вымышленной организации») are now in the repository at `services/mock-1c/demo-docs/` (copied into the Docker image with the mock). Admin → «Демо 1С» → «Документы для демонстрации»: **«Скачать все (ZIP)»** (`Демо-документы_Вектор-Трейд.zip`, files numbered in upload order: `1_round1_…` … `7_round2_…`) or one by one, each with what the AI is expected to do. Round 1: Меридиан contract + acts (propose close), Сафонова НПД certificate + receipts (propose close), Глебов contract + 4 of 6 acts (stays open, 400 of 600 thousand), invoice № 20781 (double payment stays open), explanation without documents (stays open). Round 2: reconciliation act (propose close of the double payment), Глебов act № 5 (90 000 against 100 000 caught). Endpoint `GET /api/admin/demo-1c/documents` (admins only; `?file=` one file from the fixed list — no path from the request is ever used; `?list=1`). `npm run test:demo1c` covers the list, path refusal and the ZIP.

> **Update November 13, 2026, 23:15 — demo 1C base with an on/off switch (needs `supabase/migrations/009_app_settings.sql`).** For demonstrations the mock base (ООО «Вектор-Трейд», 2025, 771 documents, 8 planted errors) is now served **by the app itself** at `https://auditor.assistant24info.ru/api/mock-1c` (base `mock`, login `odata.user`, password `mock-password`) — no terminal process. **Switch:** admin area → **«Демо 1С»** (`app/admin/demo`), stored in `app_settings.demo_1c` (survives restarts and redeploys); off → the address answers 404 and the reader says «Демо-база 1С сейчас выключена». While on, the new-audit wizard shows «Заполнить данные демо-базы» (fills address, base, login, password). The 1C reader answers the demo address **in-process** (`lib/demo-1c.ts`; path `/api/mock-1c/…` on any host), so the app never calls its own domain and **`C1_ALLOW_PRIVATE_HOSTS=true` is no longer needed — remove it from the server** (launch-checklist item done). Billing is unchanged: a demo connection is charged per operation like any other. Only admins can switch (`POST /api/admin/demo-1c` checks the role); any signed-in user sees the demo login while it is on (invented data). Checked: `npm run test:demo1c` (off → 404 + message; on → OData answers; reader in-process 771 documents; wrong password, writes, other base names refused), production build, and a local `next start` with the switch forced on (bundled route served `Catalog_Контрагенты`, 401 without login). `npm run mock:1c` still works for local development.

> **Update November 13, 2026, 20:20 — `npm run check:audit` re-run by the user after today's prompt changes: PASSED 3/3** (≈ $0.40; 202–245 s per run; 4 findings each: double payment of invoice 83973/007 — confirmed in run 1, risk flag in runs 2–3, the known variance; unidentified card inflows 31 700 ₽ — СУЩЕСТВЕННО; supplier concentration and mixed personal spending — НЕСУЩЕСТВЕННО). One warning only: the 1 137 reserve transfer mentioned in 2 of 3. The interest-free-loan rule, rules 9–10 and the `financial_impact` field did not disturb the regression. The check now also prints each finding's financial impact and warns when the two money findings lack it (`impact`, warning only) — the user's run did not show whether the field was filled.

> **Update November 13, 2026, 20:00 — "violation corrected" verified by the user (migration 008 run).** A test payment order (№ 412 of 13.11.2026: half-year 2025 УСН advance 30 000,00 ₽ + penalties 1 245,00 ₽, purpose naming the arrear and the 28.07.2025 deadline, bank mark «исполнено») uploaded in audit «1C-8» (20 ₽). The agent proposed closing Н-10 with `resolution: corrected` («нарушение подтверждено данными базы и исправлено платёжным документом») and noted the payment is not yet in the 1C snapshot (post 68.12/51). Confirmed → the PDF shows a solid green «НАРУШЕНИЕ УСТРАНЕНО» badge, check icon and green stripe on Н-10, KPI «4 из 13 · устранено 1 · документы 3», conclusion «нарушение устранено — 1, по подтверждающим документам — 3», cost 8 520 ₽. **Not yet seen:** a «Финансовое влияние» row (comes with the next new finding or correction).

> **Update November 13, 2026, 19:50 — new PDF verified by the user in the browser; page-break rule decided.** The downloaded report of audit «1C-8» (9 pages) renders the new design correctly: KPIs 760 / 0 / 5 / 3 из 13, conclusion, register, Н-6 under СУЩЕСТВЕННО with its correction line; no «Финансовое влияние» rows yet (findings recorded before the field). **User decision:** a finding card is never split across pages, even at the cost of white space and more pages (option "allow a split after header and description" declined).

> **Update November 13, 2026, evening — PDF report redesigned (user brief); needs `supabase/migrations/008_finding_report_fields.sql` for two new fields (the report works without it).**
> - **Layout** moved to `lib/report-pdf.ts` (pure pdfmake definition; the audit page renders it; `npm run report:sample -- out.pdf` renders a sample of audit «1C-8» in Node). Page 1 — executive summary: logo + «ОТЧЁТ ОБ АУДИТЕ», navy bar (object, period, date, cost), **four KPIs** (operations checked, critical open, significant open, closed X of N with corrected/documented), **«Итоговое заключение»** in its own section with a verdict badge, then a **summary register** (code, title, level, type, status). Then **«Подробный реестр»**: one full-width card per finding, grouped by level, always the same structure — code, severity badge, type badge, status badge, title; description; financial impact; legal basis; recommendation; correction history; status and evidence (last row). Headings never stay alone at a page bottom; short cards are not split; long ones repeat their header row.
> - **Colours everywhere:** red critical, orange significant, blue insignificant (was green), green closed, grey neutral (waiting for decision, open notes, types).
> - **Corrected vs closed on documents:** «Нарушение устранено» (solid green badge, check icon) vs «Закрыто по подтверждающим документам» (light green badge, document icon); counted separately in the KPI and the conclusion. The agent now says which in `propose_close` (`resolution: corrected | documented`, rule 10 of the stage-2 block); stored as `proposal_kind` → `resolution_kind` on confirm; shown in the chat card and on the audit page. Findings closed before 008 count as "on documents".
> - **Financial impact:** optional `financial_impact` in `record_findings` (one line, only from the audit's data) and in corrections; saved after 008; own row in the card and on the audit page. Existing findings have none until corrected.
> - Fonts: Roboto has no "→", "✓", "⚠" or emoji — `pdfText` replaces them ("›") so nothing prints as a box. Old broken `LOGO_BASE64` removed; logo is a vector mark.
> - Tests: `npm run test:report` (new), `test:findings` extended. Production build passes.
> - **Not checked here:** the download in a real browser (pdfmake browser build has the same SVG support as Node); the agent actually filling `financial_impact` / `resolution` (needs the model).

> **Update November 13, 2026, 19:15 — corrections: history kept, no ";" endings.** A second «Пересмотри вывод Н-6» after the fixes: the outdated note is gone (fix works); the agent made a second, description-only correction. Found: (1) `clipText` cut at "; " and left the text ending with ";" — now it ends with "."; (2) `revision_summary` was overwritten, so the first correction (НЕСУЩЕСТВЕННО → СУЩЕСТВЕННО) disappeared from the page and PDF — each confirmed correction is now a dated line of its own (`ДД.ММ.ГГГГ: … Причина: …`), shown one per line on the page and in the PDF. The full before/after history was and is in `finding_events.payload`. Н-6 in audit «1C-8» keeps its overwritten note (data written before this fix).

> **Update November 13, 2026, 19:10 — correcting an assessment verified by the user (migration 007 run).** «Пересмотри вывод Н-6» in audit «1C-8» → amber card: НЕСУЩЕСТВЕННО → СУЩЕСТВЕННО, Косвенный признак → Признак риска (status kept below "confirmed" because the housing-loan exemption cannot be excluded without contract № 1-З), new title / description / legal basis (ст. 223 НК РФ, last day of each month) / recommendation, reason given. Confirmed → Н-6 moved to СУЩЕСТВЕННО with «Оценка исправлена … по вашему решению» and the reason. Two flaws found and fixed: (1) texts were cut mid-word at the stored limits («…договор № 1-3 не загруже») — now `clipText` cuts at the last full sentence or word with «…», for corrections and for new findings; (2) the agent's old "still open" note (written against the wrong assessment: «обязанность возникнет при возврате») stayed under the corrected finding — confirming a correction now clears it. Cosmetic: the agent writes the contract number as «1-3» (digit), the base has «1-З» (letter).

> **Update November 13, 2026, 19:20 — stage 2: correcting a finding's assessment (built; needs `supabase/migrations/007_finding_revision.sql` run once; not yet tried through the model).** Why: the PDF of audit «1C-8» showed Н-6 (director's interest-free loan) as НЕСУЩЕСТВЕННО with "дата дохода — дата возврата" — wrong by the rule confirmed today; the finding was recorded before the rule, and stage 2 could only close or keep open, never correct. Now:
> - **Third action of `update_findings`: `propose_revise`** with `revision` = only the fields that change (risk level, evidence status, title, description, legal basis, recommendation — each as full new text) and `basis` = why the old assessment is wrong. **Rule 9** in the stage-2 block: use it when a finding is wrong in substance (level, status, legal reasoning, contradiction with the main prompt's floors), not for wording, closing or new findings; on «Пересмотри вывод Н-…» it replaces keep_open when the finding stays open but its assessment is wrong. The block now also shows each finding's legal basis. Offered only after migration 007 (`revisionSchemaReady`); before it the tool and block are exactly as before.
> - **Validation** (`cleanRevision`): unknown values dropped, labels mapped («Подтверждённое нарушение» → confirmed), fields equal to the current ones dropped, same text limits as new findings; nothing left → skipped; a correction already waiting, or a closed finding → skipped.
> - **The client decides** (`/api/findings/decide`: `confirm_revision` / `decline_revision`): amber card in the chat and on the finding on the audit page, showing level and status before → after and the new texts, plus "Почему". On confirm the fields of the STORED proposal (never the request) are written; the previous values go to `finding_events.payload`; the finding gets `revised_at` and `revision_summary` («Уровень: НЕСУЩЕСТВЕННО → СУЩЕСТВЕННО; …. Причина: …»), shown on the audit page and in the PDF («Оценка исправлена … по решению клиента»).
> - **Instructions page** (section 7) explains it. `npm run test:findings` extended.
> - **To try:** run migration 007, redeploy (automatic on push), in audit «1C-8» write «Пересмотри вывод Н-6» → expect the amber card: НЕСУЩЕСТВЕННО → СУЩЕСТВЕННО, new legal basis (income on the last day of each month, ст. 212/223 НК РФ); confirm → Н-6 moves to СУЩЕСТВЕННО on the page and in the PDF with the note.

> **Update November 13, 2026, 18:25 — OCR accepted by the user ("all works nicely").** After the tool-call fix: «Пересмотри вывод Н-1» gave a complete reply (ends in a full sentence) and the green card; the agent noticed two figures garbled under the stamp on page 1 of the scan («0 000, 6», «480\00,00» — not marked `[?]`) and did not rely on them, using only scanned amounts that match the base — exactly why the "must match the base" rule exists. The user confirmed the closure: Н-1 struck through with basis and both documents (text version and scan), ring 23%, 3 of 13. Whole chain verified on the server: scan → recognition → gate → price → agent → proposal → confirmation → audit page. **Open:** a proposal based on scans alone (fresh mock audit with only the scans) not tried; whether an invoice alone may become a finding (Н-13 from the invented invoice 20915) — user has not asked for a rule; threshold not yet checked on real scans; confirm "service down → 0 ₽, upload again later".

> **Update November 13, 2026, 18:25 — two fixes after the OCR test.** (1) **Reply cut at a tool call.** «Пересмотри вывод Н-1» produced a correct proposal, but the reply stopped mid-word («…(Н-10), пла»). The server log of that turn was lost (the push of the status entry redeployed the auditor — Coolify deploys every push to `main`). Cause in the code regardless: a tool call (`record_findings` / `update_findings`) ends the model's response, and we never answered it, so anything the model meant to write after the call was lost. Now (`lib/audit-engine.ts`): when the response stops at a tool call and the text is empty or plainly unfinished (`looksUnfinished`: no closing punctuation), the tool call is answered and the model finishes the text (at most twice per pass); a repeated tool call there is ignored / dropped as a repeat. Log line: `[audit:…] text unfinished at a tool call — resuming (1)`. (2) **A repeated scan was recognised again** (11 s) before being priced as a repeat — the repeat check now runs first; a scan already accepted in the audit is never sent to the service again. Tests updated (`test:findings`, `test:ocr`).

> **Update November 13, 2026, 18:10 — OCR deployed and verified by the user (first run).** Service live as its own Coolify app (Tesseract **5.5.0** on the server; tuned locally on 5.3.4 — same results). Auditor check call returned 200. Four test scans uploaded in an existing stage-2 audit on the mock: cost card exactly as expected (stamped contract + 3 acts 4 × 20 = 80 ₽; stamped reconciliation act 20 ₽; ruled-table invoice 20 ₽; poor phone photo 0 ₽ "не распознана надёжно… более чёткую копию"; total 120 ₽). Agent reply: every scanned figure quoted exactly and matched to the base (150 000 / 150 000 / 180 000, п/п 226–228; 64 380,50 / 57 323,50 / 7 057,00; 84 084,40), each named as a scan with its confidence; the photo reported as not analysed (30% vs 75%). Н-1 and Н-5 were already closed from the text versions, so no proposals — correct. One new finding from the invented invoice 20915 (not in the base): risk flag, НЕСУЩЕСТВЕННО, both scenarios given — **user to decide** whether an invoice alone should ever become a finding. **Not yet tried:** a proposal to close based on a scan alone (a fresh mock audit with only the scans).

> **▶ Update November 13, 2026, evening — OCR BUILT (own server), not yet deployed or tried through the browser.** Scans and photos are now recognised on our own server and analysed.
> - **Service `services/ocr/`** (FastAPI + Tesseract `rus+eng`, own Coolify app like `services/ner`, Base Directory `/services/ocr`, port 8000, alias `ocr`, mandatory `OCR_TOKEN`, no content logging, nothing kept). `POST /recognize` takes the raw bytes of a PDF / JPG / PNG and returns per page: text, confidence, word count, doubtful numbers, rotation. Setup steps: `services/ocr/README.md`. The Docker image was not built here (no Docker daemon in the workspace); the service itself was run and tested locally with the same packages.
> - **Tuning (13.11).** The weak spot was table cells: with the ruling lines in place Tesseract read only **8 of 24** amounts on our test pages (a new ruled invoice `scripts/dev/make-ocr-table.py` plus four pages of the stage-2 pack). The service now **removes table lines before recognition** → **24 of 24** on clean scans and **23 of 24** with a stamp, skew and blur (the one miss is under the stamp); confidence 92–95. Poor phone photos stay unreadable (1–4 of 24, confidence 22–49) — the gate catches them. Also: PDF pages at 300 dpi, photos turned by EXIF, small images scaled up, a low-confidence page retried turned by the detected orientation (a page scanned sideways: 95% after turning), digits read with low confidence marked `[?]`, Latin look-alikes in Russian lines put back into Cyrillic ("1C OOO" → «1С ООО», so names match the base). Time: ~1 s per clean page, 3–11 s for a bad photo; two pages at once (`OCR_WORKERS`). Still synthetic images only — real scans from the user are still wanted to check the threshold.
> - **Gate** (`lib/ocr.ts`): page confidence below `OCR_MIN_CONFIDENCE` (default **75**) → "not reliably recognised"; fewer than 3 words → empty page. Neither is analysed nor charged.
> - **Upload** (`app/api/upload/route.ts`): a JPG / PNG, or a PDF without a text layer, is sent to the service once; the result is stored beside the file as `<path>.ocr.json` (same bucket) and the document row gets `parseMethod: "ocr"` with page counts. Every turn reads the stored text (`app/api/chat/route.ts`) — never recognised again. A declined file's stored text is deleted with it.
> - **Price** (`lib/doc-billing.ts`): new kind **`scan`** — units = pages, charged = reliable pages × 20 ₽. The client sees e.g. «скан, 3 страницы; распознано надёжно — 2 × 20,00 ₽ = 40,00 ₽; ещё 1 страница не распознана надёжно или пустая — не анализируется и не оплачивается»; a scan with no reliable page: 0 ₽ and «загрузите более чёткую копию». Page counters of the audit count `scan` pages.
> - **Service down at upload** → kind **`ocr_failed`**: 0 ₽, not analysed, the client is told to upload it again later; the agent is told the same. The audit is not blocked (nothing from the file is sent anywhere). **To confirm with the user** (this was the proposed rule). A file not read before (`unreadable`, `ocr_failed`) uploaded again is priced afresh, not as a repeat. `OCR_URL` not set → exactly the old behaviour.
> - **What the agent is told:** each scanned document starts with a note — text from OCR, digits may be wrong, `[?]` = doubtful; an amount, date or number from a scan can support `propose_close` only if it matches a figure already in the 1C base or the statement, otherwise `keep_open` and ask for a text version or a clearer copy; no violation on a `[?]` figure alone; name the pages not recognised. Pages under the gate are listed with their confidence, their text is never passed on. Stage-2 rule 4 (`lib/finding-updates.ts`) now names these cases too. The main prompt is not changed (`check:audit` not affected). Recognised text goes through Natasha and pseudonymization like any document (checked: the self-employed person's name on a scanned НПД certificate came out coded).
> - **Tests:** `npm run test:ocr` (gate, price, wording, model text, stored result); with the service running it also recognises files given as arguments: `OCR_URL=… OCR_TOKEN=… npm run test:ocr -- scan.pdf photo.jpg`. All other tests pass. **Test pack:** `python3 scripts/dev/make-scans.py <dir> <pdf>…` turns any text PDF (e.g. the stage-2 pack) into a clean scan, a stamped scan and a poor phone photo.
> - **To switch on:** create the Coolify app (README), set `OCR_URL=http://ocr:8000` and `OCR_TOKEN` in the auditor, redeploy both. **To try:** in a stage-2 audit on the mock, upload `meridian_dogovor_i_akty_stamp.pdf` (expect 4 pages × 20 ₽ and a proposal to close the supplier finding, the amounts matching the base) and `…_photo.jpg` (expect 0 ₽, not analysed). Still to do before that: `npm run check:audit` once (interest-free-loan rule).

> **▶ WHERE WE ARE — handover at the end of the session, November 13, 2026, 17:00. Next: build OCR on the user's own server.** Full handover note: project doc `claude/where-we-are.md` (kept in the claude.ai project) — read it first in a new session. Summary: steps 1–3 (decisions, volume, billing), 4a–4b (mock 1C, 1C reader) and 5a (closing findings: the agent proposes, the client confirms; reconsideration on request) are built and **verified by the user in the browser**; 4c (run on the real 1С:Фреш trial base) is not done. **OCR decision (13.11): own server, not a cloud service** — a `services/ocr/` FastAPI service with Tesseract `rus+eng`, deployed as its own Coolify app like `services/ner`; a confidence gate (a page read with low confidence is "not reliably recognised": not analysed, not charged); the agent is told the text came from a scan and an amount from a scan can support closing a finding only if it matches a figure already in the base or the statement; recognised text is stored once and goes through Natasha and pseudonymization as usual; pages that pass the gate are charged 20 ₽ like any page. **Measured 13.11** (Tesseract 5.3, `--psm 6`, four pages of our test documents as images, `scripts/dev/ocr-experiment.py`): clean 200-dpi scan — 98–100% of words, 13 of 15 amounts, confidence 95, ~1 s/page; stamp over text + skew + blur — 93–97%, 12 of 15, confidence 91–92; poor phone photo — 50–62%, 6 of 15, confidence 33–38. Weak spot: amounts in table cells. Synthetic images only — the user was asked for a few real scans to tune on (not received yet). Yandex Vision OCR stays a possible later addition behind the same interface; its current price could not be checked (older public figures: 0,10–0,13 ₽ per page). Helper scripts now in the repo: `scripts/dev/` (stage-2 test pack, OCR experiment, 1C structure trimming). **To do on resume before building:** redeploy if needed; `npm run check:audit` once (not re-run since the interest-free-loan rule was added).

> Update November 13, 2026 (two decisions; stage 2 part 1 accepted): reconsideration verified by the user — «Пересмотри вывод Н-7» produced a card through the tool call and the same documentary standard. **Decisions:** (1) the prompt rule on interest-free loans is confirmed by the user as correct law — income from the benefit arises on the last day of each month while the loan is outstanding, the tax-agent duty has arisen; (2) a detail of an existing finding recorded as a separate new finding (the Н-12 case) is left as it is — no rule. Next: OCR — options to be put to the user before building.

> Update November 13, 2026 (reconsideration tried by the user — a gap found and closed): «Пересмотри вывод Н-7» produced a correct re-assessment ending in "предлагаю закрыть", **but no card appeared** — most likely the agent did not call `update_findings` (the tool description and rule 2 still said "only when new documents…", contradicting rule 8; not confirmed from the server log). Fixed three ways: the tool description and rules 2 and 8 now say the call is mandatory on a request to reconsider and that the words alone change nothing; a **safety net** — when a stage-2 turn brings no tool entries, proposals are read from the answer text (`proposalsFromText`: "Н-… — предлагаю закрыть" + the text after it as the basis), validated like tool entries, and still need the client's confirmation; the server log now prints `[chat] stage 2: … | tool entries: … | used: …`. To verify: redeploy, repeat «Пересмотри вывод Н-7».

> Update November 13, 2026 (stage 2 confirmed end to end by the user, second audit: screen and PDF): ring "17% решено, 2 из 12", closed findings struck through with date, basis, document and «Открыть заново»; codes Н-1 … on the page and in the PDF; PDF conclusion: «…существенных нарушений и признаков риска: 5; несущественных замечаний: 5… Закрыто по подтверждающим документам: 2 из 12». Cost 8 380 ₽ = 760 × 10,50 + 18 pages + 2 pages at 20 ₽. Reconsideration («Пересмотри вывод Н-…») not yet tried. From this run: (1) **a legal error in the report** — the director's interest-free loan was rated НЕСУЩЕСТВЕННО with "обязанность ещё не наступила… дата дохода — дата возврата"; income from such a benefit arises on the last day of each month while the loan is outstanding (ст. 223 НК РФ), so the tax-agent duty had arisen. **Prompt rule added** next to the tax-agent floor (to be confirmed by the user, who knows the law; `check:audit` advisable). (2) Another fault of the mock, correctly caught: no injury-insurance contributions for an organisation with employees — added (accrued monthly at 0,2%, paid to the СФР; mock year **771 documents**). (3) Variance: in this run the 10 000 mismatch in an act was recorded as a separate new finding (Н-12) as well as inside the existing one; in the first run it was not. Rule not added — waiting for the user's view.

> Update November 13, 2026 (stage 2 verified by the user on the mock, both rounds; reconsideration added): migration 006 run; **all seven test documents handled as intended** — contract + 3 acts → proposal to close (confirmed by the user); НПД certificate + receipts → proposal (declined by the user, and NOT proposed again in the next round); contract + 4 of 6 acts → stays open with 200 000 uncovered; invoice only → double payment stays open; letter with promises → nothing proposed for three findings ("намерение уплатить основанием не является"); round 2: reconciliation act → proposal to close the double payment, with the offset checked against the base; act for 90 000 against a 100 000 payment → mismatch caught, total 490 000 of 600 000. Two things found beyond the plan (an act covering January under a contract signed 3 February; the invoice's validity had expired before the second payment). Replies are in the short four-part format (4 477 characters of reasoning in round 2). **Added after the test (user request): reconsidering a finding.** The client writes «Пересмотри вывод Н-3» in the chat; rule 8 tells the agent to re-match that finding against ALL documents of the audit and propose or keep open — also for a finding whose proposal the client declined, without lowering the bar for documents. The agent is shown that a proposal was declined, when, and on what basis (from `finding_events`). Codes Н-1 … are now shown on the audit page and in the PDF (same order as the agent's: `created_at`, then `id`), with a hint under each open finding; the chat's "left open" line carries the same hint. Not yet tried through the model.

> Update November 13, 2026 (stage 2, first part — closing findings; **needs `supabase/migrations/006_finding_resolution.sql` run once; not yet tried through the model**). User decision: **the agent proposes, the client confirms.** Before this nothing could ever set a finding to "resolved" — the audit page's "0% решено" could not move.
> - **What the agent sees and can do** (`lib/finding-updates.ts`): once an audit has findings, every request carries a block listing them with codes (Н-1, Н-2 …, by order of creation), their state, and the stage-2 rules; and a second tool, `update_findings`, with two actions only — `propose_close` and `keep_open` (with what is still missing). There is no action that closes. The main prompt is NOT changed: the block is added only when findings exist, so a first analysis runs exactly as before (`check:audit` unaffected).
> - **Closing rules in the block:** a proposal only when documents directly remove the basis and cover it fully (counterparty, amount, period). Payment without documents → contract AND acts/УПД for the whole amount; a contract or an invoice alone is not enough; partial cover → keep open, name the uncovered amount. Double payment → refund, reconciliation act with offset, or a second delivery; an invoice is not a basis. Tax not paid/withheld → payment document, ЕНС statement, accepted corrected return. Never on the client's words alone, on an unread scan, on a document for another party / period / amount, or on a document that itself raises questions. In doubt → keep open.
> - **Reply format at this stage:** short — what was checked, each affected finding (code, proposal or still open, basis, what else is needed), new findings if any, what to request next — instead of a new eight-section report (full report only on request or when new primary data with new operations is uploaded).
> - **Server** (`lib/finding-updates-server.ts`, `/api/findings/decide`): proposals are validated (unknown code, already closed, no basis, repeats are dropped) and stored on the finding (`proposed_at`, `proposal_basis`, `proposal_documents`; `agent_note` for "still open"); the client's decision — confirm / decline / reopen — changes the status conditionally (a stale screen or a double click cannot close twice); the basis and documents of a closure come from the stored proposal, not from the request; owner-of-the-audit check. Every step is written to `finding_events` (who, when, on what).
> - **Screens:** green proposal cards in the chat («Подтвердить закрытие» / «Оставить открытым»), the same on each finding of the audit page, closed findings struck through with date, basis, documents and «Открыть заново»; the PDF marks closed and proposed findings, and its conclusion now counts OPEN findings and states how many were closed.
> - `npm run test:findings` (block, rules present, validation). Engine: `runAuditTurn(…, opts.extraTools)` returns `updates`.
> - **Not tested:** the whole path through the model and the browser. A test pack for the mock company exists (sent to the user, not in the repo): contract + 3 acts for the supplier paid without documents (expect: proposal to close); contract + 4 of 6 acts for the sole trader (expect: stays open, 200 000 uncovered) and a fifth act for 90 000 against a 100 000 payment (expect: mismatch noticed); invoice only for the double payment (expect: stays open) and then a reconciliation act with the offset (expect: proposal); НПД certificate + 6 receipts for the individual (expect: proposal); an explanation letter with promises and no documents (expect: nothing proposed).
> - **Open:** no OCR yet — scans cannot justify anything; a declined proposal is not explained to the agent beyond the finding being open again; closing does not change the audit's price; nobody but the agent can start a closure (a client cannot close a finding without a proposal).

> Update November 13, 2026, morning (fourth 1C run on the mock, after the «Неотражённый доход» rule): 8 of 8 planted errors again; **the unposted sale is now СУЩЕСТВЕННО** (the new floor works); the first reply was the purpose question only. Two more unplanned findings, both again real faults of the mock and both removed: the year's УСН tax was not accrued before closing (now accrued on 31.12 — minimum tax 1%, 93 120 after advances; the advances are now 28 000 / 30 000 / 27 000, so the planted unpaid half-year advance is **30 000**, and 68.12 ends at Кт 123 120), and bank documents fell on weekends (now moved to working days). Mock year: **760 documents**. Names: "получателю / заёмщику / подрядчику / плательщику [name]" now declined. Run-to-run variance seen: the double payment was a confirmed violation in runs 2–3 and a risk flag in run 4 (both defensible). `check:audit` on the file fixture has NOT been run since the prompt change — the user ran the mock instead. Next: closing findings (stage 2) — waiting for the user's decision on who closes a finding.

> **▶ FIRST TASK ON RESUME (agreed Nov 13, 2026, 03:35): closing findings — the start of stage 2.** The user pointed out that the agent has never been tested on removing a finding when the needed documents are uploaded. It cannot: `findings.status` (open / resolved / disputed) exists and the audit page counts "решено", but no code sets it — `record_findings` only adds. Plan and the open decision (agent closes vs. proposes and a person confirms) are in the top entry of `PUNCH_LIST.md` and in the project doc `claude/where-we-are.md`.

> **▶ WHERE WE ARE — end of the session of November 12–13, 2026. Resume at step 5 (OCR, then stage 2).** Plan: 1 decisions ✔ · 2 volume ✔ · 3 billing ✔ (verified by the user in the browser) · 4a mock 1C ✔ · 4b 1C reader ✔ (verified by the user on the mock: 759 documents, 8 of 8 planted errors) · 4c run on the real 1С:Фреш trial base ✗ (needs documents entered there by hand; the trial has a time limit) · **5 OCR + stage 2 ✗ — next.** Last change of the session: prompt rule «Неотражённый доход» — income that the data itself shows as received but not recorded is never below СУЩЕСТВЕННО (user decision 13.11; second exception to the ~1% guide after tax-agent duties; hypotheses about unidentified inflows and АУСН marking are NOT covered). **First things on resume: redeploy; run `npm run check:audit` (prompt changed, name handling changed); then step 5.** Before building step 5, decide: OCR engine and where it runs (self-hosted on the Coolify server like Natasha — Tesseract / PaddleOCR — or a Russian cloud service; DeepSeek cannot read images; quality on stamps and tables, personal data, cost per page against 20 ₽); stage-2 mechanics (linking a document to a finding, closing a finding, a shorter reply for an added document, a before/after report, whether stage 2 is started explicitly as a paid step). `C1_ALLOW_PRIVATE_HOSTS=true` stays on the server for mock tests by the user's decision — launch checklist in `PUNCH_LIST.md`. A short version of this is kept in the claude.ai project as `claude/where-we-are.md`.

> Update November 13, 2026 (third 1C run on the mock — step 4 accepted on the mock): 759 documents × 10,50 = 7 969,50 ₽; **8 of 8 planted errors found, no unplanned findings**; supplier and sole trader without documents are both risk flags now; amounts with a comma; PDF conclusion states the counts. Fixed after it: the recorded cost is shown exactly on the audit page, the dashboard and in the PDF ("7 969,50", was "7 969,5" in the PDF and rounded to whole rubles on screen); plural of «нарушение» in the PDF. **Open quality points for the user's decision:** (1) the same finding gets different risk levels run to run — the unposted sale of 312 400 (tax understated by up to 46 860, 0,26% of turnover) was СУЩЕСТВЕННО in run 2 and НЕСУЩЕСТВЕННО in run 3; the ~1% guide puts it below the line, a floor like the one for tax-agent duties would fix it; (2) the model cannot know a person's gender behind a code («с учётом его статуса» about a woman); (3) a name stays undeclined when it follows an organisation in a list; (4) the first reply still varies (this time a four-option menu) although the prompt asks for the purpose question only. **`C1_ALLOW_PRIVATE_HOSTS` must now be removed on the server.** Remaining in step 4: one run against the 1С:Фреш trial base.

> Update November 13, 2026 (second 1C run on the mock — **8 of 8 planted errors found**; follow-ups): after the mock fixes the user re-ran the audit: 746 documents × 10,50 = 7 833 ₽, all eight planted errors reported, the unpaid half-year УСН advance now found from the credit balance on 68.12. One more unplanned finding, again a fault of the mock and again correct: accounts 90 / 91 / 44 were never closed. Changes after this run: (1) **mock** — month-end closing and year-end closing of 90, 91, 99 added (year is now 759 documents; the reader test checks those accounts end at zero); (2) **snapshot text** — amounts written the Russian way ("17 811 995,61"; the model copies what it is shown and the report had "17 811 995.61"), snapshot date in Moscow time, and a short note on what a base can and cannot show: a document missing from the base means "not entered", which is a risk flag, not a confirmed violation (the report had rated one such case confirmed and a like one a risk flag); (3) **names** — more safe cases for declension: "по …", "дивиденды …", "платежей …" (but not "получатель платежа …"), a role word in an oblique case ("участнику …", "директора …"), and a second name joined by "и" / a comma taking the case of the first; (4) **PDF report** — the fixed conclusion text said "замечания носят локальный характер" beside nine material findings, and "полностью соответствуют" when there were none; it now states the counts and claims nothing beyond the data checked; title "ОТЧЁТ ОБ АУДИТЕ". Still open from this run: the first reply again carried a preface before the purpose question; the dashboard rounds the cost to whole rubles (7 833 shown for 7 833,00; 7 802 for 7 801,50).

> Update November 13, 2026 (first 1C audit through the model, on the mock; names put back in the right case): **the user ran the mock base end to end** — 743 documents × 10,50 = 7 801,50 ₽, 10 findings recorded. **7 of the 8 planted errors found** (double payment, supplier without documents, round consulting payments, individual without НДФЛ/взносы, director's loan, dividends without НДФЛ, unposted sale); the unpaid half-year УСН advance was missed — the mock had no tax accruals, so the only clue was a payment missing from a list. The agent also found two errors that were **accidental faults of the mock** (goods account negative; УСН never accrued) — both real, both now removed from the mock; УСН advances are accrued quarterly and the unpaid one is a credit balance on 68.12 (mock year is now 746 documents). **Names in reports:** the model is told to keep a code in the nominative but often writes "в пользу [ФЛ_1]", giving «в пользу Лаптев Родион Аркадьевич». The prompt already had the rule — it is not followed reliably — so the fix is in code: on restore, a full name is declined (`petrovich` rules; new dependency) when the word right before the code fixes the case (в пользу / от / у / для / статус / доход / услуги … → genitive; выдан / выплачен / оплачено / заём / выплаты … → dative), also across "ИП", "участника", "директора". No governing word, a name not known in full, or a code inside a quotation («…», "…") → left exactly as before. Works in streamed text. Also: a first name missing from the dictionary ("Родион", "Милена") is now taken by word order when a patronymic is present. **No prompt change — `check:audit` re-run not required for this, but worth one run since restore is on every audit's path.** Reminder: `C1_ALLOW_PRIVATE_HOSTS=true` is set on the server for the mock test and must be removed afterwards.

> Update November 13, 2026 (step 4b — live 1C reader, built against the mock; **not yet run on a real base or through the model**): a client's 1C base is now read through its standard OData interface and audited. **Design: snapshot, not a live link.** `/api/audit/connect-1c` reads the audit's period ONCE (`lib/c1-reader.ts`), stores the result as a document of the audit (`file_type` `1c_odata`, JSON in storage) and quotes it; from there it is an ordinary document — cost shown, client confirms, analysis reads it, volume check, coding of individuals. **The 1C password is used for that one read and is never stored or logged** (the earlier idea of keeping a connection would have meant storing it). An audit is of the books as they stood at the snapshot.
> - **What is read** (month by month, no `$skip` paging): organisation, chart of accounts, counterparties, individuals; bank receipts and write-offs, goods/services received, sales, manual entries (posted and unposted, deletion-marked ignored); ledger postings (`RecordsWithExtDimensions`) and `BalanceAndTurnovers` computed by 1C. A document type not published in the base's OData composition becomes a warning, not a failure; the ledger and chart of accounts are required.
> - **What the model gets:** a facts block computed by 1C and by code — trial balance by account, settlements by counterparty/individual, documents by kind, account 51 turnover vs bank documents, unposted documents, write-offs identical in counterparty+amount+purpose, suppliers paid with no incoming documents, payments to individuals and sole traders, tax payments — then the postings and the document lists. Internal 1C identifiers are not shown. Mock year: 743 documents → 233 000 characters.
> - **Price (user decision): one operation per posted document of the period, all documents** — the kinds read plus any other document that made postings. Bank documents carry the same billing key as a line of a statement file (payment number + date + amount), so a statement uploaded beside the base is not charged twice. Mock year: 743 × rate.
> - **Coding by field:** names from the individuals catalogue and from counterparties flagged as natural persons go to the pseudonymizer as certain (`ParseResult.personNames` → `learnDetectedName`). Found and fixed on the way: **short patronymics (Ильич, Фомич, Кузьмич, Никитич…) were not recognised** — "ИП Орехов Тимофей Ильич" became two people and came back as a wrong name.
> - **Address check:** the address comes from the client and the request is made from our server, so local and internal addresses are refused (DNS-resolved; redirects refused). `C1_ALLOW_PRIVATE_HOSTS=true` lifts this — needed to test against the mock on localhost, **must not stay on in production**.
> - **Too large:** a snapshot above 90% of one request is refused with "split into quarters", never cut.
> - Old placeholder in `calculate-price` (counted one document type, no period) removed. `npm run test:1c` (reader vs mock: all eight planted errors visible as facts, coding, pricing, address check).
> - **To test end to end (user):** in Coolify set `C1_ALLOW_PRIVATE_HOSTS=true`, redeploy, in the auditor's terminal run `npm run mock:1c`, then create an audit — ООО, УСН «Доходы минус расходы», period 01.01.2025–31.12.2025, «Подключить 1С напрямую»: URL `http://localhost:8081`, base `mock`, login `odata.user`, password `mock-password`. Compare the report with the planted-errors table in `services/mock-1c/README.md`. Then remove the variable.
> - **Not done / unknown:** behaviour of a real base (time-outs, size limits, error wording, whether `$orderby`/`$select` behave the same) — step 4c on the 1С:Фреш trial; a base with several organisations is read whole (warning shown); tabular sections of documents (lines of goods) are not read; no refresh of a snapshot other than connecting again (the new snapshot's documents already in the audit are not charged twice); the prompt has no 1C-specific rules yet — the first real reports will show whether it needs them.

> Update November 13, 2026 (step 4a — mock 1C server; billing verified live): **billing confirmed in the browser by the user** after migration 005 — first file 28 operations; overlapping year file "71 операция, из них новых — 43 × 10,50 ₽ = 451,50 ₽"; five supporting documents 140 ₽ with the image at 0 ₽ and not analysed; text PDFs are read in production; the report counted 71 unique operations, not 99. Follow-up fixes from that test: a byte-identical repeated file is removed and the model is not called (it had produced a full report to say "nothing new"); masked card numbers keep their stars in reports; the typing cursor no longer sticks on app-written messages. **Mock 1C** — `services/mock-1c/` (`npm run mock:1c`, `npm run test:mock1c`): an HTTP server that answers like 1C's standard OData interface, built from a trimmed copy of the real `$metadata` the user exported from a 1С:Фреш trial. Invented ООО «Вектор-Трейд» (УСН Доходы−Расходы), one year, 747 documents, 937 postings, books balance (test checks debits = credits, bank turnover = bank documents), deterministic, scalable (`MOCK_1C_SCALE`), **eight planted errors** listed in `services/mock-1c/README.md`. **Next: the reader in the app (step 4b)**, then one run against the Фреш base — the mock cannot show real 1C's time-outs, paging limits or error wording. Observations for stage 2 (step 5): each added document currently produces a full eight-section report; the first reply still sometimes asks more than the purpose question.

> Update November 13, 2026 (xlsx reader fixed — found while preparing test documents): the hand-written xlsx reader in `lib/file-parser.ts` could put values in the wrong cells or lose them, without any error. Four faults: (1) text stored inline (`t="inlineStr"` — files written by Python tools and some web exports) was dropped — every text cell came out empty; (2) a text with mixed formatting is stored as several `<t>` runs in one shared string, and each run was counted as a separate string — every later text in the workbook shifted to the wrong cell; (3) empty cells are left out of the file, and rows were filled left to right — the values after a gap moved into the wrong columns; (4) `&amp;` / `&gt;` / `&#…;` were shown as written. Also: dates stored as Excel day numbers are now shown as dd.mm.yyyy (read from `styles.xml`), so the audit-period filter works on them — a day number used to pass any filter. The real ООО file reads the same as before (178 operations; only `&gt;` → `>`). `npm run test:xlsx`. **Still unverified: text PDFs in production** — the PDF reader fails under `tsx` in the workspace (pdf.js worker path), which may be only a workspace effect; a failed PDF is quoted as "текст не распознан", 0 ₽, and not analysed — the first PDF uploaded after deploy will show which it is.

> Update November 12, 2026 (per-document billing — step 3; **needs `supabase/migrations/005_document_billing.sql` run once in the Supabase SQL editor**): every uploaded document is now priced on the server and analysed only after the client confirms. **Until the migration is run the app behaves as before** (no quote, no confirmation, chat uploads unpriced) and logs a warning — `billingSchemaReady()` probes for the new column, so deploying first is safe.
> - **Quote at upload** (`/api/upload` reads the file synchronously): a list of dated operations → operations × the client's rate; any other readable document → pages × `billing_settings.price_per_page_rub` (20 ₽; PDF page, or 1 800 characters of Word / Excel / XML text); identical file already accepted → 0; image / scan → 0 and marked as not analysed (no text recognition yet). Logic in `lib/doc-billing.ts` (pure), stored on the document row (`billing_status` pending/confirmed/declined, `billing_kind`, `billing_units`, `billing_new_units`, `billing_rate_rub`, `billing_amount_rub`, `content_hash`).
> - **Each operation charged once per audit:** `lib/operation-keys.ts` — key = payment number + date + amount when the row has a number, otherwise the whole row; compared as multisets (two identical rows in one file = two operations; the same row in another file = the same operation). Keys of already accepted files are rebuilt from storage at quote time, nothing is stored. Sheets that repeat another sheet are left out (real ООО file: 178, not 313). Rows with an empty date cell (totals) are not operations.
> - **Confirmation:** chat shows a card with one line per file and the total; «Подтвердить и проанализировать» / «Отменить» → `/api/billing/confirm-documents`. Accept adds the server's amount to `audit_sessions.cost_rub` / `transactions_ct` / `pages_ct` (status change pending→confirmed is conditional, so a repeat cannot charge twice); decline deletes the file. A zero total is accepted without a question. The new-audit wizard uses the same path: `calculate-price` only reports the pending quote, `confirm_audit` accepts it — **the price and count sent by the browser are ignored**.
> - **Analysis reads confirmed documents only** (`/api/chat`); pending ones are named in a progress line.
> - **Frozen at completion:** completing an audit stamps `billing_frozen_at`; upload and confirmation are refused for a non-active audit.
> - **Access checks:** `/api/upload`, `/api/audit/calculate-price`, `/api/billing/confirm-documents` and `confirm_audit` require a signed-in user who owns the audit (or an admin); the client id is taken from the audit, not from the request (`authorizeSession`). **Other routes (`/api/chat`, the rest of `/api/data`, `/api/parse-file`) still have no access check.**
> - `npm run test:billing` (no LLM / DB): the 10-then-2 000 case charges 1 990, overlapping quarters, same file twice, twin payments, no-number fallback, format-independent keys, the 1C fixture (71 → 887,50 ₽), pages, unreadable.
> - **Not tested here:** the routes against a real database and the two screens in a browser (no Supabase in the workspace) — check after the migration: new audit → confirm → add a second overlapping file in chat → card shows only the new operations → totals on the audit.
> - **Known limits:** (1) **a bank statement uploaded as PDF or Word is priced per page, not per operation** — operations are recognised only in xlsx / xls / csv / 1C txt with a date column; open decision. (2) The same operation exported in two different layouts matches only when both have a payment number column. (3) A sheet that repeats ≥90% of another is skipped whole, so its few non-matching rows are not charged. (4) Totals are incremented, not recomputed (legacy audits keep their old recorded price). (5) Documents uploaded on the «Документы» page land in a session without a tax profile and stay pending. (6) The live-1C branch of `calculate-price` is still the old placeholder (step 4).

> Update November 12, 2026 (volume caps removed — step 2 of the plan below): **documents are no longer cut.** `lib/file-parser.ts` passed at most 500 rows per sheet / 500 1C operations / 50 000 characters per document and dropped the rest (a note said so for rows, but not for the character cut on xlsx/xls/xml) — a year of operations was audited on its first weeks. All caps are gone: every row and character reaches the model. The only ceiling is the model's own: **`lib/volume.ts`** — DeepSeek V4 Pro context 1 000 000 tokens (provider listings; the official page could not be opened from the workspace — override with `LLM_CONTEXT_TOKENS`), minus the 64 000 output budget and a 20 000 reserve, at a cautious 1.8 characters per token → **1 648 800 characters per request** (`LLM_MAX_REQUEST_CHARS` overrides). `/api/chat` checks system prompt + documents + chat history before any model call; over the limit → **refused with a Russian message naming each file and its size, nothing sent, nothing shortened** (no automatic splitting — user decision). If the estimate passes but the API rejects the size, the same message is shown (`isContextLimitError`). Also: `documents.parsed_data` now stores counts only (`toParsedSummary`, with `textChars`) — the full text used to be copied into the DB row; name-service calls go in 150 000-character pieces, 120 s each (one call for a large file could time out and block the audit). `npm run test:volume` (no LLM). Coding speed measured here: 2.8M characters in 17 s. **Not measured: Natasha's speed on a large file, and a real large audit on DeepSeek.** Cost note: the whole document set is re-sent on every chat turn — a request near the limit is roughly 600–900 thousand tokens, about $0.8–1.2 of input per turn at the peak price used in `AUDIT_MODEL_PRICING`. Upload size limit stays 50 MB per file.

> Update November 12, 2026 (billing / volume decisions + work order — agreed with the user, discussion only; built step by step from here):
> **Two-stage product.** Stage 1 — analysis: finding errors, priced **per operation (12.5 ₽, existing rate)**. Stage 2 — correction: the client uploads supporting documents the agent asks for (payment orders, contracts, shipping documents, bills, acts) and the errors are worked through with the application; a separate service priced **20 ₽ per page**.
> **What a page is:** one PDF page; one image; 1 800 characters of Word / Excel / text content. A file that brings NEW operations (another statement, a longer period) is charged per operation whatever its type.
> **Charging rules:** counted on the server, never taken from the browser; the client **sees the cost and confirms before a file is analysed** (closes the loophole: a 10-operation file priced at the start, then a 2 000-operation file added in chat and audited for free — chat uploads call `/api/upload` only and were never priced); **no free pages**; the same file is charged once; unreadable pages are not charged; the user invoices afterwards for the recorded amount → the server records what was actually analysed and the amount is frozen at completion.
> **Overlapping files:** each operation is charged once — matched by payment number + date + amount where the document has a number; otherwise by date + amount + counterparty + purpose, counting repeats (two genuinely separate payments carry different numbers, so the fallback matters only for exports without numbers).
> **Volume:** no caps except the model's real limit; never cut silently; too big for one request → refuse clearly, no automatic splitting for now.
> **Security:** `/api/audit/calculate-price` is unauthenticated and trusts the browser — to be closed with the billing work.
> **Still open:** computed facts for Excel/CSV (large spreadsheets rely on the model's arithmetic); OCR (stage 2 depends on it — contracts and bills arrive as scans); stage-2 mechanics (link a document to a finding, close a finding, before/after report).
> **1C:** most audits are expected to run on a live 1C connection, with files for the rarer cases. The user opened a 1С:Фреш trial («Бухгалтерия предприятия», empty database), enabled the standard OData interface and exported the real `$metadata` (7 MB; ledger `AccountingRegister_Хозрасчетный` with Balance / Turnovers / BalanceAndTurnovers / DrCrTurnovers / RecordsWithExtDimensions; 146 documents incl. bank receipts / write-offs with incoming number + date and `РазметкаАУСНБанка`; 305 catalogues). Not in that export: invoices (СчетФактура*), tax-system / accounting-policy registers, cash-flow items. Decision: **build a mock 1C server in the repo from this real structure first** (controlled data with planted errors, repeatable, no trial expiry), then one run against the Фреш database for real-protocol behaviour. Only a trimmed copy of the structure goes into the repo.
> **Order of work:** (1) these notes; (2) volume; (3) billing — server-side counting, confirmation before analysis, overlap rule, protected endpoint; (4) 1C mock + reader; (5) OCR, then stage 2.

> Update November 12, 2026 (user decision): **tax-agent risks are never below СУЩЕСТВЕННО** — possible non-withholding / non-payment of НДФЛ on dividends, salaries and other payments to individuals, or agent НДС, regardless of its share of turnover (on the ООО file the 71 500 ₽ НДФЛ on 550 000 ₽ of dividends had been rated НЕСУЩЕСТВЕННО as < 1% of turnover). Written into "КРИТЕРИИ УРОВНЕЙ РИСКА" as an explicit exception.

> Update November 12, 2026 (first ООО audit on DeepSeek, coded, with Natasha): report on the real ООО file (УСН Доходы − Расходы, НДС не облагается, 178 operations) checked figure by figure against the xlsx — **all amounts, shares and tax estimates correct** (totals 8 453 308,97 / 9 289,00; unlinked documents 8 416 106,97; three suppliers 79,2%; dividends 550 000 → НДФЛ 71 500; misc. non-expense items 976 150; duplicate ИП payment 35 000 × 2 on 12.08.2024; partial payments to one supplier correctly not called duplicates; УСН declaration deadline 25.03.2025). Names came back restored (Natasha's nominative forms). **Wrong: operation counts — "313 операций / 311 без документов" instead of 178 / 176** (both sheets counted). **Weak findings:** (a) "incorrect classification as «Оплата поставщику»" recorded as a confirmed accounting violation — that column is the bank export's automatic label, not the client's bookkeeping; (b) "no primary documents" recorded as *confirmed* — the export only proves documents are not attached in that service. **Fixes:** `lib/sheet-overlap.ts` — xlsx sheets that repeat another sheet's rows are detected (multiset match on shared columns, ≥90%), a note tells the model, and **`rowCount` no longer counts them twice (313 → 178; this also affects the per-operation price)**; prompt rules for export labels / "document not attached" marks (risk flag, not confirmed) and for repeated sheets; `PSEUDONYM_NOTE` asks the model to place person codes in nominative position (restored names were read as "выплата Лобанова Екатерина Олеговна"). `.xls` and CSV paths do not have the repeated-sheet check. Not yet re-run.

> Update November 12, 2026 (name service live + first real ООО file): Natasha app deployed on Coolify with **Network alias `ner`** (Option A works on Coolify v4.3.23 — the field is in the app's Networking dialog and needs a redeploy to apply); auditor has `NER_URL=http://ner:8000` + `NER_TOKEN`; connection check returned 200. The user supplied a real ООО bank-accounting report (xlsx, 2 sheets, 178 operations Feb–Sep 2024, 15 individuals/ИП as counterparties, one name + phone inside square brackets in a payment purpose, card masked as `220015++++++0023`). Run LOCALLY only (nothing sent to any LLM). It exposed three defects, all fixed: (1) **the audit would have been blocked** — a name inside the source text's own `[...]` was mistaken for one of our codes, left uncoded, and the fail-closed scan then (correctly) refused the request; (2) cards masked with `+`/`x` were not coded; (3) Natasha returned ordinary words as persons ("Контрагент" — the column header, "Верификационный") — a single-word span is now accepted only with a surname shape. After the fixes, with and without the service: 15 persons, 1 phone, 1 card coded, no known name left. `test:pii` has cases for all three. **Open, found on the same file:** the xlsx has two sheets and the first («Без подтверждающих документов», 135 rows) is a subset of the second («Полный список», 178) → the model receives 313 rows for 178 operations (double-counting risk); xlsx files get no computed-facts block; the file has no balances, accounts or ИНН. Not yet audited by DeepSeek; not yet a regression fixture (needs the client's tax regime / VAT status and an agreed list of expected findings).

> Update November 12, 2026 (name service aligned with `Self-Host-Migration.md`): that file records (checklist item 7 / gotcha 2) that a Coolify container's internal hostname changes on every redeploy with no stable alias by default — so the earlier "alias `ner`, no domain" instruction is only Option A, to be used if this Coolify version has a Network Aliases field. **Option B = the infra's proven pattern: own domain through Traefik (Pattern B, e.g. `ner.assistant24info.ru`).** Because the service may therefore be public, **`NER_TOKEN` is now mandatory**: the service answers 503 without one configured and 401 on a wrong token (constant-time compare); the client refuses to call without a token and refuses plain `http://` to a non-private host. `/health` stays open (no data). Other points taken from that file for this app: Build Pack must be set to Dockerfile explicitly, Ports Exposes 8000, env vars in both Production and Preview, retry on the intermittent `git ls-remote` block. Steps rewritten in `services/ner/README.md`. Note for the infra file itself: the auditor no longer needs `ANTHROPIC_BASE_URL` / the KZ proxy while it runs on DeepSeek.

> Update November 12, 2026 (Natasha name service built): **`services/ner/`** — FastAPI + Natasha 1.6 (Python 3.10; pymorphy2 breaks on 3.11+), own Dockerfile, to be deployed as a **separate Coolify app from this same repo** (Base Directory `/services/ner`, port 8000, NO domain, network alias `ner`) — steps in `services/ner/README.md`. `POST /names {texts}` → PER spans; ALL-CAPS fields are true-cased first with the morphology dictionary (plain NER misses caps). No content logging. App side: `lib/ner-client.ts` + `Pseudonymizer.learnDetectedName()` (roles assigned by our code — Natasha's first/last split is unreliable), called from `runAuditTurn` before coding. **`NER_URL` set → service REQUIRED: unreachable = audit blocked, no model call (user decision). `NER_URL` unset → shape rules only.** Optional `NER_TOKEN`. Startup log shows `ner=on/off`. Verified here end to end against a locally running service: bare surnames in free text and in caps ("возврат займа Сидорову", "ВЫПЛАТА КУЗНЕЦОВОЙ", "учредителю Шевчук", "Коту В.П.", "Гусь Марине") are now coded; companies untouched; restore uses the nominative form. `test:pii` section 3 covers the integration and the blocked-when-down behaviour. **Not yet deployed on Coolify; Docker image build not tested here (no Docker daemon) — only the same pinned packages under Python 3.10.** Still not caught: rare surnames written in ALL CAPS with no initials/first name (e.g. "УЧРЕДИТЕЛЮ ШЕВЧУК"), addresses, dates of birth.

> Update November 12, 2026 (first coded run against DeepSeek): **`check:audit` PASSED 3/3 with pseudonymization ON and review OFF.** Log per run: `pseudonymized — persons: 1, identifiers: 6`. All three runs produced the same four findings at the same levels (card top-ups + duplicate invoice СУЩЕСТВЕННО/risk_flag; concentration + mixed spending НЕСУЩЕСТВЕННО/indirect) — the most consistent result so far; reports came back with no codes and the client's name restored. 2.5–4 min and ≈$0.10 per audit. The turnover and "tax not paid" prompt fixes held (no КРИТИЧНО, no tax-unpaid finding). Only warning: the 1 137 ₽ transfer is no longer named (0/3) — the ledger net is cited instead. Also today: deploy fixed by bundling Geist fonts locally (`geist` package) — the build can no longer fail on fonts.googleapis.com; `test:pii` made independent of server env. **Before real client data:** Natasha NER service (bare surnames), a second fixture with a different profile (ООО / payroll / НДС, names in free text), xlsx/csv coding check, server-side access checks on API routes, legal sign-off. Coolify: untick "Build Variable" for `LLM_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.

> Update November 12, 2026 (`check:audit` with review OFF, before the pseudonymization deploy): 4–6 min and ≈$0.15 per audit. Core findings stable 3/3. Two anomalies in 3 runs: (1) card top-ups rated КРИТИЧНО once — caused by an ambiguous "turnover" definition in the prompt (20 095 vs 51 795 as the base); **fixed: turnover = all inflows minus own-account transfers = the facts block's third-party inflows total; tax risk is measured by the tax amount, not the operations' amount**; (2) "АУСН tax for November not paid" recorded as СУЩЕСТВЕННО once — the test had no check for it; **fixed: a payment missing from this statement that could have gone through another own account (tax-reserve account / ЕНС) is a «Границы проверки» item; "no tax payments" is a risk flag only when a quarter or more shows neither budget payments nor reserve transfers**; new required check `tax-unpaid`. Review on vs off: 9 reviewed runs had neither anomaly, 3 unreviewed runs had two — but these were new kinds of error and the samples are small, so this is **not** evidence either way yet.

> Update November 12, 2026 (Step C — pseudonymization v1 built): **`lib/pseudonymize.ts`**, wired into `lib/audit-engine.ts` (`runAuditTurn(..., pz)`), so `/api/chat` and `check:audit` share it. ON by default for DeepSeek (`LLM_PSEUDONYMIZE=disabled` only for synthetic tests). **Design changed from the Nov 2 plan: no stored token map.** Our DB keeps real data; each request re-codes the documents + real chat history from scratch (same order → same codes within the request, which is all the model sees), and restores the reply. Nothing reversible is persisted. Scope: individuals only. Codes: `[ФЛ_n]` (ФИО in any detected form; "ИП" stays outside), `[ИНН_ФЛ_n]` (12-digit), `[ОГРНИП_n]`, `[СЧЕТ_n:40802]` (individual/ИП account prefixes 40817/40802/40820/40803/40813/423xx/426xx; type prefix kept), `[КАРТА_n]` (full or masked), `[СНИЛС_n]`, `[ПАСПОРТ_n]`, `[ТЕЛ_n]`, `[EMAIL_n]`. Companies, 10-digit ИНН, company accounts, amounts, dates, document numbers stay. The static system prompt is not coded (only context + documents + messages); `PSEUDONYM_NOTE` tells the model how to use codes. Restore: answer text and thinking (stream-safe, split codes buffered), draft, `record_findings` input; unknown codes are left visible and counted in the log. **Fail closed:** after coding, the outbound text is scanned for every known original; any hit or coding error → `PseudonymizationError`, nothing sent, client sees a clear message; images/other blocks cannot be sent in coded mode. **Tests: `npm run test:pii`** (no LLM) — coding rules, restore, 50 random-split streaming rounds, fail-closed, and a LEAK SCAN: a full draft+review turn on the fixture against a fake model that records the exact outbound payload. Also checked locally on the original (non-anonymised) statement: 1 person, 6 identifiers, nothing personal left, exact round trip. **Not yet run against DeepSeek** — `check:audit` now runs coded and has a required check that the report comes back with no codes. **KNOWN LIMITS (v1 is rules, not NER):** a name is found only in a recognisable shape (after ИП, with a patronymic, with initials, or next to a common first name with a surname-shaped word) — a bare unknown surname in free text is missed unless the person appears elsewhere in a recognisable shape; addresses and dates of birth are not coded; same-surname people without initials share one code; a name seen only in an oblique case is restored in that case. **Still open:** Natasha NER service (closes the bare-surname gap), xlsx/csv column-based coding review, legal sign-off (152-FZ), scans/OCR (Step B).

> Update November 12, 2026 (fifth `check:audit` run): **PASSED — all required checks 3/3 for the first time** (DeepSeek V4 Pro, thinking max, review on, computed facts, marking rule, 25th-deadline rule). Findings 4/3/4: card top-ups + duplicate invoice (СУЩЕСТВЕННО) and mixed spending (НЕСУЩЕСТВЕННО) in every run; concentration in 2 of 3. ≈$0.26 and 8–9 min per audit. Still varying: the duplicate's status (`risk_flag` ×2, `confirmed` ×1) and whether concentration is listed. **Caveats:** one fixture, three runs, and the prompt was tuned on this same file — a second fixture of a different profile (e.g. ООО on ОСНО / УСН with payroll and НДС) is needed before trusting the result broadly. **Review pass:** draft and final findings were again the same in all three runs; across nine reviewed runs it has not removed an error — decision on keeping it still open. Next agreed step: pseudonymization (Step C).

> Update November 12, 2026 (fourth `check:audit` run + decision): with computed facts, the calculation errors are gone (ledger used 3/3; duplicate + card top-ups stable 6 runs in a row, same level/status). Duplicate is now `risk_flag` 3/3 instead of `confirmed` (facts block calls it a "candidate") — accepted as defensible. Minor findings still vary (5/5/2). Review pass: still no run where it removed an error. Remaining failure (1/3) was a judgment call, not a calculation: "November revenue got no automatic reserve → bank may not have marked it as income". **User decision: limits only.** Whether the bank marked revenue as income on АУСН is ALWAYS a «Границы проверки» item ("check the marking in the bank's АУСН cabinet") and NEVER a finding at any level; tax-fund transfers are a savings service, not proof of marking. Written into the АУСН block of the prompt and into the review checklist; `check:audit` now fails on any such finding at any level and warns if «Границы проверки» doesn't mention the marking. Not yet re-run.

> Update November 12, 2026 (third `check:audit` run + computed facts): with the review pass, 3 runs gave 5/5/4 findings with the same four core findings every time (duplicate, card top-ups, mixed spending, concentration) — but **draft and final counts were identical in every run, so there is no evidence yet that the review pass itself helps**; the steadier drafts most likely come from the earlier prompt changes. ≈$0.29 and 8–11 min per audit. Still failing 1/3: November reserve flagged СУЩЕСТВЕННО — root cause seen in the report: the model treated the 1 137 ₽ transfer to the client's own tax-reserve account as an unrelated "own transfer" and missed that all 2 376 ₽ reserved on top-ups was returned. **Fix built: `lib/statement-facts.ts`** — a "РАСЧЁТНЫЕ ФАКТЫ" block computed in code for 1C statements and placed before the operation list by `parse1CTxt`: (1) totals vs. the statement's totals and balances, (2) a ledger per OWN counter-account (same ИНН both sides): moved to / returned / net + every operation, (3) third-party inflows and outflows by counterparty with shares, (4) repeated-payment candidates (same receiver + document number + amount). Deliberately narrow: arithmetic and grouping only, no bank-specific wording rules, no interpretation. Covered by `npm run test:facts` (code test, no LLM, values independently verified). Prompt tells the model to take totals from the block and treat each own account as one ledger. `check:audit`: new required check (report states the 1 607,64 net or the 2 376 full return); травматизм check now ignores correct "not owed" sentences. **Not yet run against DeepSeek.** Only 1C exports get the block — xlsx/csv/pdf statements don't.

> Update November 12, 2026 (quality-review pass): user decision — **audit time doesn't matter, quality is essential.** Every full report is now produced in two passes, in the new shared **`lib/audit-engine.ts`** (`runAuditTurn`, used by both `/api/chat` and `check:audit`): (1) DRAFT — the audit as before; its text goes to the «Ход рассуждений» panel, not to the client as the answer; (2) REVIEW — a fresh call (same system prompt + documents, none of the draft's reasoning) acts as a reviewing auditor (`buildReviewRequest` in `lib/llm.ts`): recomputes, tests every draft finding (facts, reconciliation, applicability, evidence, severity, consistency), looks for missed items, writes the FINAL report and makes the only `record_findings` call that is saved. Short replies (purpose question, follow-ups) are not reviewed — only replies with «Резюме аудитора» or a `record_findings` call. Fallback: review error / cut off / no report / zero findings when the draft had some → the draft is delivered, step says the review wasn't completed, log `reviewed: failed`. New NDJSON event `{type:"reset"}` (client clears answer text). `LLM_REVIEW=disabled` turns it off. Roughly doubles time and cost (expect 10–20 min per audit at effort max). Engine logic verified with a mocked model (7 scenarios); **not yet run against DeepSeek** — run `npm run check:audit` (now prints draft → final findings and requires `reviewed: done`). **Known fragility:** a 10–20 min audit over one open HTTP stream; move audits to background jobs before/with multi-run consolidation (next planned step), then narrow pre-computed facts.

> Update November 12, 2026 (second `check:audit` run): stable 3/3 — duplicate invoice, no "missing documents", no 402-ФЗ vs ИП, no КРИТИЧНО, totals, sections, no травматизм. **Unstable between runs:** number of findings (3 / 5 / 6), whether card top-ups are a finding (missing in 1 run), and the November reserve flagged as СУЩЕСТВЕННО (1 run, judging by titles). **The test's own two wording-based checks were wrong** (two false fails in run 1 on a title containing «резерв», one false pass in run 2) — rewritten to match findings by the amounts/operations they cite; verified against the titles of both real runs. Prompt: inflows of unidentified origin (card top-ups, cash, transfers from individuals) above ~10% of inflows are always a recorded risk flag. **Open design question:** run-to-run variance is inherent (DeepSeek fixes temperature in thinking mode); the structural fix is to compute totals / own transfers / duplicates / counterparty shares / reserve pairing in code and hand the model a "pre-computed facts" block, instead of adding more prompt rules. Not built — awaiting decision.

> Update November 12, 2026 (first `check:audit` run + prompt tweak): 3 runs on DeepSeek V4 Pro, thinking max — **8–10 min and ≈$0.15 per audit**. 9 of 10 required checks passed 3/3 (duplicate, top-ups, no "missing documents", no 402-ФЗ vs ИП, no КРИТИЧНО, totals, new sections). Failed 2/3: a СУЩЕСТВЕННО risk flag "November income without 8% reserve" — although the same report reconciled the reserve to the kopeck under «Проверено без замечаний»; the flag rested only on a hypothesis about data not in the statement (the bank's АУСН marking) plus manual-vs-automatic reserving. Prompt tweak: a difference in METHOD with a reconciled total is not a deviation; a doubt resting only on invisible data goes to «Границы проверки» (at most indirect/НЕСУЩЕСТВЕННО); no topic may be both "checked, no remarks" and a finding; a recoverable overpayment is СУЩЕСТВЕННО, not КРИТИЧНО, whatever its share of turnover. **Re-run `npm run check:audit` after redeploy.**

> Update November 12, 2026 (regression test): **`npm run check:audit`** (`scripts/check-audit.ts`) runs a full audit N times (`RUNS`, default 3) on `scripts/fixtures/ip-ausn-statement.txt` — an **anonymised** copy of the ИП/АУСН statement used for the Sonnet-vs-DeepSeek comparison (name, ИНН, accounts, cards, supplier, contract number invented; amounts/dates/purposes unchanged; stored in CP1251 so it goes through the real `parse1CTxt`). Required checks per run: one `record_findings` call; valid enums; duplicate invoice 83973/007 found; own-card top-ups (31 700) flagged; tax reserve NOT reported as missing; "no primary documents" not a finding; no 402-ФЗ/ПБУ as basis against an ИП; no КРИТИЧНО; statement totals in the report; sections «Проверено без замечаний» / «Границы проверки». Warning-only: 1 137 reserve mentioned, concentration / personal spending not above НЕСУЩЕСТВЕННО, no greeting, 3–7 findings. Reports saved to a temp folder. Check logic verified offline with mock results; **not yet run against DeepSeek.** Run it after every prompt/model change. **Also fixed:** `parse1CTxt` now passes `payerAccount` / `receiverAccount` to the model — before, the AI could not tell the client's own accounts apart (main vs. the bank's tax-reserve account), which contributed to the false "reserve missing" finding.

> Update November 12, 2026 (prompt revision): **`AUDIT_SYSTEM_PROMPT` rewritten** after a side-by-side of Sonnet 5 vs DeepSeek V4 Pro (thinking max) on the same 71-operation ИП/АУСН bank statement. Result of the comparison: both found the duplicate invoice payment; DeepSeek alone found that 58.5% of inflows were own-card top-ups (АУСН tax-base risk) and gave exact, verified figures; DeepSeek's false positive — "November tax reserve not made" although a 1,137.00 ₽ transfer to the tax account = exactly 8% of the 14,212.09 ₽ income; Sonnet wrongly said almost all inflows were factoring (really 37%) and rated "no primary documents provided" as СУЩЕСТВЕННО. Prompt changes: (1) "ПРИМЕНЯЙ ЗАЯВЛЕННЫЙ РЕЖИМ" — what applies to ИП vs organisations and to ОСНО/УСН/АУСН/ПСН/НПД (e.g. no 402-ФЗ/ПБУ against an ИП, personal spending by an ИП is not a violation by itself); (2) mandatory preparatory step — totals, classify each operation, own transfers excluded from revenue/concentration, **reconcile before claiming anything is missing**, every % with its base; (3) limits of the audit are not violations → new report section «Границы проверки»; new section «Проверено без замечаний»; (4) severity scaled to turnover (~1% / ~5% guides), concentration and ИП personal spending default to НЕСУЩЕСТВЕННО, lower level when in doubt; (5) duplicates = same document number + counterparty + amount regardless of interval; (6) «Основание» may state that no specific norm is breached; (7) no padding. **Not yet tested against DeepSeek** — re-run the same file in a fresh session and compare. Next: regression test on an anonymised copy of that statement (never commit the original — it contains a real person's data).

> Update November 12, 2026 (later still): **Chat shows live progress + the AI's real thinking** (user choice: "steps + thinking panel"). Like Car-Parts session 29, but this app also streams the raw thinking. `/api/chat` NDJSON gained two event types: `{type:"step", text}` (real pipeline steps — documents found, «file»: N операций, earlier findings counted, sent to the AI, AI thinking, writing the report, continuation, findings recorded/saved/duplicates skipped) and `{type:"thinking", text}` (DeepSeek thinking deltas, batched every 300 ms). Document reading moved inside the stream so its steps are live. Chat page: checklist (last 4 done with ✓, current step with its seconds after 8 s, total timer), a collapsible «Ход рассуждений ИИ» panel (collapsed by default, auto-scrolls), and the same panel under the finished answer — kept in page state only, **not saved to the DB**, gone after reload. Old rotating lines remain only as a fallback until the first step arrives. ⚠️ Step C: the restorer must also run on thinking text. DeepSeek's thinking may be partly in English.

> Update November 12, 2026 (later): **DeepSeek is live in production** (`LLM_API_KEY` set in Coolify; reachable directly from the VPS — the Kazakhstan proxy is no longer used by this app). **Thinking is now ON by default at effort `max`** (user decision: maximum audit quality first). `lib/llm.ts`: `thinking: {type:"enabled"}` + `output_config: {effort: LLM_EFFORT}` (default `max`; DeepSeek's thinking-mode guide: effort low/high/max, v4-pro maps max→max), `AUDIT_MAX_OUTPUT_TOKENS` 64000 when thinking. Opt-out: `LLM_THINKING=disabled`, `LLM_EFFORT=high`. `/api/chat` continuation on `max_tokens` now passes back the full assistant content incl. thinking blocks (tool_use blocks dropped), as DeepSeek requires in thinking mode. Expect slower first text (minutes possible) and higher output-token cost; heartbeat keeps the stream alive and `maxDuration` is not enforced under `next start`. Still to verify: a full fresh-session report + one `record_findings` call with thinking on.

> Last updated: November 12, 2026. **DeepSeek V4 Pro switch built in code (Step A) — not yet live.** Production keeps running on the old Anthropic setup until `LLM_API_KEY` is set in Coolify; setting it switches to DeepSeek, removing it rolls back. Details in the new Session Log entry below. Summary:
> - `lib/anthropic.ts` → **`lib/llm.ts`**, provider-neutral exports (`llm`, `AUDIT_MODEL`, `AUDIT_MODEL_PRICING`, `LLM_PROVIDER`, `LLM_SUPPORTS_IMAGES`, `LLM_EXTRA_PARAMS`, `AUDIT_MAX_OUTPUT_TOKENS`). New env vars: `LLM_API_KEY` (required to enable DeepSeek), optional `LLM_BASE_URL` (default `https://api.deepseek.com/anthropic`), `LLM_MODEL` (default `deepseek-v4-pro`), `LLM_THINKING` (`enabled`/`disabled`, default disabled). Diagnostic `console.log` removed.
> - **Confirmed from DeepSeek's Anthropic-API docs:** `deepseek-v4-pro` does **not** read images (replaces them with "[Unsupported Image]" — but the bytes would still be uploaded). So on DeepSeek, images and scanned PDFs are **never sent**; the model gets a note saying the document wasn't analyzed and must tell the client. Tool calling works with `tool_choice: auto`; `tool_choice: {type:"tool"}` fails in thinking mode, and thinking-mode tool continuations need thinking blocks passed back → thinking **disabled by default**.
> - Pricing constant: $1.32 / $3.96 per 1M (peak; off-peak is half), as reported Nov 2026 — official page couldn't be opened from the build workspace, re-check before billing on it.
> - New `npm run check:llm` (`scripts/check-llm.ts`): runs the real prompt + tool + streaming against a synthetic statement and checks purpose-question-first, no greeting, one valid `record_findings` call. **Not yet run** — the build workspace can't reach api.deepseek.com; run it locally with the key in `.env.local`.
> - **Decided: pseudonymize individuals only** (people, ИП, employees, directors). Company names (ООО, АО…) stay readable. Closes the open decision below.
> - **Under consideration (not decided):** a self-hosted OCR service on our own Coolify server (e.g. PaddleOCR, CPU) instead of GigaChat for scans/images — keeps scans on our servers; could share one Python service with the Natasha name detector. GigaChat stays as a possible fallback.
> - Car-Parts repo's `lib/pii.js` reviewed as a reference: one-way masking of phones/emails only — the pattern (mask before every LLM call, narrow regexes, `test-pii`) carries over, but this app needs reversible tokens + restore (Step C).

> Last updated: November 2, 2026. **Decided: switch the audit LLM from Anthropic (Claude Sonnet 5) to DeepSeek V4 Pro — Anthropic is banned in Russia.** Planning/design session only — **no code changed yet; building starts next session.** Decisions made with the user:
> 1. **Integration route: DeepSeek's Anthropic-compatible endpoint** (`https://api.deepseek.com/anthropic`, model `deepseek-v4-pro`). Keeps the existing `@anthropic-ai/sdk` code path (streaming, NDJSON heartbeat, `record_findings` tool) — mostly a config change (`ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, model id). Rename `anthropic`/`SONNET_*` to provider-neutral names while doing it. User has a DeepSeek API key (goes into Coolify env, never the repo).
> 2. **Scanned PDFs / images → GigaChat** (Sber, hosted in Russia) for vision/OCR, since DeepSeek V4 Pro image input could not be confirmed. GigaChat returns text, which then goes through the same pseudonymization path as every other document.
> 3. **Pseudonymization must be in place BEFORE any client data is sent to DeepSeek.** Reversible coding: a local program replaces personal data with tokens → DeepSeek works on coded text → the program restores the real values in the output (chat messages and findings) before it reaches the client or the DB.
> See the new section **"Planned Change: LLM Provider Switch — DeepSeek + GigaChat + Pseudonymization"** below for the full design, and `PUNCH_LIST.md` → "NEXT SESSION" for the build checklist. Open question still to answer: pseudonymize individuals only (152-FZ scope), or also company names (commercial confidentiality)?

> Last updated: September 22, 2026. **Self-host migration completed end-to-end — app is now live on Coolify + self-hosted Supabase, both fully verified.** Following the plan from the September 3 entry below, both new Russian VPS servers were provisioned and the full stack was migrated in one session using `Self-Host-Migration.md` (the cross-project master migration reference) as the guide:
> - **Supabase Stack 3** stood up on `assistant_vps_3` (77.222.47.140, ports 8002/5434/6545 — the third and last pre-allocated slot in that VPS's port ledger). Schema rebuilt from live Cloud introspection (not the drifted original migration files — see below), all 6 `auth.users` rows and all 10 `public` table's data migrated via `pg_dump --data-only`/`psql`, all 138 Storage files copied via a Node script using both projects' service-role keys. Row counts verified matching Cloud exactly at every step.
> - **Coolify app** deployed on `assistant_vps_4` (168.222.202.222) directly from the GitHub repo, Dockerfile build pack (repo already a standard `next start` server — no Vercel-serverless-function shim needed, unlike other apps on this Coolify instance). Env vars set to the 5 that are actually live in production (`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) — confirmed `USD_TO_RUB` and `C1_*` are not used by the current live SpaceWeb deployment either, so intentionally omitted rather than migrated as dead config.
> - **Anthropic proxy unchanged** — still the existing Kazakhstan VPS (`audit.assistant24info.ru`), confirmed generic/reusable and shared across several other Coolify apps on this infrastructure, not just this project. `lib/anthropic.ts` already reads `ANTHROPIC_BASE_URL` via the SDK, so no code change was needed.
> - **New domain** `auditor.assistant24info.ru` (A record → 168.222.202.222, the Coolify VPS — deliberately a *different* subdomain from `audit.assistant24info.ru`, which stays pointed at the Kazakhstan proxy and must not be repointed). HTTPS via Coolify/Traefik's own Let's Encrypt integration (on-demand issuance — the cert isn't requested until the first real TLS handshake hits the router *after* a redeploy has applied the domain's Traefik labels; an earlier redeploy-less domain add caused a stuck self-signed-cert state until this was understood).
> - **Three new gotchas found and fixed, worth adding to `Self-Host-Migration.md`'s numbered gotcha list for future migrations:**
>   1. *GoTrue requires empty-string, not NULL, for `auth.users`' token columns* (`confirmation_token`, `recovery_token`, `email_change_token_new`, etc.) — manually inserting users via SQL without setting these left them NULL, which is schema-legal but crashes GoTrue's Go code with `converting NULL to string is unsupported` on every login attempt, surfaced misleadingly as generic 500s. Fixed with a blanket `COALESCE(col, '')` update across all 6 users.
>   2. *A JWT signed with the wrong/stale secret fails silently until first real use* — the first `ANON_KEY`/`SERVICE_ROLE_KEY` pair generated for Stack 3 didn't actually validate against its own `JWT_SECRET` (root cause not fully diagnosed — likely a shell/heredoc timing issue during generation), which surfaced only once Storage uploads were attempted (`ERR_JWS_SIGNATURE_VERIFICATION_FAILED`), not at generation time. Regenerated and verified by manually recomputing the HMAC signature server-side before trusting the new keys — worth doing this verification step by default on every future key generation, not just when something breaks.
>   3. *`auth.users.confirmed_at` is a generated column in this Postgres image version* — the original migration doc's manual-insert example includes it explicitly; it must be omitted from the column list entirely (not just left NULL) or the insert fails outright.
> - **Also found and fixed, unrelated to the migration itself:** `app/page.tsx` was still the fully unedited `create-next-app` scaffold — pre-existing on every prior deployment (Vercel, SpaceWeb), just never surfaced because nobody visits bare `/` in normal use. Replaced with a redirect to `/login`. `layout.tsx`'s `metadata.title` is still "Create Next App" — noted, not yet fixed.
> - **Not yet done:** decommissioning Vercel/SpaceWeb (both still live, untouched); confirming the mixed-content/same-origin question for `NEXT_PUBLIC_SUPABASE_URL` (currently the raw `http://77.222.47.140:8002` — worked in initial testing over the new HTTPS domain, but per `Self-Host-Migration.md` gotcha 13 this should be verified deliberately via DevTools Console rather than assumed safe just because nothing visibly broke); Storage bucket-level policies on `audit-documents` were never explicitly set (relies on `documents` table RLS alone — should be confirmed this is sufficient, not assumed).

> Last updated: September 3, 2026. **SpaceWeb Serverless (beta) discovered to have a platform-level caching bug that ignores the app's own cache settings entirely** — every response served with `Cache-Control: s-maxage=31536000` (one year) and `X-Nextjs-Cache: HIT`, meaning newly deployed code never reaches users regardless of how many times the app is rebuilt. Confirmed via `export const dynamic = "force-dynamic"` at the root layout having zero effect on the served headers, and via a DevTools global search proving a known test string from a fresh build was completely absent from every loaded file. Root-caused to SpaceWeb's own infrastructure (Envoy edge layer), not the app's code — `next.config.ts` has no conflicting header/caching config. **Decision: abandon SpaceWeb Serverless, self-host instead** via **Coolify** on a new Russian VPS (full control over caching/headers, no beta platform surprises), keeping the same working Kazakhstan-VPS-proxy-for-Anthropic architecture. **Also decided, separately: self-host Supabase** (not just the app) on a second new Russian VPS, for 152-FZ data-residency compliance — flagged to the user that this addresses data-at-rest location only, not the separate question of whether audit content (which can contain personal data) transiting to Anthropic's API also needs anonymization first; user's stated plan is a pseudonymization pipeline (script or GigaChat-based) before sending to Anthropic, matching the pre-existing Phase 2 compliance plan — not yet designed or built, tracked as a punch-list item. **Both VPS not yet provisioned as of this update** — user provisioning today; this session captured infrastructure requirements for both in advance. See Session Log for the full SpaceWeb debugging story and VPS spec requirements.

> Last updated: September 1, 2026. **Major infrastructure migration: Vercel → SpaceWeb, with a new Kazakhstan VPS proxy for Anthropic.** Root cause: Vercel billing failed because the only available payment card is Russia-issued (accepted at signup, but Vercel cannot actually charge it — see Session Log for full story). App is now hosted on SpaceWeb Serverless (beta); Anthropic calls are routed through a dedicated reverse-proxy vhost on the existing Kazakhstan VPS (`audit.assistant24info.ru` → `api.anthropic.com`); Supabase is reachable directly from SpaceWeb, no proxy needed. Also fixed, same session: the `/api/chat` route had no `maxDuration` set (silently defaulting to Vercel Hobby's 10s), which combined with a fully-buffered (non-streaming) response and zero client-side error handling caused audits to time out with the UI stuck locked forever; converted to true NDJSON streaming with a 15s heartbeat (to survive proxy idle-timeouts) and added try/catch/finally everywhere so the input never locks up again. **Vercel is being kept live as a fallback for now, not yet decommissioned.** Previous entry (August 7): per-transaction billing verified end-to-end...

> GitHub: https://github.com/Aris1672/Ai--senior-audit
> **Live (current, self-hosted):** https://auditor.assistant24info.ru
> Live demo (Vercel, not yet decommissioned): https://ai-senior-audit.vercel.app
> Admin login: support@assistant24.tech (role set manually in Supabase; same account, same password, migrated intact to self-hosted Auth)
> Self-hosted Supabase Studio: http://77.222.47.140:8002 (see `Self-Host-Migration.md` for credentials — not duplicated here per that file's own convention)
> **Local repo path:** `.git` lives at `H:\AI Work\audit-agent\ai-senior-auditor` — NOT at `H:\AI Work\audit-agent`. `cd` into the `ai-senior-auditor` subfolder before any git command.

---

## Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js App Router, TypeScript | 16.2.6 |
| Runtime | React | 19.2.4 |
| Database + Auth | Supabase (PostgreSQL + Auth + Storage) | @supabase/supabase-js 2.105.4 |
| Hosting | **Self-hosted Coolify on `assistant_vps_4` (168.222.202.222)** — live as of Sep 22 2026, `https://auditor.assistant24info.ru` | — |
| Hosting (superseded, not yet decommissioned) | SpaceWeb Serverless (beta) | — |
| Hosting (superseded, not yet decommissioned) | Vercel | — |
| Database | **Self-hosted Supabase, Stack 3 on `assistant_vps_3` (77.222.47.140:8002/5434/6545)** — live as of Sep 22 2026, full data parity with Cloud verified | — |
| Database (superseded, not yet decommissioned) | Supabase Cloud | — |
| Outbound proxy (Anthropic only) | nginx on existing Kazakhstan VPS (`audit.assistant24info.ru`) — unchanged, shared with other apps on this infra | — |
| AI — audit reasoning + findings extraction | DeepSeek V4 Pro via Anthropic-compatible endpoint (**built Nov 12 2026, `lib/llm.ts`; active only when `LLM_API_KEY` is set**) — legacy fallback: Claude Sonnet 5 | @anthropic-ai/sdk 0.96.0 |
| AI — scanned PDF / image reading (planned) | GigaChat (Russia-hosted) — replaces Claude vision input | not built yet |
| Pseudonymization (planned) | Own reversible coder/restorer (TS regex + Python/Natasha NER service) | not built yet |
| XLSX parsing | fflate (hand-rolled) + xlsx (legacy .xls only) | 0.8.3 / 0.18.5 |
| DOCX parsing | fflate (hand-rolled) | same |
| DOC parsing | mammoth | 1.12.0 |
| PDF text extraction | pdf-parse | installed, now wired in |
| PDF rasterization (scanned PDFs → vision) | pdfjs-dist + @napi-rs/canvas | added this session |
| PDF generation | pdfmake | 0.3.8 |

---

## Architecture: Russia → Kazakhstan VPS Proxy (SpaceWeb hosting)

**Superseded September 1, 2026** — see Session Log below for the full migration story. The app now runs on SpaceWeb (Russia-based hosting, billed in RUB, solves the Vercel card problem), with only the Anthropic leg proxied through an existing Kazakhstan VPS. Supabase is reachable directly from SpaceWeb — no proxy needed for that leg.

```
Browser (Russia)
    │
    ▼
SpaceWeb Serverless (Russia) — Next.js SSR/Standalone, auto-deploy on push
    ├── → Supabase PostgreSQL  (direct, no proxy needed)
    ├── → Supabase Storage     (direct, no proxy needed)
    └── → Anthropic API        (via Kazakhstan VPS reverse proxy — see below)
```

**Anthropic proxy details:**
- Domain: `audit.assistant24info.ru` (A record → `199.189.249.4`, the Kazakhstan VPS — same server that already hosts `audit.o2plus.ru`, an unrelated *ingress* proxy for the old Vercel deployment, and a few other ispmanager-managed sites)
- nginx vhost on that VPS reverse-proxies everything to `https://api.anthropic.com`, with `proxy_buffering off` (critical — without it, streaming responses get buffered at this hop and silently look "stuck" again, same failure mode fixed earlier in the app itself)
- App's `lib/anthropic.ts` reads `ANTHROPIC_BASE_URL` from env, defaulting to the real `api.anthropic.com` if unset (safe for local dev)
- Confirmed via manual `curl` testing (including a realistic ~28K-char system prompt + `tools` param + streaming) that the proxy itself handles full-scale requests correctly — the extended debugging session was actually about `ANTHROPIC_BASE_URL` not being set/baked into the SpaceWeb build at all (see Session Log), not a proxy or Anthropic-side problem

**Old architecture (Vercel), kept as fallback:**
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

**✅ FIXED July 1, 2026 — direct-browser-to-Supabase bypass in `admin/layout.tsx` and `client/layout.tsx`.** Root cause of intermittent login failures without VPN from Russia. Both layouts called `createClient()` from `lib/supabase-client.ts` (a legitimate `@supabase/ssr` browser client) solely to run `supabase.auth.signOut()` on logout. Constructing that client is not inert: `@supabase/ssr`'s browser client auto-initializes a `GoTrueClient` that reads the session cookie set by `/api/auth/login` and can issue a direct browser → `*.supabase.co` call (session validation/refresh), bypassing Vercel entirely — even though the login POST itself was already correctly proxied. Fix: removed `createClient()` from both layouts; logout now calls a new `POST /api/auth/logout` route that runs `signOut()` server-side, matching the same pattern as `/api/auth/login`. Every remaining page in the app tree was individually swept for `createClient`/`@supabase/ssr` imports — none found. See Session Log for the full audit trail.

**Residual risk, not fully closed:** `*.vercel.app` is shared infrastructure; Roskomnadzor blocking is sometimes done by IP range/SNI rather than per-site, so the app can still inherit collateral blocking unrelated to its own code. Not yet moved to a custom domain (`assistant24tech.ru` subdomain via CNAME) — recommended before relying on the `.vercel.app` URL for future demos in Russia.

---

## Planned Change: LLM Provider Switch — DeepSeek + GigaChat + Pseudonymization

> **Decided November 2, 2026 — not built yet.** Everything in "AI Agent: Single-Model Tool-Use Architecture" below describes the *current* (Anthropic) implementation, which this section replaces once built. Reason: Anthropic is banned in Russia.

### Target architecture

```
Client upload
   │
   ├─ Scanned PDF / image ──► GigaChat (Russia) ── vision/OCR ──► extracted text
   │
   └─ Structured files (xlsx/xls/csv/docx/1C txt/text PDF) ──► parseFile() ──► text
                                   │
                                   ▼
             PSEUDONYMIZER (ours, runs on our servers)
             - detects personal data, replaces with tokens
             - token map saved per audit session in our DB (Russia, encrypted)
             - FAIL CLOSED: if coding fails, nothing is sent
                                   │
                                   ▼
             DeepSeek V4 Pro (Anthropic-compatible endpoint, coded text only)
             - streaming reply + record_findings tool call
                                   │
                                   ▼
             RESTORER (ours) — tokens → real values
             - stream-safe (token split across chunks is buffered)
             - also applied to record_findings tool input
                                   │
                                   ▼
             Client chat UI / findings table / PDF report (real values)
```

### 1. DeepSeek integration (Anthropic-compatible endpoint)
- Env: `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`, `ANTHROPIC_API_KEY=<DeepSeek key>`; model id `deepseek-v4-pro`. Consider renaming env vars to `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` and the exports `anthropic`/`SONNET_MODEL`/`SONNET_PRICING` to `llm`/`AUDIT_MODEL`/`AUDIT_MODEL_PRICING` so the next provider change is config-only.
- Remove the leftover diagnostic `console.log` at the top of `lib/anthropic.ts`.
- **Must be verified, not assumed:**
  - `record_findings` tool calling + `tool_choice: auto` works through the compat endpoint, *while streaming*. One source says tool calls are supported in **non-thinking mode** — may need thinking/reasoning disabled.
  - The Russian `AUDIT_SYSTEM_PROMPT` (tuned for Claude) still behaves: audit-purpose question first, three evidence tiers, three risk levels, no greetings, findings recorded once at the end. Compare against real client files previously audited with Claude.
  - Duplicate-findings dedup threshold (`titleSimilarity()` in `/api/chat`) still fits DeepSeek's phrasing.
  - Context window and rate limits (one source cites 500 concurrent requests for V4 Pro); `max_tokens` 16000 + auto-continue still valid.
  - Pricing constants: take real numbers from DeepSeek's official pricing page (third-party sources conflict: ~$0.44–$1.74/M input).
- **Kazakhstan proxy:** check whether DeepSeek is reachable directly from the Coolify VPS (168.222.202.222). If yes, this app no longer needs `audit.assistant24info.ru` (proxy itself stays — shared with other apps).

### 2. GigaChat for images / scanned PDFs
- Replaces the current path where `renderPDFPagesAsImages()` sends page images to Claude as vision input.
- New small client (GigaChat API is **not** Anthropic-compatible): OAuth token (expires ~30 min → cache + refresh), file upload/image input, Russian root CA (НУЦ Минцифры) must be added to the Docker image for TLS.
- New env vars in Coolify: GigaChat auth key / scope.
- Output = plain text (tables as text/markdown) → goes into the pseudonymizer like any other document. GigaChat sees raw images, which is acceptable because it is hosted in Russia.
- Test OCR accuracy on real scans (bank statements, invoices, acts), especially tables.

### 3. Pseudonymizer / Restorer (reversible tokenization)
**What to code vs keep:**
- Code: ФИО, ИНН (individual/ИП; companies — see open question), СНИЛС, passport data, phone, email, address, full bank account and card numbers.
- Keep untouched (audit needs them): amounts, dates, chart-of-accounts numbers (60, 51, 71…), document numbers.
- Tokens must keep audit-relevant meaning: entity type (`[ФЛ_3]` individual, `[ИП_2]`, `[ЮЛ_7]` company), ИНН length (10 vs 12 digits), and **the first 5 digits of bank accounts** (40817 private person, 40802 ИП, 40702 company — key cash-out signal); only the remainder is coded.

**Detection:**
- Regex + checksums for fixed-format identifiers (ИНН, ОГРН, КПП, СНИЛС, р/с, БИК, cards, phones, emails) — inside the Next.js app (TypeScript).
- Column-based for tables/1C exports: every value in known columns (Контрагент, Плательщик, Получатель, ФИО…) is coded.
- Names in free text (e.g. "Назначение платежа: под отчёт Иванову И.И.") need Russian NER → small **Python service with Natasha** on the same Coolify server (or GigaChat as NER). Must handle Russian cases (Иванов / Иванову / Иванова → same token).

**Consistency / storage:**
- One token map per audit session, stored in our Supabase (Russia), encrypted. Same entity → same token across all files and all chat turns (the chat route re-reads every document each turn).
- The client's own chat messages are coded too (users type names).

**Restoration:**
- Stream-safe: buffer when a token is split across chunks (`[ФЛ_` … `3]`).
- Applied to `record_findings` tool input before `saveFindings()`.
- Unknown/hallucinated tokens are flagged, not silently passed through.
- Restored names may be in the wrong grammatical case — accepted as cosmetic.

**Safety:** fail closed (coding error → request blocked, nothing sent to DeepSeek). Detection recall is never 100% — residual risk needs sign-off from whoever advises on 152-FZ, including whether a reversible map kept in Russia means DeepSeek receives "personal data" at all.

**Related:** counterparty ЕГРЮЛ checks need real ИНН — they must run on our side, never through DeepSeek.

### Open decision — ✅ RESOLVED November 12, 2026: individuals only (Option A)
- **Scope of coding:** under 152-FZ, legal entities (ООО, АО) are not personal data; individuals (people, ИП, employees, directors) are. Option A: code individuals only — simpler, better audit quality (the model can follow "ООО Ромашка" across payments). Option B: also code company names — for commercial confidentiality, at some cost to analysis quality. **Not yet decided.**

---

## AI Agent: Single-Model Tool-Use Architecture

> **Changed July 3, 2026** — was a two-model "hybrid" design (Sonnet reasoning + separate Haiku extraction call). Haiku is now removed; see Session Log for rationale (real usage data showed Haiku at ~2.6% of daily token cost — not worth the quality risk the split had already caused once, see the evidence_status incident below).

### Model

| Model | Role | Max tokens |
|---|---|---|
| Claude Sonnet 5 (`claude-sonnet-5`) | Audit reasoning + structured findings extraction (single call) | 16000 |

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
    └─ Claude Sonnet 5 → single call, `record_findings` tool attached (16000 tokens, auto-continues on max_tokens)
          ├─ Writes full audit report as text (deep legal reasoning, Russian regulatory citations, risk classification)
          ├─ If findings exist: calls record_findings ONCE at the end with all findings as structured input
          │     (per AUDIT_SYSTEM_PROMPT instructions — model is told not to call it if there's nothing to report)
          └─ Response content walked for both text blocks and the tool_use block in the same pass
                ├─ Text blocks → concatenated → saved to audit_messages
                └─ tool_use input.findings → validated (enum checks, length caps, risk_flag default) → insert into findings table
                      └─ Increment findings_ct on audit_sessions
                      (Both DB writes still run in parallel via Promise.all)
```

**Why the second model was removed:** the two-call split had already caused a real bug once — Sonnet computed the `evidence_status` confidence tier as part of its reasoning, but Haiku's separate extraction schema didn't ask for that field, so it was silently discarded before the DB write (fixed July 1, see Session Log). Any field Sonnet reasoned about that a second model's schema didn't mirror was structurally at risk of the same class of bug. A single call with a forced tool schema can't have that drift — there's one source of truth, not a translation step.

**What this removed:**
- The keyword-regex gate (`нарушени`, `критич`, `риск`, `штраф`, `КРИТИЧНО`, `СУЩЕСТВЕННО`, `НЕСУЩЕСТВЕННО`) that decided whether to even attempt extraction — findings phrased outside that keyword list could previously be silently skipped
- Markdown-fence-stripping and regex-fallback JSON parsing, needed because Haiku sometimes ignored the "JSON only" instruction — tool_use input arrives as a typed object, not free text to re-parse
- `HAIKU_MODEL` and `HAIKU_PRICING` constants in `lib/anthropic.ts`

**What stayed:** DB-side validation in `saveFindings()` (enum checks against `validRiskLevels`/`validEvidenceStatuses`, field length caps, defaulting to `risk_flag` never `confirmed` on ambiguity) — tool_use input is schema-*guided* by the tool definition, not schema-*enforced*, so a malformed value from the model is still possible and must not corrupt the DB or overstate certainty.

**Not yet verified:** this is a behavioral assumption (model writes full text, then calls the tool exactly once at the end) that hasn't been confirmed against a real Sonnet 5 round trip yet. See punch list P1.

### System Prompt (`lib/anthropic.ts` — `AUDIT_SYSTEM_PROMPT`)

The system prompt is written entirely in Russian and instructs the AI to operate as a senior corporate auditor for Russian enterprises. Key capabilities defined:

**Regulatory framework:** ФЗ №402-ФЗ (accounting), ПБУ 1–24 (accounting standards), НДС гл.21 НК РФ, налог на прибыль гл.25 НК РФ, НДФЛ гл.23 НК РФ, ФНС/ПФР/СФР/Росстат requirements, ФСАД (federal audit standards).

**Three-tier evidence confidence system:**
- `ПОДТВЕРЖДЁННОЕ НАРУШЕНИЕ` — only when data directly and unambiguously proves the violation
- `ПРИЗНАК РИСКА` — possible problem requiring additional documents; must name the specific docs needed
- `КОСВЕННЫЙ ПРИЗНАК` — weak signal requiring monitoring only

**✅ FIXED July 1, 2026 — this tier was previously computed by Sonnet but discarded before storage.** The prompt has always required a `**Статус:**` field per finding, but Haiku's extraction schema never asked for it, so every finding's DB row was indistinguishable regardless of confidence — a proven violation and a weak indirect signal looked identical in the dashboard and PDF. Fixed by adding an `evidence_status` enum column (`confirmed` / `risk_flag` / `indirect`, migration `005_finding_evidence_status.sql`) and extending the Haiku extraction prompt in `lib/anthropic.ts`/`app/api/chat/route.ts` to map the Russian status text to it. Defaults to `risk_flag` (never `confirmed`) whenever the mapping is ambiguous or absent — the extraction step never overstates certainty. Rendered as a badge alongside the risk-level badge in `app/client/audit/[id]/page.tsx` (list + PDF) and `app/client/dashboard/page.tsx` (open findings panel). See Session Log.

**Superseded July 3, 2026 — Haiku extraction step removed.** The mechanism described above (Haiku's separate JSON schema) no longer exists. `evidence_status` is now requested directly on the `record_findings` tool schema that Sonnet calls itself — see "AI Agent: Single-Model Tool-Use Architecture" above. The same default-to-`risk_flag`-never-`confirmed` rule was carried over into the new tool schema and `saveFindings()`'s DB-side validation.

**Three-tier risk classification (used throughout DB and UI):**
- `КРИТИЧНО` — direct tax sanctions, fraud indicators, balance sheet distortion >5%, cash-out patterns, missing primary documents on material transactions
- `СУЩЕСТВЕННО` — PBU methodology violations, partial missing docs affecting tax base, systematic account correspondence errors, missed ФНС/СФР deadlines
- `НЕСУЩЕСТВЕННО` — technical errors without tax impact, single document deficiencies without financial consequences

**Anti-hallucination constraints:** Explicitly prohibits citing specific legal articles without certainty, inventing document details or counterparty data, making legal conclusions without direct data support.

**Transaction analysis checklist:** Document verification (ТОРГ-12, УПД, Счёт-фактура, КС-2/КС-3, ЕГРЮЛ), account correspondence validation, anomaly detection (duplicate payments, round-number transactions, after-hours operations 22:00–06:00 МСК, manual journal entries bypassing 1C workflow, shell company indicators), quantitative flags (payments >200% of per-counterparty average, >30% payment concentration on one counterparty).

**Mandatory output format:** Each finding must include: risk level, status, description with supporting data, legal basis, confirming data points from the document, recommendation with timeframe.

**Report structure:** Auditor summary (**changed July 4, 2026 — now a required bullet list, 4–6 points, not prose**: what was checked, legal form + tax regime from session context, main income/expense sources, key issues, overall risk rating) → confirmed violations (by descending risk) → risk indicators → indirect indicators → quality assessment → priority recommendations (max 5, numbered).

**Tone rules (added July 4, 2026):** explicit instruction against self-introduction/greeting phrasing ("Здравствуйте! Меня зовут...") at the start of any response — the model is told it's a corporate audit tool, not a conversational partner, and should start directly with either formal address or substance.

**Mandatory audit-purpose question (added July 4, 2026):** legal form/tax regime/VAT status are now app-level facts (see "Tax-Profile Gate" above) and the prompt tells the model not to re-ask for them. The one remaining clarifying question — audit purpose (tax risk / bank-check prep / internal control / other) — is now a hard instruction: if not yet stated in the conversation, the model's first response in the session must be *only* that question, no report, no preliminary findings. Full analysis is explicitly gated on it being answered. **This is prompt-only, not app-enforced** — same non-determinism ceiling as everything else asked of the model rather than validated in code; not yet confirmed to fire reliably across repeated real runs (see punch list).

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
| `.pdf` (text layer) | `parsePDF()` | pdf-parse | Text content, 50K char cap |
| `.pdf` (scanned, no text layer) | `renderPDFPagesAsImages()` | pdfjs-dist + @napi-rs/canvas → PNG → Claude vision | Up to first 10 pages rendered at 1.5x scale, sent as native vision images |
| `.jpg` / `.png` | n/a (no text parser) | Routed directly to Claude vision | Native image input, no OCR pipeline |

**`/api/chat/route.ts` file-type detection (fixed this session):** Previously re-derived file type from the filename extension, which silently mis-routed `.doc`, `.txt`, and `.pdf` through the XLSX parser (since unmatched extensions fell through to an `"xlsx"` default). Root cause: the `documents` table already has a correctly-classified `file_type` column populated by the upload route's MIME/magic-byte sniffing, but the chat route ignored it. Fix: `getAllDocumentsContent()` now trusts `doc.file_type` directly instead of re-deriving it. This one fix unlocked `.doc`, `.txt` (1C), and `.pdf` simultaneously, and separates images out to a dedicated vision path instead of attempting text extraction on them.

**1C Client Bank Exchange parser** is the most complete parser in the system. Capabilities:
- Detects files by magic string `1CClientBankExchange` (first 64 bytes) via `is1CClientBankExchange()`
- Hand-coded Windows-1251 (CP1251) → UTF-16 decoder with hardcoded 128-entry byte table — zero external dependencies, works on all runtimes including Vercel Edge
- Parses `СекцияРасчСчет` block to a typed `C1AccountSummary`: account number, period start/end, opening/closing balance, total credits, total debits
- Parses all `СекцияДокумент…КонецДокумента` blocks to typed `C1Transaction[]`: payer/receiver INN, bank, BIK, BIC, payment purpose, direction (credit/debit), payment type
- Outputs CSV-style text with a balance summary header for AI consumption, capped at 500 transactions / 50K chars

### XML heuristic detection

1. Try known 1C and generic transaction tag names: `ХозяйственнаяОперация`, `Документ`, `Document`, `transaction`, `Transaction`, `entry`, `Entry`, `record`, `Record`, `row`, `Row`
2. If none match: frequency-analyse all tags in the document, use the most-repeated tag as the row element

### Known gaps (historical — status updated below; see Session Log)

**Multi-sheet XLS/XLSX:** ✅ **FIXED this session.** Both `parseXLSX()` and `parseXLS()` now loop over every sheet instead of reading only the first. `parseXLSX()` resolves real sheet names by cross-referencing `xl/workbook.xml` against `xl/_rels/workbook.xml.rels` (falls back to generic "sheet1"/"sheet2" naming if that parsing fails, so it can't regress previously-working files). Each sheet gets a `--- ЛИСТ: {name} ({row count} строк) ---` header in the combined output. Each sheet is still capped at 500 rows individually (not 500 total), so a 2-sheet file can now surface up to 1000 rows combined; the overall 50K char cap still applies to the combined output. Not yet re-tested against the real 135-row + 178-row client file post-Vercel-deploy — **do that before considering this closed.**

**PDF content extraction:** ✅ **FIXED this session.** `parsePDF()` now uses `pdf-parse` for text-layer PDFs. For scanned PDFs (no extractable text layer — detected via a ~20-chars/page heuristic), `renderPDFPagesAsImages()` rasterizes up to the first 10 pages to PNG via `pdfjs-dist` + `@napi-rs/canvas` and routes them through Claude's vision input, same pathway as JPG/PNG uploads. **Not yet verified on an actual Vercel deploy** — two build failures were already hit and fixed (TS type error on the `pdf-parse` import shape, and Turbopack failing to bundle `@napi-rs/canvas`'s native binding, fixed via `serverExternalPackages` in `next.config.ts`). Confirm a real scanned-PDF upload end-to-end before treating this as done. Known limitation: the scanned-vs-text heuristic averages across the whole document, so a mixed PDF (typed contract + handwritten signature page) gets classified as fully one or the other, not per-page.

**1C `.txt` unreachable from UI:** ✅ **FIXED this session.** `.txt` added to the `accept` attribute on the Documents page and the new-audit wizard. **Chat page's own attachment-button accept attribute was intentionally left untouched** — it already had `.xls,.pdf` but is still missing `.txt`/`.doc` for consistency with the other two upload surfaces. Decide whether to patch it too.

**Fallback byte-size estimation:** Every parser's `catch` block returns `parseMethod: "fallback"` with `rowCount: Math.floor(buffer.byteLength / 200)`. This produces a plausible-looking but fictitious row count that flows into the billing `calculate-price` route, potentially resulting in incorrect pricing on parse failure.

---

## Pricing & Billing System

**Superseded July 15, 2026 — flat per-tier pricing replaced with true per-transaction pricing.** The tier table below is historical; `pricing_tiers` is no longer the source of truth (see P2 punch-list item for its pending removal).

### Per-transaction pricing (current)

- **Global default rate:** `billing_settings.price_per_transaction_rub` — single row (`id = 1`). Was seeded at 15.00 ₽ as a placeholder; **updated August 7, 2026 to 12.5 ₽/transaction (live)**, matching the rate now published on the landing page.
- **Per-client override:** `client_subscriptions.custom_price_rub` — `NULL` = use global default; set = that client's own rate. Editable from `/admin/pricing`.
- Audit cost = `transactionCount × rate` (client's override if set, else global default).
- **Verified end-to-end August 7, 2026** — tested with two real clients on different rates (one on the global default, one on a custom override); both priced correctly. Closes the P1 verification item opened July 15.

### Historical flat tiers (superseded, table left unused)

| Tier | Max transactions | Price |
|---|---|---|
| Базовый | 500 | 8 000 ₽ |
| Стандарт | 2 000 | 15 000 ₽ |
| Профи | 5 000 | 30 000 ₽ |
| Корпоратив | 20 000 | 75 000 ₽ |

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
| `get_or_create_session` | **No longer called by any client code (July 4, 2026).** | See "Tax-Profile Gate" section — still creates a tax-profile-less session if invoked directly against the API, but the chat page now redirects to the wizard instead of calling it. |
| `save_message` | Chat page | Insert to audit_messages |
| `update_client_status` | Admin clients page | profiles.status |
| `create_audit_session` | New audit wizard | **Now validates legal_form/tax_regime/vat_status server-side (July 4, 2026)** — rejects with 400 if missing or not in the shared enum set from `lib/audit-constants.ts`; see below. Insert audit_sessions. |
| `confirm_audit` | New audit wizard | **Now re-checks legal_form/tax_regime/vat_status exist on the session row before writing (July 4, 2026)** — defense-in-depth catching any session that reached this point without going through `create_audit_session`'s validation. Write cost_rub + transactions_ct to session. |
| `get_session_context` | Chat page (with session param) | Session data + company/period parsed from title + tax-profile fields (with `_display` resolving "Другое" to free text) |
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

### Tax-Profile Gate (added July 4, 2026)

**Why:** identical input data (same 71-transaction bank statement) was producing different risk-tier conclusions across separate AI runs, and one run skipped straight to full analysis while another stopped to ask about tax regime first — an emergent, not scripted, behavior, since nothing in the prompt governed this decision either way. Root cause: the model was left to guess at or inconsistently ask about facts (legal form, tax regime, VAT status) that change what a *correct* analysis even looks like.

**Fix — moved to a hard application-level gate, not a prompt instruction:**
- Three new columns on `audit_sessions`: `legal_form`/`legal_form_other`, `tax_regime`/`tax_regime_other`, `vat_status` (migration `006_session_tax_profile.sql`)
- `lib/audit-constants.ts` — single source of truth for the three dropdown option sets (`LEGAL_FORMS`, `TAX_REGIMES`, `VAT_STATUSES`), imported by both the wizard (rendering) and `/api/data` (validation), so they can't drift apart
- New-audit wizard (`app/client/audit/new/page.tsx`) — Step 1 now has three required fields: legal form (select + conditional "Другое" free text), tax regime (same pattern), VAT status (radio group — single-select, since the three options are mutually exclusive; deliberately not checkboxes)
- `create_audit_session` (`/api/data`) validates all three server-side against the shared enum sets and rejects with 400 if missing/invalid — **this is the real gate; the wizard's client-side check is UX only, not enforcement**
- `confirm_audit` re-checks the fields exist on the DB row itself before allowing confirmation — defense-in-depth against any code path that could create a session without going through `create_audit_session`
- **The `get_or_create_session` bypass is closed at its only call site:** this action still exists and would still create a tax-profile-less session if called directly, but `app/client/chat/page.tsx` no longer calls it — landing on `/client/chat` with no `?session=` param now redirects to the wizard instead. Since the wizard's `confirm_audit` redirect is the only way to reach the chat page with a session ID, every session reaching chat has necessarily passed the gate.
- `buildAuditContext()` (`lib/anthropic.ts`) takes `legalForm`/`taxRegime`/`vatStatus` and renders them as **stated facts** in the system prompt context block, with an explicit instruction not to re-ask for them in chat
- Per product decision, these fields are captured **fresh on every new audit session**, not inherited from a client profile — a repeat client re-enters them each time. Deliberate tradeoff, not an oversight.

**Scoped out by product decision:** `audit_purpose` stays prompt-only (see AI Agent section / System Prompt below) rather than becoming a 4th app-level gate — reasoning was that legal form/tax regime/VAT status are objective facts that change correctness of findings, while audit purpose is framing/prioritization on top of an already-correct analysis, so some variance there was judged lower-stakes. Not yet validated against repeated real runs whether that assumption holds — see punch list.

---

## Database Schema

Migrations: `supabase/migrations/001–005.sql` (005 adds `findings.evidence_status` — see below)

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
| findings_ct | INTEGER | Incremented by chat route after saving findings from the record_findings tool call |
| cost_rub | NUMERIC(10,2) | Set by `confirm_audit` action |
| paid | BOOLEAN | **Not in migration file** — added outside version control |
| legal_form / legal_form_other | TEXT | **Added July 4, 2026 (migration 006).** Company legal form declared at session creation via required dropdown; `_other` holds free text when "Другое" is selected. |
| tax_regime / tax_regime_other | TEXT | **Added July 4, 2026 (migration 006).** Same pattern as legal_form. Feeds directly into `buildAuditContext()` as a stated fact — see "Tax-Profile Gate" section below. |
| vat_status | TEXT | **Added July 4, 2026 (migration 006).** `'payer'` \| `'exempt'` \| `'not_taxed'`, DB-level `CHECK` constraint. |
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
| risk_level | `risk_level` ENUM | `'КРИТИЧНО'`, `'СУЩЕСТВЕННО'`, `'НЕСУЩЕСТВЕННО'` — severity |
| evidence_status | `finding_evidence_status` ENUM | **Added July 1, 2026 (migration 005).** `'confirmed'`, `'risk_flag'`, `'indirect'` — confidence tier, distinct from both `risk_level` (severity) and `status` (workflow). Defaults to `'risk_flag'`; existing pre-migration rows were backfilled to this default rather than assumed confirmed. |
| risk_score | INTEGER | Not populated by current extraction |
| title | TEXT | Max 100 chars (enforced in app) |
| description | TEXT | Max 500 chars |
| legal_basis | TEXT | Max 200 chars |
| recommendation | TEXT | Max 300 chars |
| status | `finding_status` ENUM | `'open'`, `'resolved'`, `'disputed'` — workflow state, not evidence confidence |

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
| `/api/auth/logout` | POST | **Added July 1, 2026.** `signOut` via Vercel — server-side, mirrors `/api/auth/login`. Added specifically to remove the last direct-browser-to-Supabase call from the two portal layouts (see Session Log). |
| `/api/auth/me` | GET | Returns current Supabase user from cookies |
| `/api/auth/profile` | POST | Returns `role`, `status`, `company_name` for a userId |

### AI & Chat
| Route | Method | Description |
|---|---|---|
| `/api/chat` | POST | Sonnet 5 audit reasoning + tool_use findings extraction (single call) |

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

**Authentication:** Client-side guard in `admin/layout.tsx` — calls `/api/auth/me` → `/api/auth/profile` and redirects to `/login` if not admin. No server-side middleware enforcement. Logout now calls `POST /api/auth/logout` (server-side) rather than a client-side Supabase client — see Session Log, July 1.

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

**Authentication:** Client-side guard in `client/layout.tsx` — same pattern as admin. Redirects non-clients and paused accounts to `/login`. Logout now calls `POST /api/auth/logout` (server-side) rather than a client-side Supabase client — see Session Log, July 1.

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
| `@anthropic-ai/sdk ^0.96.0` | Claude API calls (Sonnet 5, single-model tool_use) |
| `@supabase/ssr ^0.10.3` | Cookie-based Supabase client for SSR/API routes |
| `@supabase/supabase-js ^2.105.4` | Admin client (service role, bypasses RLS) |
| `fflate ^0.8.3` | XLSX and DOCX unzipping (no native dep needed) |
| `mammoth ^1.12.0` | Legacy .doc binary text extraction |
| `xlsx ^0.18.5` | Legacy .xls binary parsing only (not used for .xlsx) |
| `pdfmake ^0.3.8` | Client-side PDF report generation |
| `react-markdown` | **Added July 4, 2026.** Renders assistant chat messages as real markdown (headers, bold, lists) instead of literal `##`/`**` syntax — see "Chat UX" section below. No `remark-gfm` needed; headers/bold/lists/`---` dividers are all core commonmark. |
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
- **AI:** Claude Sonnet 5 (audit reasoning + tool_use findings extraction, single call)
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
- GigaChat Max → replaces Claude Sonnet 5 (deep audit reasoning + tool_use findings extraction, single call)
- GigaChat Lite → not suitable for audit use
- *(No GigaChat Pro mapping needed — Haiku's old findings-extraction role was folded into the main Sonnet call via tool_use on July 3, 2026, so Phase 2 only needs to replace one model, not two. Confirm GigaChat Max supports function/tool calling before committing to this — if it doesn't, Phase 2 may need to reintroduce a second-call extraction step specific to the GigaChat migration.)*
- **⚠️ Open decision (July 4, 2026):** this entire GigaChat swap may not be necessary. If the privacy pre-processing pipeline (P2 punch list — Russian LLM detects PII, deterministic script tokenizes to hashes like `User_A123`, Sonnet only ever sees tokenized data) is sufficient for 242-FZ compliance, Sonnet could stay the reasoning engine in Phase 2 with only the anonymization *detection* step running on a Russian LLM — keeping Sonnet's reasoning quality instead of trading it for GigaChat's. Needs a deliberate decision before Phase 2 execution starts, not a default.

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
- [x] ~~Fix multi-sheet XLS/XLSX parser in `lib/file-parser.ts`~~ Done June 30, 2026 — not yet re-verified against real client file on live deploy
- [x] ~~Add `.txt` to file input `accept` attributes~~ Done for documents page + new-audit wizard; chat page attachment button still pending
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
- [ ] Remove unused deps: `papaparse`, `chart.js` (note: `pdf-parse` is now actively used, no longer a removal candidate)
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
- Client portal: new audit wizard (file upload + live 1C, 4-step flow with price confirmation, now also gates on legal form / tax regime / VAT status — see "Tax-Profile Gate" below)
- Client portal: AI chat with typewriter animation (now 2x speed — CHARS_PER_TICK=2, not interval-shrinking, since requestAnimationFrame clamps below ~16.6ms anyway), file attachment, complete-audit flow, **markdown rendering for finished assistant messages (July 4, 2026)** — real headers/subheaders/bold/lists instead of literal `##`/`**` syntax; typing message still renders plain text to avoid unclosed-markdown glitches mid-animation
- Client portal: audit detail page with findings, chat history, canvas donuts, PDF download
- Client portal: documents page (built, but hidden from navigation)
- Client portal: usage history (event log — minimal data currently)
- File parser: XLSX (multi-sheet), XLS (multi-sheet), CSV, XML, DOCX, DOC, 1C bank export (Windows-1251), PDF text-layer extraction, scanned-PDF → vision rendering, images → native vision
- Chat route now trusts `documents.file_type` (DB-classified) instead of re-deriving type from filename extension — root-cause fix that unlocked `.doc`/`.txt`/`.pdf` routing
- PDF report generation (client-side, pdfmake, full Russian audit report with branding, now includes evidence-confidence label per finding)
- Single-model AI: Sonnet 5 reasoning + tool_use findings extraction in one call (Haiku removed July 3, 2026 — see Session Log)
- **Tax-profile app-level gate (July 4, 2026):** legal form, tax regime, and VAT status are now required dropdowns in the wizard, validated server-side, persisted per-session, and fed to the AI as stated facts instead of being guessed or emergently asked about — see "Tax-Profile Gate" section and Session Log
- **Audit-purpose prompt gate (July 4, 2026):** `AUDIT_SYSTEM_PROMPT` now requires the model's first response in a session to be only a clarifying question about audit purpose (tax risk / bank-check prep / internal control / other) before any full analysis — prompt-only per product decision, not yet stress-tested against repeated runs (see punch list)
- **Communication-style fixes (July 4, 2026):** no more self-introduction/greeting ("Здравствуйте! Меня зовут...") at the start of responses; "Резюме аудитора" is now a required bullet list instead of a prose paragraph
- Pay-per-audit pricing with tier lookup and per-client overrides
- Supabase Storage upload with background parse and result caching
- Server-side-only Supabase auth: login AND logout both proxied through Vercel API routes; no page in the app makes a direct browser-to-Supabase call (full tree audited July 1, 2026)
- Evidence-confidence tier (`ПОДТВЕРЖДЁННОЕ НАРУШЕНИЕ` / `ПРИЗНАК РИСКА` / `КОСВЕННЫЙ ПРИЗНАК`) now persisted end-to-end: system prompt → record_findings tool call → DB column → UI badge → PDF

### Not yet built — Next To-Do (prioritized)

> Priority tiers: **P0** = active security/data-leak risk, fix before any real client data touches production. **P1** = blocks a working demo or core business flow. **P2** = important, not urgent. **P3** = cleanup / low-risk deferred.

**P0 — Security (active risk)**
- [ ] Server-side authentication on API routes — `/api/data`, `/api/admin/*`, `/api/chat`, `/api/upload` currently accept any caller who knows the endpoint/IDs (see Security Gaps section — this is the single biggest open risk in the project)
- [ ] Fix or delete `/api/report/[id]` — currently returns full audit session, findings, and message history as an unauthenticated downloadable PDF to anyone with a valid session UUID

**P1 — Blocks demo / core flow**
- [ ] Subscription creation when creating a new client — new clients currently can't start an audit until someone fixes it manually in Supabase
- [ ] Real-deploy verification of the June 30 PDF/vision + multi-sheet parsing fixes — confirmed to *build*, not yet confirmed working on the live Vercel deploy
- [ ] Run one full end-to-end audit post-deploy and confirm `findings.evidence_status` produces a non-default value (`confirmed`/`indirect`), not just the `risk_flag` default — this check now also needs to confirm the `record_findings` tool_use call itself fires correctly (after the report text, not mid-report, exactly once) since Haiku's separate extraction step was removed July 3, 2026 (see Session Log)
- [ ] 1C live connection — UI is built and the OData call is wired, but has never been tested against a real 1C server

**P2 — Important, not urgent**
- [ ] **Privacy-preserving pre-processing pipeline for LLM calls** (updated July 4 2026, originally July 1). Concrete mechanism confirmed with the client: before documents reach Claude Sonnet, run a detection pass — NER (e.g. Natasha/DeepPavlov) plus a **Russian LLM** as the actual detection/classification step for ФИО (full names) and other personal-data spans (phone numbers, addresses, individual INNs) — then use a **deterministic script** (not an LLM) to replace each span with a unique hash token (e.g. `User_A123`), preserving referential consistency across the document (the same person always maps to the same token) without retaining direct identification. Sonnet receives only the tokenized document and never sees real names; the response is reverse-substituted back using the same script. Code↔value lookup table stored Russia-side.
  **Strategic implication worth deciding explicitly:** if this pipeline is sufficient for 242-FZ compliance on its own, Phase 2 may not need to fully replace Sonnet with GigaChat Max for audit reasoning at all — Sonnet could stay the reasoning engine (keeping its quality) with only the anonymization *detection* step running on a Russian LLM. This is a real branch point in the "GigaChat model hierarchy" plan below, not yet resolved — worth a deliberate decision once this pipeline is scoped, rather than defaulting to full GigaChat migration by inertia.
- [ ] **Counterparty ЕГРЮЛ / shell-company verification** (new, July 4 2026). Currently the AI can only *recommend* a human check ЕГРЮЛ for a suspicious counterparty (e.g. "Проверить контрагента... на предмет реальной хозяйственной деятельности"); it can't do the check itself. Two-part plan discussed with the client:
  - Data sources split by cost: basic registry facts (status/address/director) are available via free-tier APIs (e.g. DaData); shell-company risk scoring (mass-registration flags, affiliations) requires a paid vendor (Kontur.Focus, SPARK-Interfax); asset/financials data is a separate lookup against ГИР БО (`bo.nalog.ru`). Not one API call — a decision on how much of this to automate vs. leave as a human follow-up is still open.
  - Preferred integration pattern: a `check_counterparty` tool on the same Sonnet call, mirroring `FINDINGS_TOOL`'s tool_use pattern — Sonnet decides when a counterparty is worth checking (e.g. already flags >30% concentration) and gets the result back in the same turn, writing the actual finding instead of a "please verify" recommendation.
  - **Blocked on the Phase 2 SpaceWeb migration**, not a Vercel-phase task: this app's entire proxy architecture exists because Anthropic/Supabase access from Russia is restricted, requiring Vercel (outside Russia) to sit in between. Checking a Russian registry/data API is the same class of problem in reverse — a non-Russian-origin server (Vercel) calling into a Russian government/commercial data source may hit its own geo-restrictions or bot protection, unverified either way. A SpaceWeb-hosted VPS (physically in Russia) is the safer place to build this, so it's deferred until that migration rather than risked on the current Vercel deploy.
- [ ] Move off `*.vercel.app` to a custom domain — recommended to reduce risk of collateral IP/SNI-range blocking in Russia (see July 1 Session Log, Part 1)
- [ ] Email notifications (SMTP configured in plan, not in code)
- [ ] `transactions` table population (designed, never written to)
- [ ] AI token usage logging (schema supports it, chat route doesn't write it)
- [ ] `audit_sessions.paid` migration file

**P3 — Cleanup / deferred**
- [ ] Chat page's own attachment-button accept attribute still missing `.txt`/`.doc` (only `.xls,.pdf` currently) — left unpatched on purpose, decide if it should match the other two upload surfaces

---

## Session Log — DeepSeek V4 Pro Switch Built (Step A) (November 12, 2026)

- **Code:** `lib/anthropic.ts` renamed to `lib/llm.ts`. Provider chosen by env: `LLM_API_KEY` set → DeepSeek (`LLM_BASE_URL` default `https://api.deepseek.com/anthropic`, `LLM_MODEL` default `deepseek-v4-pro`, `LLM_THINKING` default disabled); not set → the old `ANTHROPIC_*` + `claude-sonnet-5` setup, unchanged. This makes pushing safe (production unchanged until the env var is added) and gives a one-step rollback.
- **`app/api/chat/route.ts`:** uses `llm` / `AUDIT_MODEL` / `AUDIT_MAX_OUTPUT_TOKENS` and spreads `LLM_EXTRA_PARAMS` (DeepSeek `thinking` setting) into the stream call. When the provider can't read images (DeepSeek), image uploads and scanned PDFs are not sent at all — the prompt gets `UNREADABLE_IMAGE_NOTE` telling the model to say the document wasn't analyzed and to ask for a text format. Scanned PDFs are no longer rendered to PNG in that mode.
- **Facts confirmed from DeepSeek's Anthropic-API guide** (api-docs.deepseek.com/guides/anthropic_api): base URL `https://api.deepseek.com/anthropic`; `deepseek-v4-pro` doesn't process images; `tool_choice` auto/none supported, `any` = auto, `tool` → 400 in thinking mode; thinking-mode tool continuations require the full assistant content incl. thinking blocks; `budget_tokens` ignored; `cache_control` ignored; streaming SSE fully supported; total input = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
- **Pricing:** third-party sources (Nov 2026) agree on $1.32 in / $3.96 out per 1M at peak, half off-peak, cache hit $0.044. Peak used in `AUDIT_MODEL_PRICING`. Official pricing page not reachable from the build workspace.
- **Verified here:** `tsc --noEmit` clean; `next build` succeeds (Google Fonts stubbed only for the offline build, not committed). **Not verified:** any real DeepSeek call — the build workspace can't reach api.deepseek.com. `npm run check:llm` is the next thing to run.
- **Decision:** pseudonymize individuals only. **Discussed, not decided:** self-hosted OCR service instead of GigaChat.

---

## Session Log — LLM Provider Switch Planned: DeepSeek V4 Pro + GigaChat + Pseudonymization (November 2, 2026)

Discussion/design session only — no code changed.

- **Trigger:** Anthropic is banned in Russia; the audit LLM must move off Claude Sonnet 5. User chose **DeepSeek V4 Pro**.
- **Code review of what the switch touches:** only one LLM call site — `anthropic.messages.stream()` in `app/api/chat/route.ts` (streaming, `record_findings` tool, `tool_choice: auto`), plus vision input for scanned PDFs via `renderPDFPagesAsImages()`. Client config lives in `lib/anthropic.ts`.
- **Decision 1 — Anthropic-compatible endpoint** (`https://api.deepseek.com/anthropic`) instead of rewriting for the OpenAI-style API. Minimal change; existing SDK/streaming/tool code kept.
- **Decision 2 — GigaChat for images**, since DeepSeek V4 Pro image input could not be confirmed. Raw images only go to a Russia-hosted model.
- **Decision 3 — pseudonymization first.** No client data goes to DeepSeek until the reversible coding program (code → DeepSeek → restore) is built. Sending personal data to China would otherwise be a cross-border transfer under 152-FZ.
- **Conflict identified and resolved:** text pseudonymization can't clean scanned images, so images must not go to DeepSeek — resolved by Decision 2 (GigaChat OCR first, then the extracted text is pseudonymized).
- **Open:** code individuals only vs also company names (see "Planned Change" section → Open decision).
- **Unverified facts to check during the build:** DeepSeek image support, tool calling in thinking vs non-thinking mode, official pricing (third-party figures conflict), direct reachability from the Coolify VPS.
- Full design: "Planned Change: LLM Provider Switch" section above. Build checklist: `PUNCH_LIST.md` → "NEXT SESSION".

---

## Session Log — SpaceWeb Caching Bug Discovered, Pivoting to Self-Hosted Coolify + Self-Hosted Supabase (September 3, 2026)

**Goal:** figure out why a UI improvement (rotating status text + elapsed timer during long audit generation) wasn't appearing on SpaceWeb despite multiple confirmed-correct rebuilds — and what to do about it.

**1. Diagnosed a SpaceWeb platform-level caching bug, not a code issue.** Added a loud, unmistakable test marker (`[BUILD TEST V2]`) to `page.tsx` to rule out subtle rendering issues. It never appeared. Confirmed via DevTools' global search (Ctrl+Shift+F across all loaded files) that the string was **completely absent** from every JS file the browser actually received, even immediately after a rebuild the platform confirmed included the right commit. Checked response headers on the chat page request directly: `Cache-Control: s-maxage=31536000` (one full year), `X-Nextjs-Cache: HIT`, `X-Nextjs-Prerender: 1`. The HTML document was frozen, still referencing old JS chunk filenames from a previous build — no amount of rebuilding could fix this since the cached document itself never got invalidated.

**2. Ruled out the app's own code as the cause.** Added `export const dynamic = "force-dynamic"` to the root `app/layout.tsx` (the correct fix *if* this were Next.js's own static-optimization behavior) — redeployed, headers unchanged. Checked the nested `app/client/layout.tsx` in case it was overriding the root — it's a client component, can't export conflicting segment config, and doesn't. Checked `next.config.ts` for a global `headers()` override — completely clean, no caching config of any kind. With the app's own code and config fully ruled out, and the `Server: envoy` header on every response, this points to SpaceWeb's own edge/CDN layer overriding the app unconditionally, regardless of what the Next.js app itself specifies. Given the product is explicitly in beta, treating this as a platform bug rather than something fixable from the app side.

**3. Decision: abandon SpaceWeb Serverless, self-host via Coolify instead.** Coolify (self-hosted, open-source PaaS, Docker-based) gives full control over the reverse proxy/caching layer — the exact category of problem just hit. Same git-push-to-deploy workflow as before. Will run on a **new Russian VPS** (required — the app must be Russia-hosted per Russian law), with the **existing, already-verified Kazakhstan VPS nginx proxy** (`audit.assistant24info.ru` → `api.anthropic.com`) reused as-is for the Anthropic leg. Supabase Cloud stays direct, no proxy — for now (see next point).

**4. Separately decided: self-host Supabase too, for 152-FZ data-residency compliance.** This is a distinct decision from the Coolify move, driven by Russian personal-data-localization law rather than the caching bug. **Important open question flagged to the user, not yet resolved:** self-hosting the database addresses data-at-rest location, but every audit request still sends live document/transaction content — which can contain personal data (names, INNs, payment details) — to Anthropic's API, hosted outside Russia. Whether 152-FZ's requirements extend to that in-transit data is a legal question, not a hosting one, and moving Supabase alone would not resolve it if so. **User's stated plan: a pseudonymization pipeline (script-based regex for structured data like INNs/account numbers, likely GigaChat or a local model for names/company entities) run before sending anything to Anthropic, with a reversible mapping kept in Russia to reconstruct real names in the final report.** This directly matches the "Phase 2" compliance/anonymization work already noted elsewhere in this document — **not yet designed or built**. Also flagged: whether a *reversible* pseudonymization mapping still counts as "processing personal data abroad" under 152-FZ (since the original identity is technically recoverable) is exactly the kind of distinction that needs confirmation from whoever is advising on this law — this document does not resolve that question.

**5. Captured VPS requirements for both new servers** (neither provisioned yet as of this entry — user buying today):

| | Coolify + App VPS | Self-hosted Supabase VPS |
|---|---|---|
| **Location** | Russia (required by law) | Russia (152-FZ data residency) |
| **OS** | Ubuntu 22.04 or 24.04 LTS | Ubuntu 22.04 or 24.04 LTS |
| **CPU** | 2 vCPU minimum | 4 vCPU minimum |
| **RAM** | 4GB minimum (Next.js builds — pdfjs-dist, xlsx, mammoth, etc. — are memory-hungry; less risks an OOM-killed build) | 8GB minimum (Postgres + GoTrue + PostgREST + Storage + Realtime + Kong all run together via Docker Compose) |
| **Storage** | 40GB+ SSD | 100GB+ SSD (Postgres data + uploaded audit documents both live here; grows over time) |
| **Notes** | Install via Coolify's official one-line installer (`curl -fsSL https://cdn.coollabs.io/coolify/install.sh \| bash`); connects to GitHub for git-push auto-deploy, same env vars as the SpaceWeb attempt (`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` → Kazakhstan proxy, Supabase vars) | Supabase's official self-hosted Docker Compose stack. Realtime and Logflare/Vector (logging/analytics) can be stripped out if unused, reducing the resource floor somewhat — but not recommended to go below the 8GB figure even trimmed. Backups become the user's own responsibility (Cloud handled this automatically) — recommended: nightly `pg_dump`, compressed, shipped to a *separate* location (different server or S3-compatible storage) from the VPS itself, not just a same-server snapshot. VPS provider snapshots are a reasonable secondary safety net, not a substitute for an offsite dump. |

**Not yet done:**
- Neither new VPS is provisioned yet — user is buying both today, will return to continue once ready.
- SpaceWeb Serverless deployment is presumably being abandoned, but not yet explicitly torn down/cancelled — worth confirming intent once the Coolify migration is confirmed working, so as not to keep paying for or maintaining a third hosting target unnecessarily (Vercel fallback, SpaceWeb, and soon Coolify would otherwise all coexist).
- The pseudonymization/anonymization pipeline for Anthropic-bound data is still just a stated intention, not designed or built. This is now the more consequential of the two "Phase 2" workstreams (data residency without it may not achieve actual compliance) and probably deserves prioritization once infrastructure work settles down.
- No decision yet on what happens to the rotating-status-text/timer UI feature (`statusText`/`elapsedSeconds` in `page.tsx`) or the `[BUILD TEST V2]` diagnostic marker — the marker in particular should be removed once the Coolify deployment is confirmed serving fresh builds correctly, since it has no purpose beyond that one diagnostic.

---

## Session Log — Vercel → SpaceWeb Migration, Kazakhstan Proxy, Streaming/Timeout Fixes (September 1, 2026)

**Goal, in order of how it actually unfolded:** fix a demo-breaking chat timeout bug → discover Vercel billing was broken → migrate hosting to SpaceWeb → build a Kazakhstan proxy for Anthropic → debug three separate deploy bugs → confirm full end-to-end success.

**1. Root-caused and fixed the "stuck thinking, input locked forever" bug.**
`/api/chat/route.ts` had no `export const maxDuration` set at all — on Vercel Hobby this silently defaults to **10 seconds**, not the 60s the plan actually allows. Combined with a fully-buffered (non-streaming) response that could involve up to 6 sequential Anthropic calls, real audits were virtually guaranteed to 504. Worse, `page.tsx`'s three fetch call sites (`sendMessage`, `sendAutoMessageDirect`, `uploadFilesAndSend`) called `res.json()` with no `!res.ok` check and no try/catch — a 504's HTML error body made `res.json()` throw uncaught, skipping `setLoading(false)` and locking the whole chat input with no recovery except a hard reload.

Fix: set `maxDuration = 60` (later raised to 300 after the Pro upgrade — see below), converted the route to true NDJSON streaming (`anthropic.messages.stream()`, one JSON event per line: `delta`/`done`/`error`/`heartbeat`), and wrapped every client call site in try/catch/finally so `setLoading(false)`/`setTypingIndex(-1)` always run.

**2. Added a 15s heartbeat.** A real case surfaced where Claude took ~150s to produce its first visible text (long internal reasoning before any output). No bytes flowed to the client that whole time; something in the RU→Vercel path (likely an idle-connection timeout on a proxy layer) killed the connection even though the Vercel function itself completed successfully and saved everything to Supabase. Fix: server emits a no-op `{type:"heartbeat"}` event every 15s during any silent gap, purely to keep bytes flowing; client ignores it.

**3. Fixed choppy streaming text.** Real network deltas arrive in bursts (sentence/token-sized chunks), which looked jarring without smoothing. Added a `requestAnimationFrame` loop in `page.tsx` that chases a live-growing `target` string at a steady character-per-tick pace — same pacing idea as the old fake `TypewriterMessage` (now removed), but now driven by real streamed content instead of an already-complete string.

**4. Discovered Vercel billing is broken and can't be fixed easily.** The account's only payment method is a Russia-issued Visa — Vercel accepts the card (no immediate rejection) but cannot actually charge it, leaving the account perpetually in "payment failed" / overdue status with a shutdown threat. This is very likely a sanctions-related card-network restriction, not a Vercel-specific issue, and isn't something to keep retrying.

**5. Decided to migrate off Vercel** to **SpaceWeb** (existing Russian hosting account, already used for other sites via ispmanager on a Kazakhstan VPS at `199.189.249.4`). Confirmed SpaceWeb's **Serverless (beta)** product explicitly supports Next.js SSR/Standalone, with git-push auto-deploy and configurable environment variables — a good fit, avoided the heavier VPS route since a managed deploy target was available.

**6. Built the app on SpaceWeb Serverless.** Platform: "Next.js (SSR/Standalone)", build command `npm run build`, start command `npm run start`. Live at `https://auditor-assistant.sl.swteh.ru`. Confirmed working: login, Supabase (auth + all historical data recovered) — **direct, no proxy needed**. Anthropic calls failed immediately with a generic "communication error," confirming direct Russia→Anthropic access is blocked (also independently confirmed: Kazakhstan is *not* on Anthropic's list of restricted countries, so this is Russia-specific network-level blocking, not an Anthropic account/region restriction).

**7. Built the Kazakhstan VPS proxy for Anthropic only** (Supabase already works directly, so it didn't need one). New subdomain `audit.assistant24info.ru` → same Kazakhstan VPS (`199.189.249.4`) that already runs `audit.o2plus.ru` (an unrelated ingress proxy for the old Vercel app — different vhost, different job). New ispmanager site, Let's Encrypt SSL, nginx `@fallback` block rewritten to `proxy_pass https://api.anthropic.com` with `proxy_buffering off` (critical for streaming) instead of the default PHP/static handling. Verified directly with `curl`, including a realistic-scale test (~28K char system prompt + `tools` param + `stream:true`, 23,579 input tokens) — proxy handles everything correctly, ruling out payload size, streaming, and tool-use as causes of anything that came later.

**8. Chased a persistent 403 "Request not allowed" that turned out to be a much simpler bug than suspected.** The app kept failing even after pointing `lib/anthropic.ts` at the proxy via a new `ANTHROPIC_BASE_URL` env var (SDK client patched to accept an optional `baseURL` override, defaulting to the real Anthropic API when unset). Spent real time investigating red herrings — SDK-vs-curl header fingerprinting, `X-Forwarded-For` leaking Russian origin, stale running processes — before checking the actual Docker build logs, which revealed **`ANTHROPIC_BASE_URL` had never actually been saved in the SpaceWeb panel at all** (the save button had silently failed earlier in the session). Fixed, rebuilt — hit two more unrelated bugs on the way: a corrupted API key value (contained a stray fragment that broke Dockerfile `ENV` parsing entirely) and one transient npm registry timeout during build (`ECONNRESET` on an unrelated package, resolved by just retrying).

**9. Confirmed fully working end-to-end.** Real audit run through SpaceWeb → Kazakhstan proxy → Anthropic completed successfully.

**Not yet done:**
- **This is NOT the "Phase 2 SpaceWeb migration" already described elsewhere in this document.** That planned migration bundles a GigaChat model swap and a 242-FZ compliance/anonymization pipeline; today's move was an unplanned, narrower fix driven purely by the Vercel billing failure. Sonnet/Anthropic is still the reasoning engine (via the new Kazakhstan proxy) — no GigaChat work happened. The Phase 2 Migration Checklist further down this document should be reviewed against what's now actually true (hosting has moved; the compliance/model-swap work has not started) rather than assumed still fully pending.
- Vercel is still live and untouched, intentionally kept as a fallback — not yet decommissioned or pointed away from.
- **Two API keys were exposed in plaintext multiple times during this session's debugging** (pasted directly in build logs shared for troubleshooting): `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. **Both have now been rotated** (confirmed by user) — no outstanding action here, but worth double-checking no other deployment (e.g. Vercel) is still configured with the old, now-revoked values.
- SpaceWeb Serverless is explicitly in beta — no confirmed answer yet on its own execution/timeout limits (the 300s `maxDuration` logic lives in the Next.js app itself, not confirmed as a platform-level constraint on SpaceWeb the way it was on Vercel).
- `audit.assistant24info.ru`'s nginx config currently has no IP allowlisting — anyone who discovers this subdomain could relay requests to Anthropic using whatever key the app has configured. Worth restricting it to SpaceWeb's outbound IP(s) only.

---

## Session Log — Per-Transaction Billing Verified, Rate Set, Landing Page Updated (August 7, 2026)

**Goal:** verify the July 15 per-transaction billing rework end-to-end, set a real global rate, and bring the public landing page's pricing section in line with the new model.

**What happened:**
1. **Billing verified.** Ran real audits for two clients on different rates — one using the global default, one with a `client_subscriptions.custom_price_rub` override — and confirmed both priced correctly (`transactionCount × rate`, correct rate selected in each case). Closes the P1 verification item opened July 15.
2. **Global rate set.** `billing_settings.price_per_transaction_rub` updated in Supabase from the 15.00 ₽ placeholder to **12.5 ₽/transaction** (applied manually via SQL/table editor, not the admin panel, per user preference this session).
3. **Landing page (`audit.html`) rewritten.** Found still showing the old flat 4-tier grid (8 000 ₽ / 15 000 ₽ / 30 000 ₽ / 75 000 ₽ with transaction caps) — stale since the July 15 billing rework, never updated at the time. Replaced with a single pricing card: 12.5 ₽/transaction, cost = count × rate, plus a note directing high-volume prospects (~250k+ tx/month) to contact sales for a custom rate. Section eyebrow changed from "Тарифы" (plural tiers) to "Стоимость" to match. Also fixed a leftover "тариф" reference in the how-it-works step copy.

**Not yet done:** the old `pricing_tiers` table and dead `client_subscriptions` columns (`tier_id`, `custom_max_tx`, `audits_purchased`, `audits_used`) are still not dropped — this session's verification was the explicit blocker noted for that cleanup (see P2 punch-list item), so it can now be unblocked. Drop statements are already written and commented out in `006_transaction_billing.sql`.

---

## Session Log — Duplicate-Findings Fix (August 6, 2026)

**Goal:** close the P1 punch-list item — mid-chat re-analysis (triggered by any document upload) was producing duplicate findings, since the report/record_findings pipeline reruns in full on every turn with no awareness of what was already saved.

**Root cause, confirmed by source review:**
1. **Prompt-level:** `buildAuditContext()` only ever passed `openFindings`/`criticalCount` as bare numbers into the system prompt. Sonnet had no way to know *which* findings were already recorded — only how many — so on every full re-analysis it had no basis to recognize "already reported" and would restate the same violations under the same or slightly reworded titles.
2. **App-level:** `saveFindings()` did an unconditional `insert()` — zero dedup check against the session's existing rows. The `findings` table itself also has no unique constraint that could have caught this at the DB level (confirmed via live schema dump).

**Fix — two layers, as scoped in the punch list:**

- **`lib/anthropic.ts`:**
  - `buildAuditContext()` signature extended with `existingFindings?: { title, risk_level, evidence_status }[]`. When present, renders an actual titled list ("Уже зафиксированные нарушения") into the context block, with an instruction not to re-pass these to `record_findings`.
  - `AUDIT_SYSTEM_PROMPT`'s "ФИКСАЦИЯ НАРУШЕНИЙ ЧЕРЕЗ ИНСТРУМЕНТ" section rewritten: Sonnet is now told to compare newly-identified findings against the existing list and pass only new-or-materially-changed ones to `record_findings`, while still being allowed to *mention* already-known findings in the prose report (e.g. in "Резюме аудитора") for a complete-reading report — the restriction is scoped to the tool call, not the text.

- **`app/api/chat/route.ts`:**
  - Before building the system prompt, now fetches all `open` findings for the session (`title, risk_level, evidence_status`) and passes them into `buildAuditContext` — this is what feeds the prompt-level fix above.
  - `saveFindings()` extended with an `existingTitles: string[]` parameter and a new word-overlap similarity check (`titleSimilarity()` / `normalizeTitle()`): normalizes each title to a set of words (lowercased, punctuation stripped, unicode-aware for Cyrillic, connector words ≤2 chars dropped), computes overlap ratio against the shorter title, and treats ≥70% overlap as a duplicate. Checked against **both** the DB's existing titles **and** other findings within the same `record_findings` batch (Sonnet could in principle emit two near-identical findings in one call, so within-batch dedup matters too). Duplicates are skipped with a `console.warn`, not inserted.
  - This is explicitly a **second, app-level safety net** on top of the prompt fix — the prompt instruction is a request, not an enforced constraint, same reasoning as the existing `toolCallSeen` guard it sits next to.

**Open items:**
- **Not yet verified against a real duplicate case.** The 70% similarity threshold and the >2-character word-length cutoff for "connector words" are untested heuristics, not validated against the actual repeated finding from the original bug report (missing-documents finding appearing as #1/#4/#7 in a real downloaded report). Should be checked against that same scenario, or a fresh equivalent, before this is considered closed. Risk of either direction: threshold too loose → genuinely distinct findings get silently dropped; too strict → duplicates still slip through.
- If the threshold needs tuning, the fix is contained to `titleSimilarity()`/`DUPLICATE_SIMILARITY_THRESHOLD` in `app/api/chat/route.ts` — no schema or prompt changes should be needed for a tuning pass alone.
- Existing-findings fetch only pulls `status = 'open'` rows — resolved/disputed findings are intentionally excluded from the "don't re-report" list (a resolved finding reappearing might be meaningful — e.g. same problem recurring — so it isn't silently swallowed by dedup). Worth confirming this is the intended behavior once tested.

---

## Session Log — Multi-File Chat Attachments (July 15, 2026, later same day)

**Goal:** close the P1 punch-list item — chat only supported attaching one file per message (`handleFileSelect` read `e.target.files?.[0]`, input lacked `multiple`, `uploadAndSend` handled one file per call).

**Key finding that simplified the fix:** `/api/chat`'s `getAllDocumentsContent` already re-fetches *every* document linked to the session on *every* turn — it was never scoped to "the file attached to this specific message." That meant the backend (`app/api/chat/route.ts`, `app/api/upload/route.ts`) needed **zero changes**. This was purely a frontend fix.

**Changes, all in `app/client/chat/page.tsx`:**
- `Message.fileName?: string` → `Message.fileNames?: string[]`.
- New state: `pendingFiles: File[]` replaces `pendingFile: File | null`.
- `handleFileSelect` now reads the full `FileList`, appends to any already-pending files (so the attach button can be used more than once before sending) rather than replacing.
- New `uploadFilesAndSend()` replaces `uploadAndSend()`: loops over pending files, uploading each individually via the unchanged `/api/upload` contract (sequential, not parallel — stops and surfaces an error on the first failed upload rather than sending a partial/confusing set), then makes **one** `/api/chat` call after all uploads succeed (relying on the all-documents-per-turn behavior above).
- `sendMessage()` updated to build `fileNames` from `pendingFiles`, clear the pending list on send, and branch to `uploadFilesAndSend` vs. the plain `/api/chat` call depending on whether files are attached.
- Message rendering: single file chip replaced with a wrapped row of chips, one per attached file.
- Pending-files preview (above the input box): list of files instead of one, each with its own remove (×) button.
- File input: added the `multiple` attribute.
- Attach/send button `disabled`/styling conditionals updated from `!pendingFile` to `pendingFiles.length === 0`.

**Verified:** not yet — user reported "works well" after applying the change and testing manually, but no specific multi-file test scenario (e.g. exact file count, mixed file types) was logged. Treat as working-per-user-report rather than independently verified against edge cases (e.g. one file in a batch failing mid-upload, very large batches).

**Known follow-on effect (expected, not a new bug):** this change makes the **duplicate-findings bug** (existing P1 item, not yet fixed) more visible/impactful — attaching N files in one message now means N documents' worth of content feeding a single `record_findings` call, and if that session already has findings from earlier turns, the duplication surface is larger. This was flagged to the user before the change was made; fixing the duplicate-findings item is the natural next step.

---

## Session Log — Per-Transaction Billing (July 15, 2026)

**Goal:** switch billing from flat per-tier pricing (fixed price per max-transaction bracket) to true per-transaction pricing, following a demo to a large prospective client running ~250,000–300,000 transaction audits/month. Requested capability: admin sets a price per transaction; audit cost = transaction count × rate; per-client custom rate override still supported.

**Schema (`006_transaction_billing.sql`, applied):**
- New `billing_settings` table — single row (`id = 1`, enforced by CHECK), holds `price_per_transaction_rub` (global default rate). Seeded at 15.00 ₽/transaction as a placeholder — **update via the admin pricing tab to the real rate before this goes live for the new client.**
- `client_subscriptions.custom_price_rub` — **repurposed**, not newly added. This column already existed (previously meant as a flat per-audit override tied to a tier) and was confirmed unused live. Now means: per-transaction override rate in RUB; `NULL` = use the global default. Column comment added in the migration documenting this reinterpretation.
- `pricing_tiers` table and the old tier-linkage columns on `client_subscriptions` (`tier_id`, `custom_max_tx`, `audits_purchased`, `audits_used`) are **left in place, not dropped**. FK check confirmed `client_subscriptions.tier_id → pricing_tiers.id` is the only reference to the table. Drop statements are written but commented out in the migration — intentionally deferred until the code below is deployed and confirmed working, to avoid a hard cutover with no rollback path.

**Code changes:**
- `lib/billing.ts` — removed `PricingTier` interface, `checkTierLimit()`, `suggestTier()` (hardcoded tier-price list). Added `calcAuditPrice(transactionCount, ratePerTransactionRub)`. `calcAiCostRub()` (internal AI token-cost tracking, unrelated to client billing) left untouched.
- `app/api/audit/calculate-price/route.ts` — replaced the tier-bracket lookup (`calcPrice()` scanning sorted tiers) with a rate lookup: `client_subscriptions.custom_price_rub` (most recent row for the client) if set, else `billing_settings.price_per_transaction_rub`. Response shape changed from `{ transactionCount, priceRub, tierName }` to `{ transactionCount, priceRub, rateRub, isCustomRate }`. Also fixed a latent bug in the old code: it wrote `tier_name` to `audit_sessions` on update, but that column doesn't exist in the live schema (confirmed via live schema dump this session) — would have silently failed or errored; removed.
- `app/client/audit/new/page.tsx` — `PriceResult` interface updated to match the new response shape; price-breakdown display in the Step 4 confirm screen now shows "Ставка за транзакцию" (rate, with a "(инд.)" tag if it's a custom override) instead of "Тарифный план" (tier name).
- `app/admin/pricing/page.tsx` — full rewrite. Old page was full tier CRUD (create/edit/delete tiers with max_transactions + price_rub). New page: (1) a global-rate editor (single number input + save, reads/writes `billing_settings`), (2) a per-client override table listing all clients with their current rate (custom or "по умолчанию"/default), inline edit, and a "Сбросить" (reset) button to clear back to default.
- `app/api/admin/pricing/route.ts` — full rewrite. `GET` returns the global rate. `PATCH` takes `{ scope: "global", price_per_transaction_rub }` or `{ scope: "client", clientId, custom_price_rub }` (null clears the override). Client-scope PATCH upserts against the client's most recent `client_subscriptions` row (or inserts a new one if none exists).
- `app/api/data/route.ts` — added new `admin_client_rates` action (returns all clients + their current `custom_price_rub`, used by the new pricing-tab table). Fixed `admin_clients` and `client_dashboard` actions, both of which previously joined `pricing_tiers(name, price_rub, ...)` through `client_subscriptions` — these joins would have returned stale/broken tier data post-cutover since the tier table is no longer the source of truth. `client_dashboard` now also computes and returns `effectiveRate` (client override → global fallback), though `app/client/dashboard/page.tsx` doesn't currently consume it — confirmed it only destructures `{ profile, sessions, findings }`, so it needed no changes.
- `app/client/dashboard/page.tsx` — reviewed, **no changes needed**. Confirmed it never referenced tier/pricing fields; all cost display there is computed from `session.cost_rub`, unaffected by this change.

**Open items from this session:**
- **Not yet verified end-to-end against a real deploy.** Only the migration has been run and confirmed; the code changes above have been handed off but not yet observed passing a build or a live test (new-audit wizard → price shown as count × rate → admin tab edits both global and per-client rates). Run one full flow before treating this as done.
- `app/api/admin/pricing` still has **no admin-role check** — same P0 gap as the rest of `/api/admin/*`, unchanged by this session; flagged again for visibility since this route now handles live pricing data for a large prospective client.
- `client_subscriptions` upsert-by-most-recent-row assumption (in the PATCH client-scope handler) may be wrong if subscriptions are meant to be period-scoped (the table has `valid_from`/`valid_to`, suggesting historical rows are expected) — flagged to the user, not yet resolved either way. If period-scoping matters, this should insert a new row instead of updating the latest one.
- Old `pricing_tiers` table, its now-dead columns on `client_subscriptions`, and the admin CRUD/route code for them are still live but unused — cleanup deferred until the new code is confirmed solid in production, per the migration's own comments.

---

## Session Log — PDF/Image Parsing Fixes, Chat File Chip, tool_use Guard (July 4, 2026, evening)

**Goal:** verify the `record_findings` tool_use extraction end-to-end (P1 punch-list item), then fix file-parser gaps found along the way (PDF and images both silently failing).

### Part 1 — record_findings duplicate-call guard

Live test confirmed the common case works (single Sonnet call, `stop_reason: tool_use`, 10 findings saved, no continuation needed). But the code had no guard against the model calling `record_findings` more than once across a `max_tokens` continuation loop — `toolFindings` was `.concat()`-ed with no limit. Fixed in `app/api/chat/route.ts`: added a `toolCallSeen` flag; a second call in the same turn is now logged (`console.warn`) and dropped instead of silently merged. Not yet stress-tested against a real multi-continuation run (report was short enough to finish in one call every time tested).

### Part 2 — PDF parsing, three bugs in sequence

1. **`pdf-parse@2.4.5` API mismatch.** Installed version is a full rewrite (`PDFParse` class, no callable default export) but code called the old v1 function API. Every PDF silently fell back to "could not read PDF." Fixed to use `new PDFParse({data}).getText()` — **later abandoned, see #2.**
2. **Nested `pdfjs-dist` worker untraceable.** `pdf-parse` bundles its own internal `pdfjs-dist` copy; Vercel's file-tracing didn't reliably include its worker `.mjs` file no matter what `serverExternalPackages` said. **Decision: dropped `pdf-parse` entirely.** `parsePDF()` now uses the top-level `pdfjs-dist` directly (`getTextContent()` per page) — the same package already used successfully for scanned-PDF rendering, already correctly externalized. `npm uninstall pdf-parse` recommended.
3. **`workerSrc` config, three failed attempts before the fix:** empty string (falsy, treated as unset) → `require.resolve()` (Turbopack returned a non-string, "Invalid workerSrc type") → `createRequire` (same error) → **fixed** with `new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString()`, the bundler-recognized asset-reference pattern. Also briefly tried switching to the CJS legacy build (`pdf.js` instead of `.mjs`) — doesn't exist in pdfjs-dist v4+, reverted.
4. **Detached ArrayBuffer.** Once PDF parsing worked, `parsePDF()`'s `getDocument()` call was transferring/detaching the shared buffer, so the following `renderPDFPagesAsImages()` call (scanned-PDF → vision path) crashed on the same request. Fixed with `.slice(0)` copies in both functions. Also pre-emptively fixed the same `workerSrc=""` bug in `renderPDFPagesAsImages()`, which hadn't surfaced yet only because the buffer bug fired first.

**Verified working end-to-end** on real client files: a text-layer PDF (`ПРОТОКОЛ №1.pdf`) and a scanned PDF (`Новация 2.pdf`, correctly detected as `likelyScanned: true` and routed to vision) both processed successfully in a live chat session, producing real findings referencing their content.

### Part 3 — Images unreachable, then invisible in UI

1. **Picker filtering images out.** `app/client/chat/page.tsx`'s attachment `accept` attribute had no `.jpg/.jpeg/.png` — server-side handling (`/api/upload`'s `ALLOWED_TYPES`) already supported images correctly, only the picker was blocking selection. One-line fix.
2. **Uploaded file invisible in the chat transcript.** Confirmed working via vision after the accept fix, but the user message bubble never showed which file was attached — `Message` only carried `content` (plain text), not file metadata. Fixed: `Message` type extended with optional `fileName`/`fileType`; `sendMessage()` attaches them; bubble renders a 📎 chip. Chip styling iterated once: initial semi-transparent-white chip blurred into the blue bubble — changed to light background (`#e8edf8`) / dark text (`#0c1220`) for contrast.

**Verified working** on a real session — image upload analyzed correctly by the model (correctly identified an irrelevant recruitment ad and asked for the right document instead of hallucinating a finding from the filename).

### Part 4 — Two bugs found, scoped for next session (not fixed yet)

Found while reviewing a full downloaded PDF report:

1. **Chat only supports single-file attachment.** `handleFileSelect` takes `e.target.files?.[0]` — no `multiple` on the input, no loop over multiple files in `uploadAndSend`.
2. **Re-analysis duplicates findings instead of updating them.** The downloaded report showed the same violation restated near-verbatim 3 times (e.g. "Отсутствие подтверждающих документов" as findings #1, #4, #7; "Новация трудовой задолженности" as #3, #6, #9). Each mid-chat document upload appears to trigger a fresh `record_findings` call that **appends** to the `findings` table rather than checking for/updating an existing matching finding from an earlier turn in the same session. Needs investigation into whether Sonnet is re-stating already-known findings each turn (prompt issue — should only report *new* findings) and/or whether `saveFindings()` needs a dedup/upsert strategy against existing rows for the session.

---



**Trigger:** running the same 71-transaction bank statement through three separate AI runs produced three different behaviors — two full analyses with different risk-tier conclusions on the same facts (concentration risk flipped between СУЩЕСТВЕННО and НЕСУЩЕСТВЕННО; personal-expense mixing flipped the other way), and a third run that stopped to ask clarifying questions (tax regime, audit purpose) before analyzing at all. All three are consistent with the same prompt, because nothing in the prompt governed whether to ask or what to assume.

### Part 1 — Tax-Profile Gate (legal form, tax regime, VAT status)

Moved to a hard application-level gate rather than a prompt instruction, since the whole premise of this session was that non-deterministic sampling can't be trusted to reliably ask (or not ask) about facts that change correctness. Full details in the new "Tax-Profile Gate" section above. Summary: new `audit_sessions` columns (migration `006`), new `lib/audit-constants.ts` as shared source of truth, wizard UI gets three new required fields, `create_audit_session` validates server-side, `confirm_audit` re-validates as defense-in-depth, and the `get_or_create_session` bypass is closed by redirecting the chat page to the wizard instead of calling it when no session ID is present. `buildAuditContext()` now renders these as stated facts.

Product decisions made during this work: captured fresh per-session, not inherited from a client profile (client re-enters every audit); `audit_purpose` stays prompt-only rather than becoming a 4th gate (see Part 2).

### Part 2 — Audit-Purpose Prompt Gate

`AUDIT_SYSTEM_PROMPT` now instructs: if audit purpose hasn't been stated, the model's first response must be only that question, before any report. This directly codifies behavior that was previously emergent (present in one of the three test runs, absent in the other two). **Explicitly flagged as unverified** — this is a prompt instruction, not a code-enforced gate, so it carries the same reliability risk being fixed for the other three fields in Part 1. Added to punch list as an item to test against repeated real runs.

A real contradiction was caught and fixed while writing this: the pre-existing "file is already loaded, start analysis immediately" instruction directly conflicted with "ask about purpose first." Reworded so the model won't claim the file is missing, but also won't skip the purpose question because of that instruction.

### Part 3 — Communication style fixes

Two issues found in real output, fixed via prompt edits only (no code changes):
- Sonnet was self-introducing ("Здравствуйте! Меня зовут ИИ Старший Аудитор...") at the start of responses — emergent, not scripted. Added explicit instruction against this; model is told it's a corporate tool, not a conversational partner.
- "Резюме аудитора" was prose (3–5 sentences) per the original spec, but real output was dense and hard to scan. Changed the spec to require a 4–6 point bullet list instead: what was checked, legal form + tax regime, income/expense sources, key issues, risk rating.

Verified against a real deployed session (screenshot review) — both fixes confirmed working: no greeting, purpose question fired with the tax-profile facts already known and not re-asked, summary rendered as bullets.

### Part 4 — Chat UX: real markdown rendering

The screenshot review in Part 3 surfaced a separate, unrelated problem: the chat page renders message text as plain strings, so headers and bold markdown syntax (`## Резюме аудитора`, `**Уровень риска:**`) were showing up as literal `#` and `*` characters instead of rendering. Fixed in `app/client/chat/page.tsx`:
- Added `react-markdown` dependency (`npm install react-markdown` required — no `remark-gfm` needed)
- Custom themed component overrides for `h1`/`h2`/`h3`/`p`/`strong`/`ul`/`ol`/`li`/`hr`/`code` matching the existing dark palette
- Only applied to **finished** assistant messages — the actively-typing message (via `TypewriterMessage`) still renders as plain text, since partial/unclosed markdown mid-animation (e.g. `**Провер`) would render incorrectly. User messages stay plain text always.
- Iterated twice on the `h3` (finding subheader) style based on visual feedback: first added a background chip + heavy weight (800) to make findings stand out from body text, then reduced weight to 600 per feedback that it read as "too bold," then restored the background chip while keeping the lighter weight per further feedback — final state is background chip + `fontWeight: 600`.
- Also changed the `strong` (bold label) color from `#a9c1f0` to `#4d91ff` — the original was too close in lightness to the body text color (`#e8edf8`) to read as distinct at a glance; reused the same saturated blue already used for `h2`/`h3` accents rather than introducing a third accent color.

**Not yet done:** no `h4`+ style override exists. The prompt only asks for two heading levels (`##`/`###`), so risk is low, but if the model ever emits a deeper heading it will render unstyled against the dark theme.

---

## Session Log — Haiku Removal & Sonnet 5 Upgrade (July 3, 2026)

**Goal:** upgrade `SONNET_MODEL` from Sonnet 4.6 to Sonnet 5, then evaluate whether the Haiku 4.5 findings-extraction step was still worth keeping now that real usage data existed.

### Part 1 — Sonnet 5 upgrade

**Change:** `lib/anthropic.ts` — `SONNET_MODEL` changed from `"claude-sonnet-4-6"` to `"claude-sonnet-5"`.

**Behavior differences vs 4.6 confirmed not to be a problem for this codebase:** Sonnet 5 rejects (400 error) manual `thinking.budget_tokens` config and non-default `temperature`/`top_p`/`top_k`. `app/api/chat/route.ts` was checked — it only sets `max_tokens`, `system`, and `messages` (now also `tools`/`tool_choice`, added in Part 2), no sampling params or manual thinking config, so no incompatibility.

**Not yet done:** `SONNET_PRICING` in `lib/anthropic.ts` was deliberately left at the standard $3/$15-per-1M rate rather than updated to Sonnet 5's introductory $2/$10 rate (valid through August 31, 2026) — bundled into the existing P2 punch-list item about reconciling pricing constants across `lib/anthropic.ts` and `lib/billing.ts`, to fix once rather than twice.

### Part 2 — Haiku removed, consolidated to single-call tool_use

**Investigation:** before deciding whether to drop Haiku, real console usage data from June 30, 2026 (a heavy real-audit-testing day) was reviewed — daily token cost and token usage broken down by model. Haiku accounted for ~$0.20 of a $7.63 daily total (≈2.6%) and 76K of 2.26M total tokens. This settled the cost question: Haiku's presence in the pipeline was not meaningfully reducing spend.

**Decision driver:** cost being negligible shifted the question to quality risk, and the two-call split had already caused a real bug — the `evidence_status` field (fixed July 1, see below) was computed by Sonnet but silently dropped because Haiku's extraction schema didn't request it. A second live risk was identified but not yet observed in production: Haiku's extraction call was gated by a keyword regex (`нарушени`, `критич`, `риск`, `штраф`, etc.) on Sonnet's response text — a finding phrased outside that keyword list would never trigger extraction and would be silently absent from the findings table despite being visible in the chat transcript.

**Fix — consolidated to one Sonnet call with `tool_use`:**
1. **`lib/anthropic.ts`** — removed `HAIKU_MODEL` and `HAIKU_PRICING`. Added `FINDINGS_TOOL`, a `record_findings` tool schema mirroring the fields the old Haiku prompt requested (title, risk_level, evidence_status, description, legal_basis, recommendation), with the same "default to risk_flag, never confirmed on ambiguity" instruction now embedded in the schema description. Appended a new section to `AUDIT_SYSTEM_PROMPT` instructing Sonnet to write the full report first, then call `record_findings` exactly once with everything found — or not call it at all if there's nothing to report.
2. **`app/api/chat/route.ts`** — removed `extractAndSaveFindings()` (the Haiku call, regex gate, markdown-fence-stripping, and fallback JSON parsing) entirely. Replaced with `saveFindings()`, which only validates and inserts what the tool call already produced — no LLM call, no JSON parsing, since `tool_use` input arrives as a typed object from the SDK. The generation loop now attaches `tools: [FINDINGS_TOOL]` and walks every content block in the response instead of assuming `content[0]` is text, since a single response can now legitimately contain a text block and a tool_use block together. `stop_reason: "tool_use"` is treated as a normal completion (model finished the report and made its one findings call), distinct from `stop_reason: "max_tokens"` (real truncation, still auto-continues exactly as before).
3. **DB-side validation intentionally kept**, not removed: `saveFindings()` still checks `risk_level`/`evidence_status` against valid enum sets and defaults ambiguous/missing `evidence_status` to `risk_flag`, never `confirmed`. Tool_use input is schema-*guided* by the tool definition, not schema-*enforced* — the model can still in principle return an out-of-enum value, and that must not silently overstate certainty or corrupt the DB.

**What this closes:** the class of bug that caused the July 1 `evidence_status` incident (a field Sonnet reasons about but a second model's schema doesn't request) is now structurally impossible, since there's no second interpretation step. The keyword-regex extraction gate is also gone — no finding can be silently skipped for not matching a keyword list.

**Not yet verified:** whether Sonnet 5 reliably calls `record_findings` after finishing the report text (not mid-report, not skipped) is a behavioral assumption backed only by the system prompt instruction, not yet confirmed against a real audit. **Run one full end-to-end audit and check `findings_ct`/the `findings` table populates correctly, with correct `evidence_status` values, before treating this as done** — same verification standard already applied to the July 1 fix, now needs to be re-cleared under the new architecture.

**Also updated same session:** `PUNCH_LIST.md` — added a P1 item for the tool_use verification above, updated the P2 pricing-reconciliation item to reflect `HAIKU_PRICING`'s removal, and noted the P3 usage-logging item is simpler now (one `usage` object per chat turn instead of two to reconcile).

---

## Session Log — Russia Login Bypass Fix & Evidence-Confidence Status (July 1, 2026)

**Goal:** fix intermittent login failures without VPN reported ahead of a Moscow demo, then close the evidence-confidence-tier gap identified in a system-prompt review.

### Part 1 — Russia login bypass

**Symptom:** login worked reliably with VPN, but was flaky without it from a Russian connection.

**Investigation path:** `lib/supabase-client.ts`, `lib/supabase-server.ts`, `app/(auth)/login/page.tsx`, and `app/api/auth/login/route.ts` were all confirmed clean — the login POST itself was correctly proxied server-side through Vercel with no direct browser-to-Supabase call. The bug was found one layer downstream, in the two portal layouts that run immediately after a successful login.

**Root cause:** `app/admin/layout.tsx` and `app/client/layout.tsx` both called `createClient()` from `lib/supabase-client.ts` — a legitimate `@supabase/ssr` browser client — solely to have a reference for the logout button's `supabase.auth.signOut()`. Constructing that client is not inert: `@supabase/ssr`'s browser client auto-initializes and, sharing cookies with the server-side session set by `/api/auth/login`, can issue its own direct browser → `*.supabase.co` calls for session validation/refresh. That request bypasses Vercel entirely, silently, with `autoRefreshToken` defaulting to true. This produced exactly the reported symptom: works with VPN, flaky without it, even though the architecture diagram and the login route itself were correct.

**Fix:**
1. Removed `createClient()`/`@supabase/ssr` import from both layouts entirely.
2. Added `POST /api/auth/logout` (`app/api/auth/logout/route.ts`) — runs `signOut()` server-side, cookie-clearing pattern mirrors `/api/auth/login`.
3. Both layouts' `handleLogout()` now call `fetch("/api/auth/logout", { method: "POST" })` instead.

**Full-tree audit performed to rule out the same pattern elsewhere:** every page under `app/` was checked individually for `createClient`/`@supabase/ssr` imports — `documents/page.tsx`, `admin/clients/page.tsx`, `admin/clients/new/page.tsx`, `admin/pricing/page.tsx`, `client/chat/page.tsx`, `client/audit/new/page.tsx`, `client/audit/[id]/page.tsx`, `client/dashboard/page.tsx`, `admin/page.tsx` — all clean, all already routed through `/api/*`. The two layouts were the only offenders.

**Not fully closed:** `*.vercel.app` is shared hosting infrastructure; Roskomnadzor blocking sometimes targets IP ranges/SNI rather than specific sites, so collateral blocking unrelated to this app's own code is still possible. Recommended follow-up: move off the `.vercel.app` URL to a custom domain (`assistant24tech.ru` subdomain, CNAME'd to Vercel) before the next Russia-based demo.

**Verified:** login tested from a real Russian connection with VPN off after deploy — confirmed working.

### Part 2 — Evidence-confidence status gap

**Found during:** a review of `AUDIT_SYSTEM_PROMPT` for professional/senior-auditor tone and rigor.

**Root cause:** the prompt has always mandated a `**Статус:**` field per finding (`Подтверждённое нарушение` / `Признак риска` / `Косвенный признак`) as a confidence tier distinct from risk-level severity — but the Haiku extraction step's JSON schema in `app/api/chat/route.ts` never asked for it. Sonnet computed the distinction; Haiku discarded it before the DB write. A proven violation and a weak indirect signal were indistinguishable in the dashboard and downloadable PDF.

**Fix:**
1. **Migration `005_finding_evidence_status.sql`** — adds `finding_evidence_status` ENUM (`confirmed`/`risk_flag`/`indirect`) and `findings.evidence_status` column, default `'risk_flag'`. Verified against live schema before writing (confirmed no drift on `findings`; separately reconfirmed `audit_sessions.paid` is live and still absent from migration files — pre-existing gap, unchanged).
2. **`lib/billing.ts`** — added `EvidenceStatus` type + `getEvidenceStatusLabel/Color/BgColor()` helpers, deliberately a different color palette from risk-level badges so the two axes never visually blur.
3. **`app/api/chat/route.ts`** — Haiku extraction prompt now requests `evidence_status`, with explicit Russian-text-to-enum mapping rules. Defaults to `risk_flag` — never `confirmed` — whenever the source text is ambiguous or the field is missing, so extraction can never overstate certainty. `max_tokens` for the Haiku call raised 1500 → 4096 (longer reports can produce more findings to extract as JSON than the old cap allowed).
4. **`app/client/audit/[id]/page.tsx`** — confidence badge added next to the risk-level badge in the on-screen findings list; also added to the client-side PDF generator's per-finding block (italic label under the title).
5. **`app/client/dashboard/page.tsx`** — same badge added to the "Открытые нарушения" panel for consistency.

**Verified:** migration applied cleanly on live Supabase (`information_schema.columns` confirms `evidence_status`/`USER-DEFINED`). **Not yet independently confirmed post-deploy that a real Sonnet→Haiku round trip produces a non-default value (`confirmed`/`indirect`)** — only backfilled/pre-migration rows and a preliminary (non-full) test were checked, all showing the `risk_flag` default as expected. Run one full audit end-to-end and check `findings.evidence_status` on a fresh row before treating this as fully verified.

### Part 3 — Local git repo location

Confirmed via file explorer: `.git` is at `H:\AI Work\audit-agent\ai-senior-auditor`, one level deeper than `H:\AI Work\audit-agent` (where git commands were initially — incorrectly — being run, producing `fatal: not a git repository`). No repo content was lost; this was purely a wrong-working-directory issue. Noted at the top of this doc to prevent recurrence.

---

## Session Log — File Parsing & Chat Route Overhaul (June 30, 2026)

**Goal:** fix the file-parsing gaps from the original punch list (multi-sheet XLSX/XLS, `.txt` unreachable from UI, no PDF support) plus a UI polish request (typewriter speed).

**What changed:**
1. `app/client/chat/page.tsx` — typewriter effect doubled in speed via `CHARS_PER_TICK = 2` (interval kept at the original frame-safe 18ms; shrinking the interval alone wouldn't have worked since RAF clamps to the display refresh rate, ~16.6ms on 60Hz).
2. `lib/file-parser.ts` — `parseXLSX()`/`parseXLS()` rewritten to read all sheets with real sheet-name resolution; added `parsePDF()` (text-layer extraction via `pdf-parse`) and `renderPDFPagesAsImages()` (scanned-PDF rasterization via `pdfjs-dist` + `@napi-rs/canvas`, capped at 10 pages).
3. `app/api/chat/route.ts` — `getAllDocumentsContent()` rewritten to trust the DB's `file_type` column instead of re-deriving from filename extension (the actual root cause of `.doc`/`.txt`/`.pdf` being silently mis-parsed). Images now routed to native vision as base64 blocks on the outgoing message.
4. `app/client/documents/page.tsx` — `.xls`, `.doc`, `.txt` added to file picker `accept`; missing file-type icons (xls, doc, 1c_txt) added.
5. `app/client/audit/new/page.tsx` — `.txt` added to file picker `accept`.
6. `next.config.ts` — added `serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"]` so Turbopack stops trying to bundle their native/WASM bindings into an ESM chunk.

**Deploy issues hit and fixed (two failed Vercel builds before a clean one):**
- Build 1: TS error — `(await import("pdf-parse")).default` doesn't exist on the installed version's ESM type declarations. Fixed by casting the import to `any` and falling back to the namespace itself (`pdfParseModule.default ?? pdfParseModule`).
- Build 2: Turbopack failed to bundle `@napi-rs/canvas`'s native binding (`js-binding.js` — "non-ecmascript placeable asset"). Fixed via `serverExternalPackages` in `next.config.ts`.
- Build 3: the `any`-typed pdf-parse cast leaked into `rawText`/`numPages`, causing an implicit-`any` error on a downstream `.filter(l => ...)` callback. Fixed by explicitly typing `rawText: string` and `numPages: number` at the point they're read from `result`.
- **As of this writing, the build has not yet been confirmed clean past build 3** — last known state is the fix was pushed, no build log reviewed yet to confirm success.

**Explicitly NOT done / open items from this session:**
- No real Vercel deployment has been confirmed working end-to-end yet — only confirmed to *build*. Cold-start latency, function bundle size, and whether `@napi-rs/canvas`'s prebuilt binary actually matches Vercel's runtime are all still unverified.
- Multi-sheet parser fix not yet re-tested against the real 135+178 row client file post-deploy.
- Scanned-PDF rendering not yet tested against a real scanned document.
- Chat page attachment button's `accept` attribute still excludes `.txt`/`.doc` — left as-is pending a decision.
- Mixed-content PDFs (typed + handwritten) will misclassify per the whole-document averaging heuristic — known limitation, not fixed.

**Suggested next session starting point:** confirm the latest Vercel build is green, then do real-file testing (multi-sheet XLS, 1C `.txt`, text PDF, scanned PDF) against the live deploy before moving to the next punch-list item (P0 auth checks are still the biggest open risk — see PUNCH_LIST.md).
