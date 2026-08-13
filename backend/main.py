import json
import os
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from google import genai
from google.genai import types
from pydantic import BaseModel

import book as bookmod
import editor as editormod
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

EBOOK_SYSTEM_PROMPT = """You are an elite ebook author who creates visually-rich, story-driven technical ebooks similar to gamma.ai. Your job is to take rough coding notes and transform them into a beautifully structured, visual-first ebook chapter.

IMPORTANT RULES:
- Write like gamma.ai: visual-first, minimal text per section, story-driven
- Break the topic into 6-10 small digestible sections
- Each section should have a clear title and 2-4 short paragraphs maximum
- Use analogies and metaphors to make concepts feel like a story
- Include code examples that build progressively (simple -> complex)
- Always include a mermaid diagram showing the architecture/flow
- Target: 4000-6000 words, but spread across many sections

FORMAT YOUR RESPONSE IN CLEAN MARKDOWN:

# [Engaging Chapter Title]

## Section 1: [Concept Name]
[1-2 short paragraphs with an analogy. Keep it punchy.]

## Section 2: [Concept Name]
[Continue the story. Build on previous section.]

## Section 3: [Concept Name]
[Code example with explanation]

... continue for 6-10 sections ...

## [Final Section]: Key Takeaways
- Bullet point summary
- Quick reference guide

Rules:
- Start directly with the heading, no filler
- Each section: max 3-4 sentences + optional code block
- Draw diagrams ONLY as ```mermaid fenced blocks with valid mermaid syntax (graph/L, flowchart/TD, sequenceDiagram). NEVER draw ASCII diagrams, art, arrows, or boxes in plain text — no ( |, +--, -->, v, or / \ shapes outside mermaid blocks.
- EVERY section that references "the diagram", "below", "flow", or "architecture" MUST immediately contain its own ```mermaid block.
- Use ```language blocks for code (e.g. ```python, ```javascript, ```sql) — always declare the language.
- NEVER put markdown tables inside code fences — write tables as native markdown tables using | and - separator rows.
- Do not use ~~strikethrough~~ or raw HTML tags.
- Make it feel like reading a story, not a textbook
- The reader should finish feeling confident they understand the topic"""


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


class CommentRequest(BaseModel):
    book: dict
    comment: str


class DownloadRequest(BaseModel):
    content: Optional[str] = None
    theme: str = "Modern Tech Blog"
    book: Optional[dict] = None
    template_id: str = "minimal-light"


GEMINI_MODEL = "gemini-3.6-flash"


BOOK_SYSTEM_PROMPT = """You are an elite ebook outliner for a gamma.ai-style visual ebook generator.
Return ONLY a single valid JSON object (no markdown fences, no commentary) matching EXACTLY this schema:

{
  "title": "string",
  "subtitle": "string",
  "sections": [
    {
      "title": "string",
      "blocks": [
        {"type": "paragraph", "text": "string"},
        {"type": "subheading", "text": "string"},
        {"type": "code", "lang": "python", "code": "string"},
        {"type": "diagram", "spec": "valid mermaid source", "caption": "string"},
        {"type": "callout", "kind": "info|tip|warn|example|takeaway", "text": "string"},
        {"type": "list", "ordered": false, "items": ["string"]},
        {"type": "table", "header": ["string"], "rows": [["string"]]},
        {"type": "quote", "text": "string"}
      ]
    }
  ]
}

RULES:
- 6-10 sections; pick the count and per-section density from the requested target page count.
- Story-driven and visual-first: minimal text per block, analogies, progressive code examples.
- Every diagram block MUST contain valid mermaid syntax: flowchart LR / flowchart TD / graph / sequenceDiagram only.
  Never use ASCII diagrams, arrows, or boxes in "text" fields.
- Code blocks build simple -> complex. Use the "lang" field for the language name.
- Vary block types (callouts, lists, tables, quotes) so pages feel designed, not dense.
- A final "Key Takeaways" section should use a callout(takeaway) and a list.
- Total content should roughly fill <<TARGET_PAGES>> printed pages (each page holds ~1 short section with a diagram)."""


def call_gemini(content: str, theme: str, max_retries: int = 3) -> str:
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
            if (
                "429" in error_msg
                or "RESOURCE_EXHAUSTED" in error_msg
                or "rate" in error_msg.lower()
                or "quota" in error_msg.lower()
            ):
                key_manager.mark_exhausted(api_key)
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
    for _ in range(3):
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
            if "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg or "quota" in error_msg.lower():
                continue
            raise
    raise RateLimitError(f"Gemini unavailable: {last_error}")


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
        "sections": [{"title": f"Section {i + 1}", "blocks": blocks}]
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


@app.post("/api/apply-comment")
def apply_comment(request: CommentRequest):
    """Apply a natural-language edit comment to the book (incremental editing)."""
    if not request.comment.strip():
        raise HTTPException(status_code=400, detail="Comment cannot be empty")
    try:
        return editormod.apply_comment(request.book, request.comment)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Edit failed: {str(e)}")


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
