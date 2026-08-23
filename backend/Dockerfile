# FastAPI + Playwright(Chromium) backend for Render.
#
# Why Docker instead of Render's native Python runtime?
#   Chromium needs ~20 system libraries (fonts, nss, dbus, gtk...). In Docker we
#   are root, so `playwright install --with-deps chromium` installs them in one
#   line and the image is identical on your laptop and on Render.

FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PORT=8000

WORKDIR /app

# Chromium is downloaded by Playwright; these are just build/runtime basics.
# fonts-noto-core ships Noto Sans Bengali (and friends) as a fontconfig-level
# fallback, so Bangla glyphs survive even if the embedded webfont ever fails.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*

# 1) Python deps first so Docker layer caching survives app-code changes.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 2) Chromium + its OS dependencies (installed as root, cached in the image).
RUN playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# 3) Application code.
COPY . .

# Playwright writes nothing at runtime, but the PDF pipeline needs a scratch dir.
ENV PDF_OUTPUT_DIR=/tmp/ebook-writer
RUN mkdir -p /tmp/ebook-writer

# Bundled Bengali font so Bangla ebooks render glyphs in the PDF/preview.
ENV BENGALI_FONT_PATH=/app/assets/fonts/NotoSansBengali-Regular.ttf

EXPOSE 8000

# Render injects $PORT. One worker: each PDF render spawns Chromium, so extra
# workers multiply memory instead of throughput. Scale with instances/plan.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --timeout-keep-alive 120"]
