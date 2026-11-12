"""
Name-detection service for the AI Senior Auditor (pseudonymization, Step C).

Finds people's names in Russian text with Natasha (NER) so the auditor app can
code them before anything is sent to the LLM. It closes the gap the app's own
shape rules cannot: a bare surname in free text ("возврат займа Сидорову").

  POST /names   {"texts": ["...", "..."]}
            ->  {"names": [{"text": "Сидорову", "normal": "Сидоров"}, ...]}
  GET  /health  -> {"status": "ok"}

Privacy: runs on our own server and receives REAL client text, so it never
logs request content and keeps nothing after the response. Every /names call
must carry the shared secret NER_TOKEN (header X-NER-Token) — the service
refuses to work without one configured, because on this infrastructure it may
have to be reached through a public domain (see README).

Bank exports are often ALL CAPS, where NER models fail. Such lines are
"true-cased" first: words that the morphology dictionary knows as a surname,
first name or patronymic get a capital letter, everything else is lowercased.
"""
import hmac
import os
import re
from typing import List

import pymorphy2
from fastapi import FastAPI, Header, HTTPException
from natasha import Doc, MorphVocab, NewsEmbedding, NewsMorphTagger, NewsNERTagger, PER, Segmenter
from pydantic import BaseModel

MAX_TEXTS = 200
MAX_TOTAL_CHARS = 2_000_000
TOKEN = os.environ.get("NER_TOKEN", "")

segmenter = Segmenter()
morph_vocab = MorphVocab()
_emb = NewsEmbedding()
morph_tagger = NewsMorphTagger(_emb)
ner_tagger = NewsNERTagger(_emb)
morph = pymorphy2.MorphAnalyzer()

NAME_TAGS = {"Surn", "Name", "Patr"}
WORD = re.compile(r"[А-ЯЁа-яё]+")


def truecase_line(line: str) -> str:
    letters = [c for c in line if c.isalpha()]
    if not letters or sum(c.isupper() for c in letters) / len(letters) < 0.7:
        return line

    def fix(m: "re.Match[str]") -> str:
        word = m.group(0)
        best = morph.parse(word)[0]
        tags = set(str(best.tag).replace(" ", ",").split(","))
        return word.capitalize() if (tags & NAME_TAGS and best.score >= 0.3) else word.lower()

    out = WORD.sub(fix, line)
    return out[:1].upper() + out[1:]


def find_names(text: str) -> List[dict]:
    # True-case per field: bank exports are ";"-separated rows where one field
    # (the payment purpose) may be ALL CAPS while the others are not.
    prepared = "".join(truecase_line(part) for part in re.split(r"([;\n])", text))
    doc = Doc(prepared)
    doc.segment(segmenter)
    doc.tag_morph(morph_tagger)
    doc.tag_ner(ner_tagger)
    found = []
    for span in doc.spans:
        if span.type != PER:
            continue
        span.normalize(morph_vocab)
        found.append({"text": span.text, "normal": span.normal or span.text})
    return found


class NamesRequest(BaseModel):
    texts: List[str]


app = FastAPI(title="auditor-ner", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/names")
def names(req: NamesRequest, x_ner_token: str = Header(default="")) -> dict:
    if not TOKEN:
        raise HTTPException(status_code=503, detail="NER_TOKEN is not configured on the service")
    if not hmac.compare_digest(x_ner_token.encode(), TOKEN.encode()):
        raise HTTPException(status_code=401, detail="unauthorized")
    if len(req.texts) > MAX_TEXTS or sum(len(t) for t in req.texts) > MAX_TOTAL_CHARS:
        raise HTTPException(status_code=413, detail="request too large")
    seen, result = set(), []
    for text in req.texts:
        for item in find_names(text):
            key = (item["text"], item["normal"])
            if key not in seen:
                seen.add(key)
                result.append(item)
    return {"names": result}
