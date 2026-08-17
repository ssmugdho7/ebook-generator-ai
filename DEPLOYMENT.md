# Deploying to Render + Neon — Step by Step

This guide takes you from "code on my laptop" to a live URL, using:

| Piece | Service | Free? |
|-------|---------|-------|
| Frontend (Next.js) | Render Web Service (Node) | Yes |
| Backend (FastAPI + Chromium) | Render Web Service (Docker) | Yes |
| Database (library + saved PDFs) | Neon Postgres | Yes |
| AI | Google Gemini | Yes (rate-limited) |

```
        Browser
           │
           ▼
┌──────────────────────┐        HTTPS        ┌──────────────────────────┐
│  Render: ebook-web   │ ──────────────────▶ │  Render: ebook-api       │
│  Next.js 16          │                     │  FastAPI + Playwright    │
└──────────────────────┘                     └───────────┬──────────────┘
                                                         │
                                        ┌────────────────┴───────────────┐
                                        ▼                                ▼
                              ┌──────────────────┐            ┌────────────────────┐
                              │  Neon Postgres   │            │  Google Gemini API │
                              │  books + PDFs    │            │  story generation  │
                              └──────────────────┘            └────────────────────┘
```

**Why a database at all?** Render's filesystem is ephemeral: every deploy and
every free-tier sleep wipes it. Generated books and compiled PDFs are therefore
stored in Neon, so your library survives restarts and re-downloads are instant
(no Gemini call, no re-render).

---

## Before you start (10 minutes)

You need four free accounts:

1. **GitHub** — the code must be in a repo Render can read.
2. **Neon** — https://neon.tech (Postgres, free tier: 0.5 GB).
3. **Render** — https://render.com.
4. **Google AI Studio** — https://aistudio.google.com/apikey for Gemini keys.

> **Tip:** create 3–4 Gemini keys. The backend rotates between them and puts
> rate-limited keys on a 60-second cooldown, which multiplies your free quota.

---

## Step 1 — Push the code to GitHub

```bash
cd /path/to/ebook-writer
git add -A
git commit -m "Render + Neon deployment ready"
git push origin main
```

Files that make this repo deployable (already included):

| File | Purpose |
|------|---------|
| `render.yaml` | Blueprint: defines both Render services at once |
| `backend/Dockerfile` | Python 3.12 + Chromium image for PDF rendering |
| `backend/.dockerignore` | Keeps the image small (no venv, no generated PDFs) |
| `backend/schema.sql` | The Neon schema (also auto-created on boot) |
| `.env.example`, `backend/.env.example` | Every variable you can set |

---

## Step 2 — Create the Neon database

1. Go to https://console.neon.tech → **New Project**.
2. Name it `ebook-writer`. Pick the region **closest to your Render region**
   (this guide uses Render `oregon` → choose Neon `AWS us-west-2`).
3. Click **Create project**. Neon shows a connection string — click
   **Connect** → **Connection string** and copy it. It looks like:

   ```
   postgresql://neondb_owner:npg_XXXXXXXX@ep-cool-lab-12345678-pooler.us-west-2.aws.neon.tech/neondb?sslmode=require
   ```

4. **Use the pooled host** (the one containing `-pooler`). It handles many short
   connections, which is exactly what a web app does.
5. Keep that string somewhere safe — it is your `DATABASE_URL`.

> You do **not** need to run any SQL. The backend creates its tables on first
> boot (`ebooks`, `ebook_pdfs`, `generation_events`). If you prefer doing it
> yourself, paste `backend/schema.sql` into Neon's **SQL Editor** and run it.

---

## Step 3 — Deploy both services with the Blueprint

1. In Render: **New** → **Blueprint**.
2. Connect your GitHub account, pick the `ebook-writer` repo, click **Connect**.
3. Render reads `render.yaml` and shows two services: **ebook-api** and
   **ebook-web**.
4. It will ask you for the two secret values:

   | Variable | Value |
   |----------|-------|
   | `GEMINI_API_KEYS` | `key1,key2,key3` (comma-separated, no spaces) |
   | `DATABASE_URL` | the Neon pooled connection string from Step 2 |

5. Click **Apply**.

Render now:

- builds the backend Docker image (Chromium included) — **8–12 min the first
  time**, ~2 min afterwards thanks to layer caching;
- builds the Next.js frontend — 1–2 min;
- wires `NEXT_PUBLIC_API_URL` on the frontend to the API's hostname, and
  `ALLOWED_ORIGINS` on the API to the frontend's hostname — no copy/paste.

> **Deploy order note:** on the very first apply, one service may build before
> the other exists and its cross-reference resolves empty. If the frontend can't
> reach the API, open **ebook-web → Manual Deploy → Clear build cache & deploy**
> once. (Remember: `NEXT_PUBLIC_*` is baked in at *build* time.)

---

## Step 4 — Verify the backend

Grab the API URL from Render (e.g. `https://ebook-api.onrender.com`) and run:

```bash
curl https://ebook-api.onrender.com/api/health
```

A healthy deployment looks like this:

```json
{
  "status": "ok",
  "model": "gemini-3.6-flash",
  "keys_available": 3,
  "key_status": [{"key_preview": "...AbCdEfGh", "available": true, "recovers_in": 0}],
  "database": {"configured": true, "connected": true, "ebooks": 0},
  "page_verification": "false",
  "allowed_origins": ["https://ebook-web.onrender.com"]
}
```

Check three things:

- `keys_available` is **not 0** → Gemini keys are set.
- `database.connected` is **true** → Neon is reachable.
- `allowed_origins` contains your frontend URL → CORS is correct.

Other useful endpoints:

```bash
curl https://ebook-api.onrender.com/api/templates   # the 4 designs
curl https://ebook-api.onrender.com/api/library     # saved ebooks (starts empty)
```

---

## Step 5 — Verify the app end to end

1. Open your frontend URL (e.g. `https://ebook-web.onrender.com`).
   On the free plan the first load can take ~50 s while both services wake up.
2. Click **Load Sample** (or paste your own notes).
3. Choose a design and a target length, click **Generate Ebook**.
4. You should get a story: named characters, one everyday world, a cliffhanger
   ending every section, and a "Moral of the Story" section at the end.
5. Click **Download PDF** → the PDF downloads and the cover designer opens.
6. Click **Start Over** → your ebook now appears under **Your Library** with a
   `PDF saved` badge. The **PDF** button there is instant (served from Neon).

Sanity checks worth doing once:

- A fitness/cooking topic → no code blocks, health-flavoured cover icons.
- A programming topic → code blocks appear with syntax highlighting.

---

## Step 6 — Confirm the data landed in Neon

Neon Console → your project → **SQL Editor**:

```sql
SELECT title, template_id, page_count, section_count, created_at
FROM ebooks ORDER BY created_at DESC LIMIT 10;

SELECT e.title, pg_size_pretty(p.byte_size::bigint) AS pdf_size
FROM ebook_pdfs p JOIN ebooks e ON e.id = p.ebook_id;

SELECT kind, status, duration_ms, detail, created_at
FROM generation_events ORDER BY created_at DESC LIMIT 20;
```

---

## Environment variables reference

### Backend (`ebook-api`)

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `GEMINI_API_KEYS` | yes | — | Comma-separated Gemini keys, rotated automatically |
| `GEMINI_API_KEY` | no | — | Single-key fallback |
| `DATABASE_URL` | no* | — | Neon connection string. Empty ⇒ no library, generation still works |
| `ALLOWED_ORIGINS` | no | `*` | Comma-separated frontend origins; bare hostnames get `https://` added |
| `PAGE_VERIFY` | no | `true` | `true` = render the PDF to count pages exactly; `false` = fast estimate |
| `PDF_OUTPUT_DIR` | no | system temp | Scratch dir for intermediate PDFs |
| `DB_POOL_MAX` | no | `5` | Max pooled Postgres connections |

\* Required for the library/PDF-persistence features.

### Frontend (`ebook-web`)

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_API_URL` | yes | Backend URL or bare hostname. **Baked in at build time** |
| `NODE_VERSION` | no | Pinned to `22.12.0` in `render.yaml` |

---

## Performance & cost notes

Measured on the Docker image in this repo (10-page ebook, Apple silicon):

| Operation | Time | Peak memory |
|-----------|------|-------------|
| Story generation (Gemini) | 20–60 s | negligible |
| PDF compile (2 Chromium passes) | ~2–6 s | ~150–250 MB |
| Stored PDF re-download | < 1 s | negligible |

The free Render plan (512 MB) handles this, with two caveats:

1. **`PAGE_VERIFY=false` is the default in `render.yaml`.** Exact page counting
   costs one extra Chromium render per generation. Turn it on (`true`) if you
   want the displayed page count to be exact and your plan has headroom.
2. **Free services sleep after 15 minutes** of inactivity; the next request
   pays a ~50 s cold start.

Upgrade the API to **Starter ($7/mo)** if you see `exit code 137` (out of
memory) or want no cold starts. Neon's free tier stores roughly 1,500 ebook PDFs
(≈300 KB each) inside 0.5 GB.

Housekeeping (optional cron or manual SQL) to keep Neon small:

```sql
DELETE FROM ebook_pdfs WHERE created_at < now() - interval '30 days';
```

---

## Continuous deployment

`autoDeployTrigger: commit` is set for both services, so:

```
git push origin main
        │
        ├──▶ ebook-api  rebuilds (Docker layer cache ⇒ ~2 min)
        └──▶ ebook-web  rebuilds (~1–2 min)
```

**Rollback:** Render → service → **Deploys** → pick a previous successful deploy
→ **Redeploy**.

---

## Troubleshooting

### Frontend loads but shows "Failed to load templates"

- Open the API URL in a browser — if it's asleep, wait for it to wake.
- Check `ALLOWED_ORIGINS` on the API contains your exact frontend origin
  (`/api/health` echoes what the server parsed).
- Confirm the frontend was **built** with the right `NEXT_PUBLIC_API_URL`:
  view-source and search for your API host. If it's wrong → rebuild.

### `503: No Gemini API key configured`

`GEMINI_API_KEYS` is missing or empty on the API service. Set it → **Save,
rebuild, and deploy**.

### `429: All API keys exhausted`

You hit Gemini's free rate limit. Wait 60 s (keys auto-recover) or add more keys.

### `database.connected: false` in `/api/health`

- The `detail` field tells you why (auth failure, DNS, TLS).
- Verify the string starts with `postgresql://` and ends with `?sslmode=require`.
- Prefer the `-pooler` host. Confirm the Neon project isn't suspended.
- The app deliberately keeps working without a DB — you just lose the library.

### PDF download fails or the service restarts (exit 137)

Out of memory. Set `PAGE_VERIFY=false`, lower the target page count, or upgrade
the API to Starter.

### Docker build fails on `playwright install`

Almost always a transient apt/network error — **Manual Deploy → Clear build
cache & deploy**.

---

## Running it locally (same containers as production)

```bash
# 1. Backend deps + Chromium
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
playwright install chromium

# 2. Configure
cp .env.example .env          # add your Gemini keys (+ DATABASE_URL if you want the library)

# 3. Run the API
uvicorn main:app --reload --port 8000

# 4. Frontend (second terminal)
cd ..
npm install
cp .env.example .env.local    # NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev
```

Open http://localhost:3000.

Prefer to test the exact production image?

```bash
docker build -t ebook-api ./backend
docker run --rm -p 8000:8000 \
  -e GEMINI_API_KEYS=your-key \
  -e DATABASE_URL='postgresql://...neon.tech/neondb?sslmode=require' \
  -e PAGE_VERIFY=false \
  ebook-api
```

---

## Security checklist before going public

- [ ] `ALLOWED_ORIGINS` set to your frontend origin(s), not `*`.
- [ ] Gemini keys and `DATABASE_URL` only in Render env vars (never committed).
- [ ] Neon: rotate the password if it was ever pasted into a chat or ticket.
- [ ] Remember there is **no authentication** — anyone with the URL can generate
      ebooks and read the shared library. Add auth before sharing widely.
