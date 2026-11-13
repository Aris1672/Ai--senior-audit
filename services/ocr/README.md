# Text-recognition service (Tesseract)

Turns scans and photos of documents (scanned PDF, JPG, PNG) into text so the
auditor can analyse them. Used by `lib/ocr-client.ts` → `app/api/upload/route.ts`.
It receives real client documents, so it runs only on our own Coolify server
(`assistant_vps_4`), every call must carry the shared secret `OCR_TOKEN`, and
nothing is logged or kept.

The service only reads. Whether a page is good enough is decided by the
auditor (`OCR_MIN_CONFIDENCE`, default 75): a page below it is "not reliably
recognised" — not analysed and not charged.

## 1. Create the app in Coolify

Same recipe as `services/ner/README.md`:

1. Project "Auditor" → **+ New** → the GitHub App source ("My-Git-Hub") →
   repository `Aris1672/Ai--senior-audit`, branch `main`, server `assistant_vps_4`.
2. **Build Pack: Dockerfile**.
3. **Base Directory: `/services/ocr`**.
4. **Ports Exposes: `8000`**.
5. Environment variable **`OCR_TOKEN`** = a long random string
   (`openssl rand -hex 32`), different from `NER_TOKEN`.
   Optional: `OCR_WORKERS` (pages recognised at once, default 2 — one core
   each; keep at most the number of cores minus one), `OCR_MAX_PAGES`
   (default 300 pages per file).
6. **Network Aliases: `ocr`**, Domains empty (as for `ner`). If the field is
   missing, use a public domain `ocr.assistant24info.ru` as in option B of the
   NER README — the token then protects it.
7. Deploy. Memory: about 300 MB at rest, up to ~1 GB while a large scan is
   being read with two workers.

## 2. Connect the auditor

In the auditor app (Production and Preview): `OCR_URL=http://ocr:8000` (or the
public domain) and `OCR_TOKEN` (same value as the service). Redeploy the
auditor.

Check from the auditor's terminal (a real call with the token, a tiny PNG with
no text — expect `200` and one page with 0 words):

    node -e "const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==','base64');fetch(process.env.OCR_URL+'/recognize',{method:'POST',headers:{'content-type':'image/png','x-ocr-token':process.env.OCR_TOKEN},body:png}).then(async r=>console.log(r.status,await r.text()),e=>console.log('FAILED',e.cause?.code||e.message))"

`FAILED …` = not reachable; `401` = tokens differ; `503` = token not set on
the service.

## Behaviour

- `OCR_URL` set → scans and images are recognised at upload. The text is
  stored once beside the file (`<file>.ocr.json` in the same storage bucket)
  and read from there on every turn — never recognised again.
- Service down / unreachable / wrong token at upload → the document is
  treated as unreadable: 0 ₽, not analysed, and the client is told to upload
  it again later. (Unlike Natasha, the audit itself is not blocked: no text
  from the file is sent anywhere.)
- `OCR_URL` not set → as before: images and scans are not analysed, 0 ₽.
- `/health` is open (no data); `/recognize` needs the token.

## What is done to a page

PDF pages rendered at 300 dpi; photos turned upright by EXIF; table ruling
lines removed (without this most amounts in table cells were lost); small
images scaled up; Tesseract `--psm 6`, `rus+eng`; a low-confidence page is
tried once more turned by the detected orientation; digits read with low
confidence are marked `[?]`; Latin look-alike letters in Russian lines are
put back into Cyrillic. Measurements: `PROJECT_STATUS.md`, entry of
November 13, 2026 (OCR built).

## Local run

    python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    # needs the tesseract (with rus) and poppler-utils programs installed
    OCR_TOKEN=dev .venv/bin/uvicorn app:app --port 8000 --no-access-log
