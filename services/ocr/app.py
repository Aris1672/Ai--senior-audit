"""
Text-recognition service for the AI Senior Auditor (scans and photos).

Turns a scanned PDF or a JPG / PNG into text on our own server, so scans of
client documents never leave it. Engine: Tesseract 5 with rus+eng.

  POST /recognize   body = the file's bytes, Content-Type application/pdf,
                    image/jpeg or image/png, header X-OCR-Token
              ->    {"engine": "tesseract 5.3.0", "pages": [
                       {"page": 1, "text": "...", "confidence": 93.4, "words": 212,
                        "uncertainNumbers": 1, "rotated": 0}, ...]}
  GET  /health  ->  {"status": "ok"}

What is done to every page (tuned on 13.11.2026, scripts/dev/README.md):
  · PDF pages are rendered at 300 dpi; photos are turned upright by their
    EXIF tag and scaled down above 3 500 px wide;
  · the ruling lines of tables are removed before recognition — with them
    Tesseract lost most amounts in table cells (8 of 24 amounts read on our
    test pages; 24 of 24 without them);
  · small images are scaled up (text needs ~25 px per line);
  · Tesseract --psm 6; a page read with low confidence is tried once more
    turned by the angle Tesseract's orientation detector reports (pages
    scanned sideways), and the better reading is kept;
  · a word with digits read with low confidence is marked "[?]" in the text,
    so the auditor sees which figures are doubtful;
  · in a Russian line, words read with Latin look-alike letters ("OOO", "1C")
    are put back into Cyrillic.

The service does NOT decide whether a page is good enough — it reports the
confidence, and the auditor applies its threshold (OCR_MIN_CONFIDENCE there).

Privacy: receives REAL client documents. It never logs request content or
recognised text, writes page images only to a temporary directory that is
deleted before the response, and keeps nothing. Every /recognize call must
carry the shared secret OCR_TOKEN; without one configured the service refuses
to work.
"""
import hmac
import io
import os
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional

os.environ.setdefault("OMP_THREAD_LIMIT", "1")   # one core per Tesseract run; parallelism is ours

import cv2
import numpy as np
import pytesseract
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from PIL import Image, ImageOps

TOKEN = os.environ.get("OCR_TOKEN", "")
WORKERS = max(1, int(os.environ.get("OCR_WORKERS", "2")))
MAX_PAGES = int(os.environ.get("OCR_MAX_PAGES", "300"))
MAX_BYTES = 50 * 1024 * 1024
LANG = "rus+eng"
DPI = 300
MAX_WIDTH = 3500
MIN_WIDTH = 1800          # below this a page is scaled up
RETRY_BELOW = 75.0        # page confidence under which a turned reading is tried
WORD_DOUBT = 60.0         # a word with digits under this confidence is marked [?]

Image.MAX_IMAGE_PIXELS = 120_000_000
POOL = ThreadPoolExecutor(max_workers=WORKERS)   # shared by all requests


def engine_version() -> str:
    try:
        return f"tesseract {pytesseract.get_tesseract_version()}"
    except Exception:
        return "tesseract"


# ─── Page preparation ────────────────────────────────────────────────────────
def prepare(im: Image.Image) -> np.ndarray:
    g = np.array(im.convert("L"))
    w = g.shape[1]
    if w > MAX_WIDTH:
        f = MAX_WIDTH / w
        g = cv2.resize(g, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    elif w < MIN_WIDTH:
        f = MIN_WIDTH * 1.4 / w
        g = cv2.resize(g, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC)
    # Table rules: long thin horizontal / vertical runs of dark pixels.
    b = cv2.adaptiveThreshold(g, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 15)
    w = g.shape[1]
    hk = cv2.getStructuringElement(cv2.MORPH_RECT, (max(40, w // 25), 1))
    vk = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(40, w // 40)))
    rules = cv2.morphologyEx(b, cv2.MORPH_OPEN, hk) | cv2.morphologyEx(b, cv2.MORPH_OPEN, vk)
    rules = cv2.dilate(rules, np.ones((3, 3), np.uint8))
    g = g.copy()
    g[rules > 0] = 255
    return g


# ─── Recognition ─────────────────────────────────────────────────────────────
# Latin letters that look like Cyrillic ones. In a Russian line Tesseract
# often reads "ООО" or "1С" with Latin letters, and then the text no longer
# matches the same names in the base or the statement.
HOMOGLYPHS = str.maketrans("ABCEHKMOPTXaceopxy", "АВСЕНКМОРТХасеорху")
LATIN = set("ABCEHKMOPTXaceopxy")


def to_cyrillic(words: List[str]) -> List[str]:
    cyr = sum(1 for w in words for ch in w if "а" <= ch.lower() <= "я" or ch in "ёЁ")
    lat = sum(1 for w in words for ch in w if "a" <= ch.lower() <= "z")
    if cyr <= lat:
        return words
    # Only words whose every letter has a Cyrillic twin ("OOO", "1C", "A4");
    # a real Latin word ("CF283A", "Excel") is left as it is.
    return [w.translate(HOMOGLYPHS) if any(ch in LATIN for ch in w)
            and all(ch in LATIN or not ch.isalpha() for ch in w) else w for w in words]


def read(g: np.ndarray) -> dict:
    d = pytesseract.image_to_data(g, lang=LANG, config="--psm 6", output_type=pytesseract.Output.DICT)
    lines: dict = {}
    total_w = total_c = 0.0
    words = doubtful = 0
    for i, raw in enumerate(d["text"]):
        word = raw.strip()
        conf = float(d["conf"][i])
        if not word or conf < 0:
            continue
        words += 1
        total_w += len(word)
        total_c += conf * len(word)
        if conf < WORD_DOUBT and any(ch.isdigit() for ch in word):
            word += "[?]"
            doubtful += 1
        key = (d["block_num"][i], d["par_num"][i], d["line_num"][i])
        lines.setdefault(key, []).append(word)
    text = "\n".join(" ".join(to_cyrillic(ws)) for _, ws in sorted(lines.items()))
    return {"text": text, "confidence": round(total_c / total_w, 1) if total_w else 0.0,
            "words": words, "uncertainNumbers": doubtful}


def osd_angle(g: np.ndarray) -> int:
    try:
        info = pytesseract.image_to_osd(g, config="--psm 0")
    except Exception:
        return 0
    for line in info.splitlines():
        if line.startswith("Rotate:"):
            try:
                return int(line.split(":")[1]) % 360
            except ValueError:
                return 0
    return 0


def recognise_page(im: Image.Image) -> dict:
    g = prepare(im)
    best = read(g)
    best["rotated"] = 0
    if best["words"] > 0 and best["confidence"] < RETRY_BELOW:
        angle = osd_angle(g)
        if angle:
            turned = np.ascontiguousarray(np.rot90(g, k=-angle // 90))
            again = read(turned)
            if again["confidence"] > best["confidence"]:
                best = again
                best["rotated"] = angle
    return best


def pdf_pages(data: bytes, tmp: str) -> List[str]:
    src = os.path.join(tmp, "in.pdf")
    with open(src, "wb") as f:
        f.write(data)
    info = subprocess.run(["pdfinfo", src], capture_output=True, text=True, timeout=60)
    pages = 0
    for line in info.stdout.splitlines():
        if line.startswith("Pages:"):
            pages = int(line.split(":")[1])
    if info.returncode != 0 or pages <= 0:
        raise HTTPException(status_code=422, detail="the PDF cannot be opened")
    if pages > MAX_PAGES:
        raise HTTPException(status_code=413, detail=f"too many pages ({pages} > {MAX_PAGES})")
    r = subprocess.run(["pdftoppm", "-r", str(DPI), "-gray", "-png", src, os.path.join(tmp, "p")],
                       capture_output=True, timeout=60 + pages * 20)
    if r.returncode != 0:
        raise HTTPException(status_code=422, detail="the PDF pages cannot be rendered")
    os.remove(src)
    return sorted((os.path.join(tmp, n) for n in os.listdir(tmp) if n.startswith("p")),
                  key=lambda p: int(p.rsplit("-", 1)[1].split(".")[0]))


def open_image(data: bytes) -> Image.Image:
    try:
        im = Image.open(io.BytesIO(data))
        im = ImageOps.exif_transpose(im)
        im.load()
        return im
    except Exception:
        raise HTTPException(status_code=422, detail="the image cannot be opened")


def recognise(data: bytes, kind: str) -> List[dict]:
    if kind == "pdf":
        with tempfile.TemporaryDirectory(prefix="ocr-") as tmp:
            files = pdf_pages(data, tmp)
            def one(path: str) -> dict:
                with Image.open(path) as im:
                    return recognise_page(im)
            results = list(POOL.map(one, files))
    else:
        im = open_image(data)
        results = [POOL.submit(recognise_page, im).result()]
    return [{"page": i + 1, **r} for i, r in enumerate(results)]


# ─── HTTP ────────────────────────────────────────────────────────────────────
app = FastAPI(title="auditor-ocr", docs_url=None, redoc_url=None, openapi_url=None)
ENGINE = engine_version()


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


KINDS = {"application/pdf": "pdf", "image/jpeg": "image", "image/png": "image"}


@app.post("/recognize")
async def recognize(request: Request, x_ocr_token: str = Header(default=""),
                    content_type: Optional[str] = Header(default=None)) -> dict:
    if not TOKEN:
        raise HTTPException(status_code=503, detail="OCR_TOKEN is not configured on the service")
    if not hmac.compare_digest(x_ocr_token.encode(), TOKEN.encode()):
        raise HTTPException(status_code=401, detail="unauthorized")
    kind = KINDS.get((content_type or "").split(";")[0].strip().lower())
    if not kind:
        raise HTTPException(status_code=415, detail="send application/pdf, image/jpeg or image/png")
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="empty body")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="file too large")
    pages = await run_in_threadpool(recognise, data, kind)
    return {"engine": ENGINE, "pages": pages}
