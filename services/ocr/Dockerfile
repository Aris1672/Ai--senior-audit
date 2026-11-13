# Text-recognition service (Tesseract). Separate Coolify app, Base Directory: /services/ocr
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 OMP_THREAD_LIMIT=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-rus tesseract-ocr-eng tesseract-ocr-osd poppler-utils \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app.py .

RUN useradd --system --uid 1001 ocr
USER ocr

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

# --no-access-log: request lines are not logged; request bodies and recognised text are never logged.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
