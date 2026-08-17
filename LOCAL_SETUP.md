# Running Locally — Step by Step

This guide gets the AI Ebook Writer running on your own machine (no Render, no
Neon needed unless you want a persistent library). It covers two processes:

- **Backend** — FastAPI + Playwright/Chromium that generates the book and
  renders the PDF.
- **Frontend** — Next.js app you open in the browser.

The two talk over HTTP: the frontend calls `http://localhost:8000` by default.

---

## 0. Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Python | 3.12+ | `python3 --version` |
| Node.js | 22.12.0+ (20+ works) | `node --version` |
| npm | comes with Node | `npm --version` |
| Google Gemini API key | free | https://aistudio.google.com/apikey |

> Chromium is installed automatically by Playwright (below). On Linux you may
> also need OS libraries — `playwright install-deps` handles that.

---

## 1. Clone / open the project

```bash
cd /path/to/ebook-writer
```

---

## 2. Backend

### 2a. Create a virtual environment and install dependencies

```bash
cd backend
python3 -m venv venv
source venv/bin/activate            # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2b. Install the Chromium browser Playwright renders with

```bash
playwright install chromium
# Linux only, if Chromium fails to launch:
playwright install-deps chromium
```

### 2c. Configure environment

Copy the example file and fill in your Gemini key:

```bash
cp .env.example .env
```

Edit `backend/.env`:

```dotenv
# Required — your Gemini key (comma-separate several to rotate / raise quota)
GEMINI_API_KEYS=your-key-here

# Optional — model name (defaults to gemini-3.6-flash)
# GEMINI_MODEL=gemini-3.6-flash

# Optional — CORS origins allowed to call the API. "*" is fine for local dev.
ALLOWED_ORIGINS=*

# Optional — set false to skip page-count verification (faster, less memory).
# PAGE_VERIFY=true

# Optional — persistent library. Without it the app still works, you just
# won't get a saved "My Books" library (books are not stored).
# DATABASE_URL=postgresql://user:pass@localhost:5432/ebook_writer
```

> **No database?** The backend degrades gracefully: generation and PDF download
> still work, but the "My Books" library will be empty and downloads won't be
> saved. To enable the library, see Step 4.

### 2d. Run the backend

```bash
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8001
```

> **Port conflict?** `8000` is frequently taken by other dev servers (e.g. a
> Laravel/PHP app). Use `8001` (as above) and point the frontend at it:
> set `NEXT_PUBLIC_API_URL=http://127.0.0.1:8001` in `.env.local`, then start
> `npm run dev`. The frontend's `.env.local` overrides any inline env var, so
> edit that file rather than passing the variable on the command line.

You should see:

```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Application startup complete.
```

Smoke-test it (separate terminal):

```bash
curl http://localhost:8000/api/health
# {"status":"ok","db":"connected"|"disabled", ...}
```

---

## 3. Frontend

Open a **new terminal** (keep the backend running).

```bash
cd /path/to/ebook-writer        # repo root, not backend/
npm install
```

The frontend points at the backend via `NEXT_PUBLIC_API_URL`. The value is inlined
at build time and **`.env.local` wins over any inline env var**, so edit that file:

```dotenv
# .env.local
NEXT_PUBLIC_API_URL=http://127.0.0.1:8001
```

Then run (and open **http://localhost:3000**):

```bash
npm run dev
```

Change the port to match wherever you started the backend, then restart
`npm run dev` for it to take effect.

---

## 4. (Optional) Enable the persistent library with Postgres

Generation works without a database, but "My Books" / saved PDFs need Postgres.

### Quick option — local Postgres

```bash
# macOS (Homebrew)
brew install postgresql@16 && brew services start postgresql@16
createdb ebook_writer

# or Docker
docker run --name ebook-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ebook_writer -p 5432:5432 -d postgres:16
```

Then in `backend/.env`:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ebook_writer
```

Restart the backend; the schema is created automatically on startup. The health
endpoint will report `"db":"connected"`.

### Cloud option — Neon

Create a project at https://neon.tech, copy the connection string, and put it in
`DATABASE_URL`. The backend appends `?sslmode=require` automatically for
non-localhost hosts.

---

## 5. Try it

1. Open http://localhost:3000.
2. Pick a template (or type a topic), set the reading level / length, and
   generate.
3. When it's done, open the PDF or save it to "My Books" (needs Postgres).
4. If you enabled Postgres, refresh the page — your book appears in the library.

---

## 6. Stopping

- Stop the backend: `Ctrl+C` in its terminal, then `deactivate`.
- Stop the frontend: `Ctrl+C`.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `playwright` command not found | You're outside the venv — run `source venv/bin/activate` first. |
| Chromium won't launch on Linux | Run `playwright install-deps chromium`. |
| Frontend can't reach backend (`fetch failed`) | Confirm backend is on :8000 and `NEXT_PUBLIC_API_URL` matches; restart `npm run dev` after changing it. |
| CORS error in browser console | Set `ALLOWED_ORIGINS=*` (or your frontend URL) in `backend/.env` and restart the backend. |
| Library empty / "db disabled" | `DATABASE_URL` is unset or wrong — see Step 4; check `/api/health`. |
| PDF is blank / slow | Leave `PAGE_VERIFY=true`; ensure Chromium installed. On low-RAM machines set `PAGE_VERIFY=false`. |
| `ModuleNotFoundError` on import | `pip install -r requirements.txt` inside the activated venv. |
