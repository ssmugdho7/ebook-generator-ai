import json
import os
import time
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from google import genai
from google.genai import types
from pydantic import BaseModel

import book as bookmod
import templates as templatesmod
from key_manager import create_key_manager, RateLimitError
from pipeline import compile_markdown_to_pdf, compile_document_to_pdf

load_dotenv()

app = FastAPI(title="AI Ebook Generator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

key_manager = create_key_manager()

EBOOK_SYSTEM_PROMPT = """You are a talented writer creating a technical ebook that people actually WANT to read. Think of yourself as that friend who explains stuff over coffee — casual, clear, and genuinely excited about the topic. You're turning someone's rough notes into something that feels effortless to read.

Your voice:
- Write like you talk. Use "you" and "I" and "we". Skip the jargon soup.
- Be honest when something is tricky. Say "this part trips people up" instead of "this is a complex concept requiring careful consideration."
- Use real-world analogies. Compare APIs to restaurants, databases to filing cabinets, threads to cooks in a kitchen.
- Drop in personality. "Here's where it gets fun" or "Okay, this is the part that blew my mind."
- Keep paragraphs short — 2-3 sentences max. Nobody reads walls of text.
- When you show code, explain WHAT it does and WHY it matters, not just what each line does.

Structure (6-10 sections):
# [A title that makes you curious, not bored]

## [Section title — keep it conversational]
[2-3 sentences. Hook the reader. Why should they care?]

## [Next section]
[Build on the last one. Like a conversation.]

## [Code section]
[Show code, then explain it like you're pair-programming]

... keep going until you've covered everything ...

## Key Takeaways
[The "if you remember nothing else" list — 3-5 bullets]

Hard rules:
- Start with the heading directly. No "In this chapter we will discuss..."
- Each section: 2-4 sentences + optional code or diagram
- Draw diagrams as ```mermaid fenced blocks (flowchart LR/TD, graph LR/TD, sequenceDiagram). NEVER use ASCII art or text boxes.
- Every section mentioning flow, architecture, or process MUST have a mermaid diagram
- Use ```language blocks for code (```python, ```javascript, etc)
- Tables go in native markdown, not code fences
- No ~~strikethrough~~ or raw HTML
- Target: 4000-6000 words spread across many short sections
- The reader should finish and think "that was actually enjoyable to read""""


class GenerateRequest(BaseModel):
    content: str
    theme: str


class GenerateResponse(BaseModel):
    markdown: str
    complete: bool


class BookRequest(BaseModel):
    content: str
    template_id: str = "minimal-light"
    target_pages: int = 12


class PreviewRequest(BaseModel):
    book: dict
    template_id: str = "minimal-light"


class DownloadRequest(BaseModel):
    content: Optional[str] = None
    theme: str = "Modern Tech Blog"
    book: Optional[dict] = None
    template_id: str = "minimal-light"


GEMINI_MODEL = "gemini-3.6-flash"


BOOK_SYSTEM_PROMPT = """You are a book outliner who writes like a human, not a machine. You're creating the skeleton of a visually-rich ebook that reads like a great conversation. Return ONLY a single valid JSON object matching this schema:

{
  "title": "string (make it catchy — not 'Chapter 1: Introduction')",
  "subtitle": "string (one line that hooks the reader)",
  "sections": [
    {
      "title": "string (conversational, not academic)",
      "blocks": [
        {"type": "paragraph", "text": "string (2-3 sentences, write like you talk)"},
        {"type": "subheading", "text": "string"},
        {"type": "code", "lang": "python", "code": "string"},
        {"type": "diagram", "spec": "valid mermaid source with colors and labels", "caption": "string"},
        {"type": "callout", "kind": "info|tip|warn|example|takeaway", "text": "string"},
        {"type": "list", "ordered": false, "items": ["string"]},
        {"type": "table", "header": ["string"], "rows": [["string"]]},
        {"type": "quote", "text": "string"}
      ]
    }
  ]
}

YOUR VOICE:
- Write like you're explaining to a friend, not writing a textbook.
- Use "you", "we", "let's". Avoid "one should", "it is important to note".
- Be opinionated. "This is the approach I'd pick" is better than "there are various approaches."
- Analogies are your best tool. Every abstract concept gets a real-world comparison.
- Short paragraphs. 2-3 sentences. Break things up.
- When something is hard, say so. "Fair warning — this part takes practice."

DIAGRAM RULES (critical — these must look GOOD):
- Every diagram block MUST use valid mermaid syntax: flowchart LR, flowchart TD, graph LR, graph TD, or sequenceDiagram
- Use COLORS to show meaning. Example with styled nodes:
  flowchart LR
    A["User Request"]:::input --> B["API Gateway"]:::process
    B --> C{"Valid?"}:::decision
    C -->|Yes| D["Database"]:::storage
    C -->|No| E["Error Response"]:::error
    classDef input fill:#dbeafe,stroke:#2563eb,color:#1e3a5f
    classDef process fill:#d1fae5,stroke:#059669,color:#064e3b
    classDef decision fill:#fef3c7,stroke:#d97706,color:#78350f
    classDef storage fill:#ede9fe,stroke:#7c3aed,color:#3b0764
    classDef error fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
- For sequence diagrams, use participant aliases and colored notes
- Labels should be SHORT (2-4 words). Nobody reads paragraph-length node labels.
- Always include a caption that explains what the diagram shows

OTHER RULES:
- 6-10 sections; adjust density for the target page count
- Vary block types — don't just do paragraphs. Mix in callouts, lists, tables, quotes.
- Code builds from simple to complex
- End with a "Key Takeaways" section using callout(takeaway) + list
- Total content should fill roughly <<TARGET_PAGES>> pages"""


def call_gemini(content: str, theme: str, max_retries: int = 5) -> str:
    last_error = None
    tried_keys = set()

    for attempt in range(max_retries):
        try:
            api_key = key_manager.get_key()
            if api_key in tried_keys and len(key_manager._keys) > 1:
                api_key = key_manager.get_key()
            tried_keys.add(api_key)

            client = genai.Client(api_key=api_key)
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=[
                    types.Content(
                        role="user",
                        parts=[
                            types.Part.from_text(
                                text=f"Theme: {theme}\n\nContent:\n{content}"
                            )
                        ],
                    )
                ],
                config=types.GenerateContentConfig(
                    system_instruction=EBOOK_SYSTEM_PROMPT,
                    temperature=0.7,
                ),
            )
            return response.text or ""

        except Exception as e:
            error_msg = str(e)
            last_error = e
            if _is_retryable(error_msg):
                key_manager.mark_exhausted(api_key)
                wait = min(2 ** attempt, 10)
                print(f"RETRY {attempt+1}/{max_retries} after {wait}s: {error_msg[:120]}")
                time.sleep(wait)
                continue
            raise

    raise RateLimitError(
        f"All API keys exhausted after {max_retries} attempts. "
        f"Last error: {last_error}"
    )


@app.post("/api/generate", response_model=GenerateResponse)
async def generate_ebook(request: GenerateRequest):
    if not request.content.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")

    try:
        markdown_text = call_gemini(request.content, request.theme)
        return GenerateResponse(markdown=markdown_text, complete=True)
    except RateLimitError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini API error: {str(e)}")


@app.post("/api/generate-ebook", response_model=GenerateResponse)
async def generate_ebook_v2(request: GenerateRequest):
    return await generate_ebook(request)


def _call_gemini_parts(system_prompt: str, user_text: str, temperature: float = 0.7) -> str:
    last_error = None
    for attempt in range(5):
        try:
            api_key = key_manager.get_key()
            client = genai.Client(api_key=api_key)
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=[types.Part.from_text(text=user_text)],
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=temperature,
                ),
            )
            return response.text or ""
        except Exception as e:
            error_msg = str(e)
            last_error = e
            if _is_retryable(error_msg):
                wait = min(2 ** attempt, 10)
                print(f"RETRY(book) {attempt+1}/5 after {wait}s: {error_msg[:120]}")
                time.sleep(wait)
                continue
            raise
    raise RateLimitError(f"Gemini unavailable after 5 retries: {last_error}")


def generate_book_structure(content: str, template_id: str, target_pages: int) -> dict:
    """Gemini produces a structured book; if JSON parsing fails, fall back to
    the markdown generator + block parser so generation never hard-fails."""
    user_text = (
        f"Template: {template_id}\nTarget pages: {target_pages}\n\nContent:\n{content}"
    )
    raw = _call_gemini_parts(
        BOOK_SYSTEM_PROMPT.replace("<<TARGET_PAGES>>", str(target_pages)), user_text
    )
    cleaned = raw.strip().strip("`")
    cleaned = cleaned.removeprefix("json").strip()
    try:
        parsed = json.loads(cleaned)
    except Exception:
        parsed = None
    if isinstance(parsed, dict) and isinstance(parsed.get("sections"), list):
        return _sanitize_book(parsed, template_id, target_pages)
    # fallback: legacy markdown -> structured blocks
    markdown = call_gemini(content, template_id, max_retries=3)
    blocks, title = bookmod.markdown_to_blocks(markdown)
    return {
        "title": title or "Ebook",
        "subtitle": f"A visual, story-driven learning guide ({template_id})",
        "template_id": template_id,
        "target_pages": target_pages,
        "sections": [{"title": title or "Ebook", "blocks": blocks}]
        if blocks
        else [],
    }


def _sanitize_book(book: dict, template_id: str, target_pages: int) -> dict:
    """Validate/repair a Gemini-returned book into the canonical shape."""
    sections = []
    for i, sec in enumerate(book.get("sections", []), start=1):
        blocks = []
        for b in sec.get("blocks", []):
            kind = b.get("type")
            if kind == "paragraph":
                if b.get("text"):
                    blocks.append(bookmod.para(b["text"]))
            elif kind == "subheading":
                if b.get("text"):
                    blocks.append(bookmod.subheading(b["text"]))
            elif kind == "code":
                blocks.append(bookmod.code_block(b.get("lang", "text"), b.get("code", "")))
            elif kind == "diagram":
                spec = b.get("spec", "")
                if "mermaid" in spec.lower():
                    spec = spec.split("\n", 1)[-1]
                blocks.append(bookmod.diagram_block(spec, b.get("caption", "")))
            elif kind == "callout":
                kind = b.get("kind") if b.get("kind") in ("info", "tip", "warn", "example", "takeaway") else "info"
                blocks.append(bookmod.callout(kind, b.get("text", "")))
            elif kind == "list":
                blocks.append(bookmod.list_block(b.get("items", []), bool(b.get("ordered"))))
            elif kind == "table":
                blocks.append(bookmod.table_block(b.get("header", []), b.get("rows", [])))
            elif kind == "quote":
                if b.get("text"):
                    blocks.append(bookmod.quote(b["text"]))
        sections.append({"title": sec.get("title") or f"Section {i}", "blocks": blocks})
    return {
        "title": book.get("title") or "Ebook",
        "subtitle": book.get("subtitle") or "A visual, story-driven learning guide",
        "template_id": template_id,
        "target_pages": target_pages,
        "sections": sections,
    }


def _load_template(request_template_id: str) -> dict:
    try:
        return templatesmod.load_template(request_template_id)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unknown template: {request_template_id}")


@app.get("/api/key-status")
async def get_key_status():
    return {"keys": key_manager.status()}


# ---------------------------------------------------------------------------
# Template + structured-book flow
# ---------------------------------------------------------------------------


@app.get("/api/templates")
async def list_templates():
    try:
        return {"templates": templatesmod.list_templates()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Template load failed: {str(e)}")


@app.post("/api/generate-book")
def generate_book(request: BookRequest):
    """Generate a structured book outline and verify/adjust real page count."""
    if not request.content.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")
    template = _load_template(request.template_id)
    try:
        book = generate_book_structure(request.content, request.template_id, request.target_pages)
        book = bookmod.adjust_to_page_target(book, template, request.target_pages)
        pages = bookmod.count_pages(book, template)
        return {
            "book": book,
            "page_count": pages,
            "target_pages": request.target_pages,
            "template_id": request.template_id,
        }
    except RateLimitError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Book generation failed: {str(e)}")


@app.post("/api/preview")
def preview_book(request: PreviewRequest):
    """Render the structured book to styled HTML for the in-app preview."""
    try:
        template = _load_template(request.template_id)
        html = bookmod.render_book_preview_html(request.book, template)
        return {"html": html, "template_id": request.template_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Preview failed: {str(e)}")


# ---------------------------------------------------------------------------
# PDF compilation (Markdown -> styled HTML -> Chromium print-to-PDF)
# ---------------------------------------------------------------------------


@app.post("/api/download-pdf")
def download_pdf(request: DownloadRequest):
    # sync `def` so FastAPI runs this in a worker thread; compile is CPU-bound
    # (Playwright) and must not block the event loop for other requests.
    if request.book:
        try:
            template = _load_template(request.template_id)
            entries = bookmod.book_entries(request.book)
            document = bookmod.render_book_document(request.book, template, page_map=None)
            pdf_path = compile_document_to_pdf(document, entries)
            return FileResponse(
                pdf_path,
                media_type="application/pdf",
                filename="ebook.pdf",
                headers={"Content-Disposition": 'attachment; filename="ebook.pdf"'},
            )
        except HTTPException:
            raise
        except Exception as e:
            import traceback

            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")

    if not request.content or not request.content.strip():
        raise HTTPException(status_code=400, detail="No content to convert to PDF")

    try:
        pdf_path = compile_markdown_to_pdf(request.content, request.theme)
        return FileResponse(
            pdf_path,
            media_type="application/pdf",
            filename="ebook.pdf",
            headers={"Content-Disposition": 'attachment; filename="ebook.pdf"'},
        )
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")


@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "model": GEMINI_MODEL,
        "keys_available": len(key_manager._keys),
        "key_status": key_manager.status(),
    }


@app.get("/api/models")
async def list_models():
    try:
        api_key = key_manager.get_key()
        client = genai.Client(api_key=api_key)
        models = []
        for m in client.models.list():
            name = m.name.replace("models/", "")
            if any(k in name for k in ["flash", "pro"]):
                models.append(name)
        return {"models": models}
    except Exception as e:
        return {"models": [], "error": str(e)}
