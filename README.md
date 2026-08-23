# AI Ebook Generator

Turn rough notes into a **story** your reader can't put down — then ship it as a
print-ready PDF. Powered by Google Gemini, with live preview, WCAG-accessible
covers, full Bengali translation, white-label business branding, and a
Neon-backed library of everything you've made.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Postgres](https://img.shields.io/badge/Neon-Postgres-00E599?logo=postgresql)
![License](https://img.shields.io/badge/License-MIT-green)

---

## The Storytelling Engine

Most AI ebooks read like a manual. This one reads like a bedtime story that
happens to teach — the way a mother explains something to her child, or a
teacher closes the textbook and says *"let me tell you what really happened."*

The generator enforces five things on every book:

1. **One simple mental model, start to finish** — the AI picks a single everyday
   world (a village bakery, a night train, a plant nursery) and explains every
   idea inside it. It never switches metaphors halfway.
2. **Named characters with wants** — "Mira the baker", "Rafi the delivery boy".
   Abstract concepts stick when someone you know is stuck in them.
3. **Fairy-tale shape** — peaceful start → a problem that hurts someone → a
   clumsy first attempt → the discovery → the twist → the calm ending → the moral.
4. **Thriller pacing** — every section opens with tension and closes on a
   cliffhanger. *"The fix worked. For about four minutes."*
5. **Comfort, never condescension** — hard parts are named out loud and walked
   through slowly; jargon is shown as a thing first, named second, then defined
   in one sentence a child could repeat.

Example of the rhythm it produces (real output, topic: *compound interest*):

> **The Old Man's Leather Pouch** — Two young cousins stood at the wooden gate of
> Willow Creek Nursery… Inside each pouch was a single shiny gold coin.
> **What this really means:** in the world of money, your starting sum is called
> the *Principal*.
> …But as Leo pushed his coin into the dirt, something unexpected happened.

Because prompts alone can drift, two guarantees are enforced in code: the book
always ends on a "moral of the story" takeaway, and every diagram/table/callout
is validated and contrast-checked before it reaches the page.

---

## Features

### AI-Powered Content Generation

- **Story-first generation** — one mental model, named characters, cliffhangers,
  plain-language definitions (see above)
- **Structured Book Generation** — Gemini returns a typed outline (paragraphs,
  subheadings, code, diagrams, callouts, lists, tables, quotes)
- **Topic-Aware Code Filtering** — detects programming vs non-programming topics
  and strips code blocks for fitness, cooking, business, and other content
- **Callouts as story moments** — *Picture this* (example), *What this really
  means* (info), *The trap* (warning), *The moral* (takeaway)
- **Multi-Key API Rotation** — thread-safe rotation across multiple Gemini keys
  with automatic cooldown for rate-limited keys
- **Never hard-fails** — malformed JSON falls back to the markdown pipeline;
  a missing key returns an actionable 503, not a stack trace

### User Accounts & Quotas

- **Email + password accounts** — register, login, and session endpoints backed
  by JWT tokens (bcrypt-style hashing, configurable secret)
- **Daily generation quota** — per-user daily ebook limit (default: 5) enforced
  server-side with friendly reset messaging
- **Ownership enforcement** — every library read/edit/delete/branding operation
  is verified against the authenticated owner; identity always comes from the
  signed JWT, never client-supplied fields

### Bengali Translation

- **One-click full-book translation** — English → বাংলা while preserving the
  entire outline structure (sections, blocks, callouts, tables)
- **Bengali typography** — Noto Sans Bengali embedded for HTML preview,
  PDF body text, and even branded PDF footers
- **AI edits in Bengali** — Book Studio actions work against the translated book
  without touching the English original

### Business Branding (White-Label Ebooks)

Turn any generated ebook into your company's own document:

- **Company logo** — upload any PNG/JPEG/WebP; sanitized, re-encoded to ≤512px
  PNG, and shown on the cover, footer band, and About page
- **Branded cover page** — dedicated title page with logo, company name,
  tagline, website, and contact line in your brand colors
- **Footers on every page** — Chromium-native header/footer templates carrying
  company info and page numbers; automatically suppressed on image covers
  (redaction preserves the artwork) and rendered in Bengali when needed
- **Brand color system** — primary/secondary hex colors re-tint covers, headings,
  accents, and diagram strokes; contrast-guarded against each template palette
- **About [Company] section** — auto-generated closing section (render-only,
  never translated or AI-edited) that appears in the table of contents with a
  real page number and bookmark
- **Persistence** — branding saved into the stored book JSONB via an
  owner-only endpoint; reopening an ebook from the library restores it
- **Live preview** — the branding modal previews the cover card using your
  book's active template palette before you commit
- **Fully optional** — off by default; existing books are byte-for-byte unchanged

### Your Library (Neon Postgres)

- **Every generation is saved** — outline JSON, title, template, page count
- **PDFs stored in the database** — Render's disk is ephemeral, Postgres is not
- **Instant re-download** — stored PDFs stream straight from Neon, no re-render
- **Reopen any ebook** — load an old book back into the live preview
- **Audit trail** — `generation_events` records duration, status, and failures
- **Owner-scoped listings** — users see their own library; anonymous use still
  works with no database
- **Fully optional** — with no `DATABASE_URL` the app still generates ebooks


### Professional Cover Design

- **8 Cover Styles** — Bold Editorial, Illustrated, Badge+Grid, Dark Glow, Dark Mono, Dark Gradient, Dark Neon, Minimal Lux
- **6 Size Presets** — Standard eBook, Amazon Kindle, Square (Social), A4 Portrait, Wide Banner, Booklet
- **Smart Topic Detection** — 21 categories with auto-matched hero illustrations and topic icons
- **Three image sources** — AI-generated hero images (Gemini image gen), Unsplash
  stock photos, or your own uploaded cover art (embedded in the PDF as page one)
- **WCAG Contrast Checking** — Real-time accessibility validation for all text/background combinations
- **Punch Word Highlighting** — Automatic keyword extraction and accent color emphasis
- **Brand Icon Integration** — 60+ tech brand icons (React, Python, Docker, etc.) + 80+ lucide line icons
- **Client-Side SVG Rendering** — All covers rendered in-browser as scalable SVG, then rasterized to PNG

### Print-Ready PDF Output

- **Two-Pass PDF Rendering** — First pass discovers pagination, second pass adds accurate page numbers
- **PDF Outline & Bookmarks** — Clickable table of contents with internal links
- **Clean headers/footers** — explicit Chromium templates (bare page number by
  default) so no browser junk (dates, URLs) ever leaks onto pages
- **Syntax Highlighting** — Pygments-based code highlighting with 25+ token types
- **Mermaid Diagrams** — Auto-rendered flowcharts, sequence diagrams, and graphs with WCAG-safe colors
- **Fallback Diagram System** — Broken mermaid blocks replaced with deterministic SVG box-and-arrow diagrams
- **Layout Safety Net** — Detects and collapses dead gaps after headings
- **A4 Page Layout** — Proper margins, headers, page numbers, and print-friendly formatting

### Design Templates

| Template | Style | Description |
|----------|-------|-------------|
| Minimal Light | Light | Clean white canvas, indigo accents, crisp sans-serif |
| Corporate Blue | Light | Trustworthy navy and steel blue, professional reports |
| Editorial Serif | Light | Magazine feel: serif headlines, forest green, generous whitespace |
| Playful Yellow | Light/Dark | Warm cream pages with sunny yellow accents, playful guides |

### Comment-Based Editor

Edit your ebook with natural language commands:

| Command | Action |
|---------|--------|
| `shorten section 3` | Trim paragraphs in section 3 |
| `make section longer` | Expand content with more detail |
| `make heading bigger` | Increase title size |
| `add a diagram` | Insert a mermaid flowchart |
| `add code example` | Insert Python code snippet (programming topics only) |
| `add a callout` | Insert a tip/warning callout box |
| `add a table` | Insert a comparison table |
| `add a list` | Insert bullet points |
| `add summary` | Insert key takeaways callout |

### Book Studio (AI Section Editing)

Select any section and use AI to improve it without regenerating the whole book:

| Action | What it does |
|--------|-------------|
| Simplify | Rewrite in plain, everyday words |
| Expand | Add detail, examples, and depth |
| Improve | Better flow, vividness, and clarity |
| Add Example | Append real-world example callouts |
| Add Code | Append a runnable code block (programming only) |
| Add Diagram | Append a mermaid diagram (programming only) |
| Regenerate | Rewrite the section fresh |
| Add Quiz | Append questions and key-point callout |
| Custom | Type any instruction (e.g. "explain for a beginner") |

Features: one-level undo, per-section targeting, Bengali support, malformed
AI response handling (original preserved on failure). When a stored ebook is
targeted, only its authenticated owner can edit it — and only that section is
sent to Gemini, so the rest of the book never leaves the database unchanged
state. Branding data is stripped before AI calls and re-attached after.

### Live Preview

- **Real-Time HTML Preview** — See your ebook rendered with full styling before downloading
- **Interactive Cover Generator** — Adjust style, accent word, tagline, and size with instant preview
- **Branding preview** — branded cover card rendered with your template's palette inside the branding modal
- **Dark/Light Mode** — Toggle between themes with persistent preference

### Testing & Quality

- **WCAG Contrast Verification** — Automated checks at every level: code tokens, body text, headings, covers, diagrams
- **Visual Regression Testing** — Playwright browser-based code legibility checks
- **PDF Quality Tests** — Automated validation of outline, links, page numbers, and content presence
- **Branding & security test matrix** — injection/sanitization suite, logo magic-byte
  validation, cross-user 401/403/ownership checks, E2E branded PDF probes across all
  templates (text cover, image cover, Bengali footers, long names)
- **Performance Monitoring** — All operations tracked with <30s target for PDF generation

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, TypeScript 5, Tailwind CSS v4 |
| Backend | FastAPI, Python 3.12 (3.9+ works locally), Uvicorn |
| Database | Neon Postgres (psycopg 3, pooled) |
| AI | Google Gemini (gemini-3.6-flash) |
| PDF | Playwright (Chromium), PyMuPDF |
| Syntax Highlighting | Pygments, react-highlight |
| Diagrams | Mermaid.js |
| Icons | simple-icons, lucide-react |
| Deployment | Render (Docker backend + Node frontend), Neon |
| Testing | Playwright, custom test suite |

---

## Project Structure

```
ebook-writer/
├── render.yaml           # Render Blueprint: both services in one file
├── .env.example          # Frontend env template
├── src/
│   ├── app/              # Next.js pages (generator + library UI)
│   ├── components/       # React UI components
│   │   ├── CoverGenerator.tsx    # Cover design modal
│   │   ├── BrandingPanel.tsx     # White-label branding modal + live preview
│   │   ├── BookEditor.tsx        # Book Studio: AI section editing
│   │   ├── AuthModal.tsx         # Sign in / create account
│   │   ├── ThemePreview.tsx      # Template theme preview cards
│   │   └── MarkdownPreview.tsx   # Markdown renderer
│   └── lib/
│       ├── api.ts        # Backend API client (+ library, auth, branding calls)
│       ├── covers.ts     # Cover generation engine
│       └── generated-icons.ts  # Auto-generated icon data
├── backend/
│   ├── Dockerfile        # Python + Chromium image used by Render
│   ├── .dockerignore     # Keeps the image lean
│   ├── .env.example      # Backend env template
│   ├── main.py           # FastAPI app, storyteller prompts, endpoints
│   ├── auth.py           # JWT issuance/verification, password hashing
│   ├── branding.py       # Branding sanitization/validation, footer builder
│   ├── db.py             # Neon persistence (library, PDFs, events, quotas)
│   ├── schema.sql        # Same schema, for manual provisioning
│   ├── book.py           # Book model + HTML rendering + page estimation
│   ├── pipeline.py       # PDF compilation pipeline (container-safe)
│   ├── editor.py         # Comment-based editor
│   ├── templates.py      # Template system
│   ├── key_manager.py    # API key rotation
│   ├── templates/        # JSON template definitions
│   ├── test_pdf_quality.py  # Quality test suite
│   └── test_image_gen.py    # AI cover image tests
├── scripts/
│   ├── gen-icons.mjs     # Icon generation script
│   └── verify-covers.mjs  # Cover verification suite
└── package.json
```

---

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/auth/register` | Create an account (email + password) |
| `POST` | `/api/auth/login` | Sign in, receive a JWT session token |
| `GET` | `/api/auth/me` | Current user from the bearer token |
| `GET` | `/api/health` | Status: keys, database, CORS, page-verify mode |
| `GET` | `/api/templates` | The four design templates |
| `POST` | `/api/generate-book` | Notes → story outline (saved to Neon, returns `ebook_id`, quota-enforced) |
| `POST` | `/api/translate-book` | Full English → Bengali translation of a book outline |
| `POST` | `/api/preview` | Outline → styled HTML for the live preview |
| `POST` | `/api/edit-section` | AI-edit a single section (simplify, expand, improve, …; owner-guarded) |
| `POST` | `/api/download-pdf` | Outline → PDF (stored against `ebook_id`; accepts branding + cover image) |
| `POST` | `/api/branding/logo` | Upload/sanitize a company logo → normalized PNG data URL (auth required) |
| `GET` | `/api/library` | Recent ebooks (owner-scoped when signed in) |
| `GET` | `/api/library/{id}` | One ebook, with its full outline (owner-guarded) |
| `POST` | `/api/library/{id}/branding` | Persist branding into the stored book; `null` payload removes it (owner-only) |
| `GET` | `/api/library/{id}/pdf` | Stored PDF, streamed from Postgres (owner-guarded) |
| `DELETE` | `/api/library/{id}` | Remove an ebook and its PDF (owner-guarded) |
| `GET` | `/api/key-status` | Gemini key rotation state |

---

## Environment Variables

```bash
# --- Backend (backend/.env — see backend/.env.example) ---
GEMINI_API_KEYS=key1,key2,key3      # comma-separated → automatic rotation
GEMINI_API_KEY=single-key           # optional fallback
DATABASE_URL=postgresql://...neon.tech/neondb?sslmode=require   # optional
JWT_SECRET=change-me                # session-token signing secret (auto-generated if unset)
ALLOWED_ORIGINS=*                   # lock to your frontend in production
PAGE_VERIFY=true                    # false = fast page estimate (low memory)
PDF_OUTPUT_DIR=/tmp/ebook-writer    # scratch dir for intermediate PDFs
ENABLE_IMAGE_GEN=true               # AI hero images for covers
UNSPLASH_ACCESS_KEY=...             # optional: Unsplash stock-photo covers

# --- Frontend (.env.local — see .env.example) ---
NEXT_PUBLIC_API_URL=http://localhost:8000   # baked in at build time
```

---

## Deployment

Render (frontend + backend) with Neon Postgres, free tier friendly:
**[DEPLOYMENT.md](./DEPLOYMENT.md)** — step-by-step, including Neon setup,
the Blueprint apply, verification commands, and troubleshooting.

```bash
# quick local run
cd backend && pip install -r requirements.txt && playwright install chromium
uvicorn main:app --reload --port 8000
# in another terminal
npm install && npm run dev
```

---

## License

MIT
