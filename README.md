# AI Ebook Generator

Transform rough coding concepts and messy code snippets into publication-ready ebooks using AI.

## Features

- **Rich Input Area** — Paste coding concepts, code snippets, and rough notes
- **Theme Selection** — Choose from Academic Textbook, Modern Tech Blog, or Dark Mode Minimalist
- **Streaming Generation** — Watch your ebook build in real-time with animated loading states
- **Mermaid Diagrams** — Automatically renders flowcharts and diagrams from AI-generated mermaid syntax
- **PDF Download** — Export your finished ebook as a styled PDF
- **Markdown Preview** — Beautiful rendered preview with syntax-highlighted code blocks

## Tech Stack

| Layer    | Technology                       |
| -------- | -------------------------------- |
| Frontend | Next.js, React, TypeScript, Tailwind CSS |
| Backend  | Python, FastAPI, OpenAI API      |
| Diagrams | Mermaid.js                       |
| PDF      | WeasyPrint (Python)              |

## Getting Started

### 1. Backend Setup

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env and add your OpenAI API key
uvicorn main:app --reload --port 8000
```

### 2. Frontend Setup

```bash
npm install
npm run dev
```

### 3. Open

Visit [http://localhost:3000](http://localhost:3000)

## Quick Start Scripts

```bash
# Terminal 1 — Backend
./start-backend.sh

# Terminal 2 — Frontend
./start-frontend.sh
```

## Environment Variables

| Variable              | Description                  |
| --------------------- | ---------------------------- |
| `OPENAI_API_KEY`      | Your OpenAI API key          |
| `NEXT_PUBLIC_API_URL` | Backend URL (default: `http://localhost:8000`) |

## Project Structure

```
ebook-writer/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout
│   │   ├── page.tsx            # Main page
│   │   └── globals.css         # Global styles
│   ├── components/
│   │   ├── MarkdownPreview.tsx  # Markdown renderer with mermaid
│   │   ├── MermaidDiagram.tsx   # Mermaid chart component
│   │   └── LoadingSpinner.tsx   # Animated spinner
│   └── lib/
│       └── api.ts              # API client functions
├── backend/
│   ├── main.py                 # FastAPI server
│   ├── requirements.txt        # Python dependencies
│   └── .env.example            # Env template
├── start-backend.sh
├── start-frontend.sh
└── README.md
```
