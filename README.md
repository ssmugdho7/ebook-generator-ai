# AI Ebook Generator

Transform your rough notes into polished, professionally designed ebooks in minutes. Powered by Google Gemini AI with real-time preview, WCAG-accessible covers, and print-ready PDF output.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Features

### AI-Powered Content Generation

- **Structured Book Generation** — Gemini AI creates organized book outlines with typed content blocks (paragraphs, subheadings, code, diagrams, callouts, lists, tables, quotes)
- **Topic-Aware Code Filtering** — Automatically detects programming vs non-programming topics and strips code blocks for fitness, cooking, business, and other non-tech content
- **Conversational Writing Style** — AI writes like a friend explaining over coffee, not a textbook
- **Multi-Key API Rotation** — Thread-safe rotation across multiple Gemini API keys with automatic cooldown for rate-limited keys

### Professional Cover Design

- **8 Cover Styles** — Bold Editorial, Illustrated, Badge+Grid, Dark Glow, Dark Mono, Dark Gradient, Dark Neon, Minimal Lux
- **6 Size Presets** — Standard eBook, Amazon Kindle, Square (Social), A4 Portrait, Wide Banner, Booklet
- **Smart Topic Detection** — 21 categories with auto-matched hero illustrations and topic icons
- **WCAG Contrast Checking** — Real-time accessibility validation for all text/background combinations
- **Punch Word Highlighting** — Automatic keyword extraction and accent color emphasis
- **Brand Icon Integration** — 60+ tech brand icons (React, Python, Docker, etc.) + 80+ lucide line icons
- **Client-Side SVG Rendering** — All covers rendered in-browser as scalable SVG, then rasterized to PNG

### Print-Ready PDF Output

- **Two-Pass PDF Rendering** — First pass discovers pagination, second pass adds accurate page numbers
- **PDF Outline & Bookmarks** — Clickable table of contents with internal links
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

### Live Preview

- **Real-Time HTML Preview** — See your ebook rendered with full styling before downloading
- **Interactive Cover Generator** — Adjust style, accent word, tagline, and size with instant preview
- **Dark/Light Mode** — Toggle between themes with persistent preference

### Testing & Quality

- **WCAG Contrast Verification** — Automated checks at every level: code tokens, body text, headings, covers, diagrams
- **Visual Regression Testing** — Playwright browser-based code legibility checks
- **PDF Quality Tests** — Automated validation of outline, links, page numbers, and content presence
- **Performance Monitoring** — All operations tracked with <30s target for PDF generation

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, TypeScript 5, Tailwind CSS v4 |
| Backend | FastAPI, Python 3.9+, Uvicorn |
| AI | Google Gemini (gemini-3.6-flash) |
| PDF | Playwright (Chromium), PyMuPDF |
| Syntax Highlighting | Pygments, react-highlight |
| Diagrams | Mermaid.js |
| Icons | simple-icons, lucide-react |
| Testing | Playwright, custom test suite |

---

## Project Structure

```
ebook-writer/
├── src/
│   ├── app/              # Next.js pages
│   ├── components/       # React UI components
│   │   ├── CoverGenerator.tsx    # Cover design modal
│   │   ├── LoadingSpinner.tsx    # Loading states
│   │   ├── ThemeToggle.tsx       # Dark/light mode
│   │   └── MarkdownPreview.tsx   # Markdown renderer
│   └── lib/
│       ├── api.ts        # Backend API client
│       ├── covers.ts     # Cover generation engine
│       └── generated-icons.ts  # Auto-generated icon data
├── backend/
│   ├── main.py           # FastAPI server + endpoints
│   ├── book.py           # Book model + HTML rendering
│   ├── pipeline.py       # PDF compilation pipeline
│   ├── editor.py         # Comment-based editor
│   ├── templates.py      # Template system
│   ├── key_manager.py    # API key rotation
│   ├── templates/        # JSON template definitions
│   └── test_pdf_quality.py  # Quality test suite
├── scripts/
│   ├── gen-icons.mjs     # Icon generation script
│   └── verify-covers.mjs  # Cover verification suite
└── package.json
```

---

## Environment Variables

```bash
# Backend
GEMINI_API_KEYS=key1,key2,key3,key4    # Comma-separated for rotation
GEMINI_API_KEY=single-key               # Fallback (optional)

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8000  # Backend URL
```

---

## License

MIT
