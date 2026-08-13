import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from google import genai
from google.genai import types
from pydantic import BaseModel

from key_manager import create_key_manager, RateLimitError
from pipeline import compile_markdown_to_pdf

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


GEMINI_MODEL = "gemini-3.6-flash"


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


@app.get("/api/key-status")
async def get_key_status():
    return {"keys": key_manager.status()}


# ---------------------------------------------------------------------------
# PDF compilation (Markdown -> styled HTML -> Chromium print-to-PDF)
# ---------------------------------------------------------------------------


@app.post("/api/download-pdf")
def download_pdf(request: GenerateRequest):
    # sync `def` so FastAPI runs this in a worker thread; compile is CPU-bound
    # (Playwright) and must not block the event loop for other requests.
    if not request.content.strip():
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
