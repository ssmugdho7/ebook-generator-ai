import json
import os
import re
import time
import traceback
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from google import genai
from google.genai import types
from pydantic import BaseModel

import book as bookmod
import db
import templates as templatesmod
from key_manager import create_key_manager, RateLimitError
from pipeline import compile_markdown_to_pdf, compile_document_to_pdf

load_dotenv()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Verify the Neon schema once at boot. A missing/unreachable database is
    logged, never fatal — the app still generates ebooks, just without a
    library."""
    db.init_schema()
    yield


app = FastAPI(title="AI Ebook Generator API", lifespan=lifespan)


def _allowed_origins() -> list:
    """CORS origins from env. Default `*` keeps local dev and previews easy;
    set ALLOWED_ORIGINS on Render to lock the API to your frontend URL(s).

    Accepts bare hostnames too, because Render's `fromService: property: host`
    hands over `ebook-web.onrender.com` without a scheme — we turn that into
    `https://ebook-web.onrender.com` (and `http://` for localhost).

    Example: ALLOWED_ORIGINS=https://ebook-web.onrender.com,https://myebooks.com
    """
    raw = os.environ.get("ALLOWED_ORIGINS", "*").strip()
    if not raw or raw == "*":
        return ["*"]
    origins = []
    for chunk in raw.split(","):
        origin = chunk.strip().rstrip("/")
        if not origin:
            continue
        if not origin.startswith(("http://", "https://")):
            local = origin.startswith(("localhost", "127.0.0.1", "0.0.0.0"))
            origin = ("http://" if local else "https://") + origin
        origins.append(origin)
    return origins or ["*"]


_origins = _allowed_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    # credentials cannot be combined with the "*" wildcard per the CORS spec
    allow_credentials=_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

key_manager = create_key_manager()


# ---------------------------------------------------------------------------
# Image Generation (Google Imagen)
# ---------------------------------------------------------------------------

# Model name for image generation (using Gemini's image output)
IMAGEN_MODEL = "gemini-2.5-flash-image"

# Whether image generation is enabled (set ENABLE_IMAGE_GEN=true to enable)
# Disabled by default to avoid hitting quota limits
ENABLE_IMAGE_GEN = os.environ.get("ENABLE_IMAGE_GEN", "false").lower() == "true"

# Unsplash API for free stock photos (get key at https://unsplash.com/developers)
UNSPLASH_ACCESS_KEY = os.environ.get("UNSPLASH_ACCESS_KEY", "")

# Common English stop-words to strip when building Unsplash search queries.
_STOP_WORDS = {
    "a", "an", "the", "with", "in", "on", "at", "for", "of", "and", "or", "but",
    "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do",
    "does", "did", "will", "would", "could", "should", "may", "might", "shall",
    "can", "to", "from", "by", "about", "into", "through", "during", "before",
    "after", "above", "below", "between", "out", "off", "over", "under", "again",
    "further", "then", "once", "here", "there", "when", "where", "why", "how",
    "all", "each", "every", "both", "few", "more", "most", "other", "some", "such",
    "no", "not", "only", "own", "same", "so", "than", "too", "very", "just",
    "because", "but", "and", "if", "or", "as", "until", "while", "which", "this",
    "that", "these", "those", "its", "it", "he", "she", "they", "them", "his",
    "her", "their", "my", "your", "our", "also", "back", "even", "still", "way",
    "take", "make", "get", "go", "come", "think", "know", "see", "look", "want",
    "give", "use", "find", "tell", "ask", "work", "seem", "feel", "try", "leave",
    "call", "said", "good", "new", "first", "last", "long", "great", "little",
    "right", "big", "high", "different", "small", "large", "next", "early",
    "young", "important", "public", "bad", "able", "having", "each", "like",
    "don", "now", "d", "ll", "m", "o", "re", "ve", "y", "ain", "aren", "couldn",
    "didn", "doesn", "hadn", "hasn", "haven", "isn", "ma", "mightn", "mustn",
    "needn", "shan", "shouldn", "wasn", "weren", "won", "wouldn",
}


def _extract_search_keywords(text: str, max_terms: int = 4) -> str:
    """Extract 2-4 short keyword terms from a longer description for search."""
    words = re.findall(r"[a-zA-Z]{3,}", text)
    keywords = [w for w in words if w.lower() not in _STOP_WORDS]
    if len(keywords) < 2 and words:
        keywords = words[:max_terms]
    return " ".join(keywords[:max_terms]) if keywords else text.split(",")[0].strip()[:50]


def generate_image(prompt: str, retries: int = 3) -> str:
    """Fetch a stock photo from Unsplash based on the prompt.

    Uses 2-4 extracted keyword terms for the search query (much better hit
    rate than full-sentence descriptions). Retries with broader queries on
    zero results, detects 429 rate-limit responses, and logs every failure
    with status code, headers, query, and response body.
    """
    import base64
    import requests

    if not UNSPLASH_ACCESS_KEY:
        raise Exception("Unsplash API key not set. Set UNSPLASH_ACCESS_KEY in backend/.env")

    primary_query = _extract_search_keywords(prompt, max_terms=4)
    words = primary_query.split()
    queries: list[str] = [primary_query]
    if len(words) > 1:
        queries.append(" ".join(words[:3]))
    if len(words) > 2:
        queries.append(" ".join(words[:2]))
    if len(words) > 3:
        queries.append(words[0])
    queries.extend(["story illustration", "concept art", "abstract photography"])

    last_error = None
    for qi, query in enumerate(queries):
        for attempt in range(max(1, retries)):
            try:
                print(f"UNSPLASH_SEARCH: query={query!r} attempt={attempt + 1}/{retries}")
                response = requests.get(
                    "https://api.unsplash.com/search/photos",
                    params={
                        "query": query,
                        "per_page": 5,
                        "orientation": "landscape",
                        "client_id": UNSPLASH_ACCESS_KEY,
                    },
                    timeout=10,
                )

                remaining = response.headers.get("X-Ratelimit-Remaining")
                reset_at = response.headers.get("X-Ratelimit-Reset", "unknown")
                if remaining is not None:
                    print(f"UNSPLASH_RATELIMIT: remaining={remaining} reset={reset_at}")

                if response.status_code == 429:
                    wait = min(2 ** (attempt + 2), 60)
                    print(
                        f"UNSPLASH_RATE_LIMITED: query={query!r} "
                        f"reset={reset_at} waiting {wait}s"
                    )
                    time.sleep(wait)
                    continue

                if response.status_code != 200:
                    print(
                        f"UNSPLASH_HTTP_ERROR: status={response.status_code} "
                        f"query={query!r} body={response.text[:300]!r}"
                    )
                    raise Exception(f"Unsplash API error: {response.status_code}")

                data = response.json()
                results = data.get("results", [])

                if not results:
                    print(f"UNSPLASH_NO_RESULTS: query={query!r} total={data.get('total', 0)}")
                    raise Exception(f"No images found for: {query}")

                import random

                image_url = random.choice(results)["urls"]["regular"]

                img_response = requests.get(image_url, timeout=15)
                if img_response.status_code != 200:
                    print(
                        f"UNSPLASH_IMAGE_ERROR: status={img_response.status_code} "
                        f"url={image_url[:80]!r}"
                    )
                    raise Exception("Failed to download image")

                img_bytes = img_response.content
                print(f"UNSPLASH_SUCCESS: query={query!r} bytes={len(img_bytes)}")
                return base64.b64encode(img_bytes).decode("utf-8")

            except Exception as e:
                last_error = e
                error_msg = str(e).lower()
                if "rate" in error_msg or "429" in error_msg:
                    continue
                if attempt < retries - 1:
                    time.sleep(1)
                    continue
                print(f"UNSPLASH_FAILED: query={query!r} error={str(e)[:200]}")

    raise Exception(f"Image fetch failed after trying {len(queries)} queries: {last_error}")


def _require_keys() -> None:
    """Fail fast with an actionable message instead of an opaque 500 when the
    deployment is missing its Gemini credentials."""
    if not key_manager._keys:
        raise HTTPException(
            status_code=503,
            detail=(
                "No Gemini API key configured. Set GEMINI_API_KEYS (comma-separated) "
                "or GEMINI_API_KEY in the service environment, then redeploy. "
                "Get keys at https://aistudio.google.com/apikey"
            ),
        )



# ---------------------------------------------------------------------------
# Topic detection — skip code blocks for non-programming topics
# ---------------------------------------------------------------------------

_CODE_KEYWORDS = re.compile(
    r"\b(programming|coding|code|developer|engineer|software|script|api|database|"
    r"python|javascript|typescript|java\b|c\+\+|ruby|golang|rust|swift|kotlin|"
    r"html|css|react|angular|vue|node|django|flask|fastapi|spring|rails|"
    r"algorithm|function|variable|class\b|method|loop|array|object|json|yaml|"
    r"git|docker|kubernetes|aws|azure|gcp|linux|terminal|command.?line|cli|"
    r"debug|compile|runtime|frontend|backend|fullstack|devops|testing|ci/?cd|"
    r"machine.?learning|data.?science|neural|model|train|predict|deploy|"
    r"framework|library|package|module|dependency|npm|pip|maven|gradle)",
    re.IGNORECASE,
)

_NON_CODE_KEYWORDS = re.compile(
    r"\b(cooking|recipe|bake|fry|roast|grill|sauté|simmer|seasoning|ingredient|"
    r"meal|dish|cuisine|kitchen|chef|food|eat|nutrition|diet|fitness|"
    r"yoga|meditation|mindfulness|mental.?health|self.?care|wellness|"
    r"relationship|dating|marriage|communication|parenting|family|"
    r"finance|budget|invest|saving|retire|debt|stock|crypto|"
    r"marketing|seo|social.?media|brand|sales|startup|business|entrepreneur|"
    r"write|writing|novel|poetry|grammar|language|spanish|french|english|"
    r"history|philosophy|psychology|science|biology|chemistry|physics|"
    r"garden|plant|grow|soil|harvest|compost|flower|tree|"
    r"travel|adventure|explore|hiking|camping|backpack|"
    r"art|paint|draw|sketch|design|photograph|music|guitar|piano|sing|"
    r"diy|craft|woodwork|sew|knit|crochet|"
    r"cookbook|self-help|guide|how.?to|beginner|intermediate|advanced|"
    r"ironclad|muscle|fat|weight|gym|workout|exercise|cardio|strength|"
    r"protein|calorie|supplement|testosterone|hormone|sleep|energy|stamina)",
    re.IGNORECASE,
)


def is_code_related(content: str) -> bool:
    """Return True if the user content is primarily about programming/coding."""
    text = content.lower()
    code_hits = len(_CODE_KEYWORDS.findall(text))
    non_code_hits = len(_NON_CODE_KEYWORDS.findall(text))
    # If topic explicitly mentions non-code subjects, treat as non-code
    if non_code_hits > code_hits:
        return False
    # If no code keywords found at all, treat as non-code
    if code_hits == 0:
        return False
    return True

# ---------------------------------------------------------------------------
# The storyteller voice — shared by every generation path
# ---------------------------------------------------------------------------
#
# Both the markdown flow and the structured-book flow use this block, so the
# ebook always reads the same way: a bedtime story that happens to teach.
# It is deliberately prescriptive, because "write casually" is too vague for a
# model — the rules below force a single mental model, fairy-tale beats, and
# thriller pacing.

# Languages the ebook can be written in. "en" keeps the current behaviour;
# "bn" writes the story in Bengali (code + identifiers stay English).
LANG_NAMES = {
    "en": "English",
    "bn": "Bengali",
}

# A short, unmissable instruction injected at the very top of the system prompt
# so the model cannot default to English. Keyed by language code.
LANGUAGE_RULE = {
    "en": (
        "LANGUAGE: Write the ENTIRE book in English. "
        "Translate every word, phrase, and sentence from the user's notes "
        "into proper English. Do NOT transliterate non-English words into "
        "English script (for example: do NOT write 'raita' or 'rasoi' if the "
        "user's notes mention Hindi words — use the actual English equivalents "
        "like 'yogurt sauce' or 'kitchen'). English is the ONLY language "
        "allowed in the final output, except for code identifiers, library "
        "names, API names, URLs, and string literals inside code blocks."
    ),
    "bn": (
        "LANGUAGE: Write the ENTIRE book in BENGALI (বাংলা). This is the single "
        "most important rule: the title, subtitle, every section heading, every "
        "paragraph, every callout, every table, every caption, and the moral "
        "MUST be in Bengali script. English is ONLY allowed inside code blocks "
        "(identifiers, function names, library names, URLs, string literals) and "
        "optionally inside code comments. If you write the story in English you "
        "have failed the task. Start the title with a Bengali character."
    ),
}


def _language_rule(lang: str) -> str:
    return LANGUAGE_RULE.get(lang, LANGUAGE_RULE["en"])


STORY_VOICE = """YOU ARE A STORYTELLER FIRST, A TEACHER SECOND.

<<LANGUAGE_RULE>>

Imagine a mother sitting on the edge of a bed, telling her child a story. Or a
favourite teacher who closes the textbook and says: "Forget the definitions.
Let me tell you what really happened." That is exactly how this whole book must
sound. The reader should feel safe, curious, and unable to stop reading.

1. ONE SIMPLE MENTAL MODEL FOR THE WHOLE BOOK
- Before writing anything, pick ONE tiny everyday world that mirrors the topic:
  a village bakery, a school lunch queue, a post office, a garden, a night
  train, a small shop, a kitchen, a football team, a family of ants.
- Introduce that world in the very first paragraph and NEVER swap it later.
  Every idea in every section must be explained inside that same world.
- Give it 2-3 named characters with wants (Mira the baker, Rafi the delivery
  boy, Grandma who checks every loaf). Characters make abstract things stick.
- Keep the model absurdly simple. If a 10-year-old could not picture it in one
  breath, choose something simpler.

 2. OPENING AND TITLE STYLE
 - Start with a clear, interesting title that sounds like a real book, not a
   fairy tale. Examples: "The Bakery With One Oven", "Why Bridges Don't Fall",
   "The Secret Life of Bread". Avoid "Once upon a time", "magic", "fairy",
   "wizard", "spell", "curse", "enchanted", or any fantasy framing.
 - Open with a relatable scene that makes the reader nod: "In every kitchen,
   there is one tool everyone takes for granted..." Avoid fairy-tale openings
   like "In a small town where nobody could wait, there was a bakery..."
 - Keep the story shape: a calm start -> a real problem -> a first try that
   fails -> the discovery -> a twist -> the confident ending. This is narrative
   structure, not fairy-tale magic.
 - Use conversational transitions: "And then...", "But here is the part most
   people miss...", "Nobody expected what happened next." These are rhythm
   words, not fairy-tale words.

3. THRILLER PACING (this is what stops the book being boring)
- Every section OPENS with tension: a question, a small disaster, a ticking
  clock, a mystery. Stakes first, explanation second.
- Every section CLOSES with a cliffhanger line that pulls the reader forward:
  "The fix worked. For about four minutes." / "And that is when Rafi noticed
  the second door." Never end a section on a flat summary.
- Plant small secrets early and pay them off later. Reveal, do not lecture.
- Short sentences. Then shorter. That is the heartbeat of suspense.

4. COMFORT (the reader must never feel stupid)
- Say the hard part out loud, kindly: "This next bit sounds scary. It is not.
  Stay with me — I will walk you through it slowly."
- Give the reader tiny wins: "See? You already understand the hardest part."
- Never shame, never assume prior knowledge, never dump jargon.

5. HOW TO HANDLE HARD WORDS AND FACTS
- Show the thing in the story FIRST, name it SECOND:
  "Mira writes the order on a slip and clips it to the wire. That slip is what
  engineers call a request."
- After naming a term, define it in one plain sentence a child could repeat.
- Everything factual from the user's notes MUST still be there and correct. The
  story is the wrapper, never an excuse to lose accuracy or detail.
- No jargon soup, no corporate voice, no "it is important to note", no
  "in this chapter we will discuss", no "delve", no "leverage", no "moreover".

 6. SENTENCE AND PARAGRAPH RULES
 - Everyday words only. Roughly a 6th-grade reading level.
 - Most sentences under 15 words. Paragraphs of 2-3 sentences, never more.
 - Speak directly to the reader as "you". Use "we" when walking side by side.
 - Concrete nouns and numbers beat abstractions: "three loaves", not "several
   units of output".

 7. LANGUAGE
 - Write the whole book in <<LANGUAGE>>.
 - Keep code identifiers, function names, library names, API names, URLs, and
   string literals exactly as they are in English — never translate them.
 - Code comments (the human notes inside a code block) MAY be written in
   <<LANGUAGE>> when it helps the reader; the code itself stays English.
 - Everything else — story, explanations, headings, tables, captions, the
   moral — is in <<LANGUAGE>>."""


EBOOK_SYSTEM_PROMPT = (
    STORY_VOICE
    + """

YOUR TASK
Turn the user's rough notes into a story-shaped ebook in Markdown. Same facts,
same depth — told as one continuous tale inside your chosen everyday world.

SHAPE (6-10 sections)
# [A title that sounds like a story, not a manual]

## [Section 1 — the calm world and the trouble that arrives]
[Open the story. Introduce the world and one character. End with a hook.]

## [Section 2..N — one idea per section, each a scene in the same story]
[Tension -> the scene -> the plain-language explanation -> tiny example ->
cliffhanger into the next section.]

## [Code scenes] (ONLY for programming/coding topics)
[Show the code as "the note Mira pinned to the wall", then explain what it does
and why it saves the day. Never a line-by-line robot walkthrough.]

## The Moral of the Story
[3-5 bullets: the "if you remember nothing else" list, in story words.]

HARD RULES
- Start with the heading directly. No preamble about the chapter.
- Each section: 2-5 short paragraphs, plus an optional diagram or code block.
- Diagrams go in ```mermaid fenced blocks (flowchart LR/TD, graph LR/TD,
  sequenceDiagram). NEVER ASCII art or text boxes.
- Any section about a flow, a journey, an order of events, or how pieces fit
  together MUST include a mermaid diagram. Label nodes with story words
  ("Order slip", "One oven", "Waiting queue"), 2-4 words each.
- Programming/coding topics: use ```language code fences (```python, etc).
- Non-programming topics (business, health, cooking, self-help, fitness,
  relationships, finance, study): NO code blocks at all.
- Tables in native markdown. No raw HTML, no ~~strikethrough~~.
- Target 4000-6000 words across many short scenes.
- Final test before you answer: would a tired reader keep turning pages, and
  could they retell the whole idea as a story tomorrow? If not, rewrite."""
)


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
    # "en" only, "bn" only, or "both" (returns an extra book_bn).
    language: str = "en"


class PreviewRequest(BaseModel):
    book: dict
    template_id: str = "minimal-light"


class TranslateRequest(BaseModel):
    book: dict
    template_id: str = "minimal-light"
    target_pages: int = 12
    language: str = "bn"


class DownloadRequest(BaseModel):
    content: Optional[str] = None
    theme: str = "Modern Tech Blog"
    book: Optional[dict] = None
    template_id: str = "minimal-light"
    # when present, the compiled PDF is stored against this library row
    ebook_id: Optional[str] = None
    # "en" or "bn" — selects which book payload to render (only for `book`)
    language: str = "en"


GEMINI_MODEL = "gemini-3.6-flash"

TRANSLATE_SYSTEM_PROMPT = """You are a careful translator for a story-style ebook.

Translate the given structured book from English into {lang}. Keep the EXACT
same JSON structure (same keys, same number of sections and blocks).

RULES
- Keep ALL code identifiers, function names, library names, API names, URLs,
  and string literals in English — never translate them.
- Code comments (the human notes inside a code block) MAY be written in {lang}
  when it helps the reader; the code itself stays English.
- Translate everything else: title, subtitle, all prose, headings, callouts,
  list items, table text, captions, quotes, the moral, and image prompts.
- Preserve the story voice and the thriller pacing.
- Do NOT change facts, numbers, or the meaning.
- Keep mermaid diagram source EXACTLY as-is (node ids, labels may be translated
  only if they are plain words, never the syntax).
- Image blocks MUST be kept (type "image", prompt, caption). Translate the
  prompt and caption into {lang} so the generated illustrations match the
  translated text.
- Return ONLY the translated JSON object, no markdown fence, no commentary."""


BOOK_SYSTEM_PROMPT = (
    STORY_VOICE
    + """

YOUR TASK
Build the skeleton of a visually rich, story-shaped ebook. Return ONLY a single
valid JSON object matching this schema (no markdown fence, no commentary):

  {
    "title": "string (clear, normal, and interesting — like a real book title, not a fairy tale)",
    "subtitle": "string (one line that tells the reader what this is about, not a lecture)",
  "sections": [
    {
      "title": "string (a scene name, curious and short)",
      "blocks": [
        {"type": "paragraph", "text": "string (2-3 short story sentences)"},
        {"type": "subheading", "text": "string"},
        {"type": "code", "lang": "python", "code": "string"},
        {"type": "diagram", "spec": "valid mermaid source with colors and labels", "caption": "string"},
        {"type": "image", "prompt": "detailed image description for AI generation", "caption": "string"},
        {"type": "callout", "kind": "info|tip|warn|example|takeaway", "text": "string"},
        {"type": "list", "ordered": false, "items": ["string"]},
        {"type": "table", "header": ["string"], "rows": [["string"]]},
        {"type": "quote", "text": "string"}
      ]
    }
  ]
}

VISUAL ELEMENTS RULES
- PROGRAMMING/CODING TOPICS: Use {"type": "diagram", "spec": "mermaid source"} for flowcharts, architecture diagrams, and code-related visuals.
- NON-PROGRAMMING TOPICS (cooking, fitness, travel, self-help, business, health, relationships, finance, study, art, music): Use {"type": "image", "prompt": "detailed description", "caption": "optional caption"} for illustrations.
- Image prompts should be: vivid, specific, cinematic. Example: "A cozy kitchen with warm morning light, fresh bread cooling on a wooden counter, steam rising from a pot of soup, vintage copper pans hanging on the wall"
- MAX 1-2 images per entire book (not per section). Place them at key story moments:
  * First section: opening scene (the world before trouble)
  * Middle section: the discovery or turning point
- Each image prompt must be UNIQUE - describe different scenes, angles, or moments
- For programming topics: use mermaid diagrams, not images
- For non-programming topics: use images instead of diagrams

STORY ARC ACROSS SECTIONS (6-10 sections)
1. "Once upon a normal day" — the little world, one character, and the trouble
   that walks in. End on a hook.
2-3. The clumsy first attempts. Show what breaks and who it hurts.
4-6. The discovery: the real idea, explained inside the same world, step by
   step, from simple to complete.
7-8. The twist — the mistake almost everyone makes — and how our character
   escapes it.
9. The calm ending: the world works now, and the reader knows why.
Last section: "The Moral of the Story" — a callout(takeaway) plus a list.

RHYTHM INSIDE EVERY SECTION (follow this order)
- paragraph: the tension. A question, a small disaster, a ticking clock.
- paragraph: the story beat — what a character does, in the everyday world.
- paragraph: the plain-language meaning, naming the real term at the end.
- optional callout / diagram / code / table / list: the proof or picture.
- paragraph: a one-line cliffhanger that makes the next section irresistible.

CALLOUTS ARE STORY MOMENTS, USE THEM OFTEN (2-4 per section is good)
- "example" -> "Picture this:" a tiny concrete scene with names and numbers.
- "info"    -> "What this really means:" the plain definition of a term.
- "tip"     -> the little secret that makes it easy.
- "warn"    -> "The trap:" the mistake that bites people, told as a near-miss.
- "takeaway"-> "The moral:" one sentence a reader can repeat from memory.

DIAGRAM RULES (critical — these must look GOOD)
- Every diagram MUST be valid mermaid: flowchart LR, flowchart TD, graph LR,
  graph TD, or sequenceDiagram.
- Label nodes with STORY words, 2-4 words max ("Order slip", "One oven",
  "Angry queue"). Never paragraph-length labels. Never jargon-only labels.
- Use colors to carry meaning, e.g.:
  flowchart LR
    A["Customer waits"]:::input --> B["Order slip"]:::process
    B --> C{"Oven free?"}:::decision
    C -->|Yes| D["Fresh bread"]:::storage
    C -->|No| E["Angry queue"]:::error
    classDef input fill:#dbeafe,stroke:#2563eb,color:#1e3a5f
    classDef process fill:#d1fae5,stroke:#059669,color:#064e3b
    classDef decision fill:#fef3c7,stroke:#d97706,color:#78350f
    classDef storage fill:#ede9fe,stroke:#7c3aed,color:#3b0764
    classDef error fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
- Sequence diagrams: use participant aliases and colored notes.
- Every diagram needs a caption that tells the reader what to notice.

CODE RULES (only for programming/coding topics)
- ONLY include code blocks when the topic is programming, coding, software, or
  technical implementation.
- For non-programming topics (business, health, cooking, self-help, fitness,
  relationships, finance, study) include NO code blocks at all.
- When code appears, the paragraph before it must tell the story reason for it,
  and the paragraph after it must say what changed in the story because of it.
- Build from the simplest possible version to the real one.

OTHER RULES
- 6-10 sections; adjust density for the target page count.
- Vary block types. Never five paragraphs in a row.
- Keep every fact from the user's notes. The story wraps the facts; it never
  replaces them.
- Total content should fill roughly <<TARGET_PAGES>> pages.
- Return raw JSON only."""
)


def _is_retryable(error_msg: str) -> bool:
    """Check if a Gemini API error is retryable (rate limits, quota, server overload)."""
    msg = error_msg.lower()
    return any(
        token in msg
        for token in [
            "429", "503",
            "resource_exhausted", "unavailable",
            "rate", "quota", "overloaded",
            "timeout", "connection",
        ]
    )


def _is_quota_error(error_msg: str) -> bool:
    """A daily/account quota exhaust (RESOURCE_EXHAUSTED / quota), as opposed to a
    transient per-minute rate limit. These won't clear by retrying the same model,
    so we fall back to the next model instead."""
    msg = error_msg.lower()
    return "resource_exhausted" in msg or "quota" in msg


_QUOTA_MESSAGE = (
    "You've hit Gemini's free-tier daily limit (20 requests/day per model). "
    "This is a Google quota, not a bug — generation will work again after the "
    "daily reset (≈24h from your first request today). To continue now, add a "
    "paid Gemini key, or set GEMINI_MODEL_FALLBACKS to another model you have "
    "quota on. Your other settings are saved."
)


def _quota_error() -> HTTPException:
    return HTTPException(status_code=429, detail=_QUOTA_MESSAGE)


# Ordered model list: the primary model first, then any fallbacks from
# GEMINI_MODEL_FALLBACKS. When the primary is out of quota, the next model is
# tried automatically. Set GEMINI_MODEL_FALLBACKS="gemini-2.5-flash,..." to enable.
_PRIMARY_MODEL = GEMINI_MODEL
_FALLBACK_MODELS = [
    m.strip()
    for m in os.environ.get("GEMINI_MODEL_FALLBACKS", "").split(",")
    if m.strip()
]
MODELS: list[str] = [_PRIMARY_MODEL, *_FALLBACK_MODELS]

# Models marked quota-exhausted for this process are skipped until restarted.
_model_exhausted: set[str] = set()


def _try_models(run, max_retries: int = 5):
    """Try `run(model)` across the model chain. On a quota error for a model,
    mark it exhausted and move to the next model. Re-raises RateLimitError if
    every model+key attempt fails."""
    last_error = None
    for model in MODELS:
        if model in _model_exhausted:
            continue
        for attempt in range(max_retries):
            try:
                return run(model)
            except Exception as e:
                error_msg = str(e)
                last_error = e
                if _is_quota_error(error_msg):
                    # This model's quota is done for now — fall back, don't spin.
                    print(f"MODEL_QUOTA_EXHAUSTED: {model} — trying next model")
                    _model_exhausted.add(model)
                    break
                if _is_retryable(error_msg):
                    wait = min(2 ** attempt, 10)
                    print(f"RETRY {attempt+1}/{max_retries} after {wait}s: {error_msg[:120]}")
                    time.sleep(wait)
                    continue
                raise
    # Everything failed. If every model was a quota error, say so clearly.
    if last_error is None:
        raise RateLimitError("No Gemini models available.")
    raise RateLimitError(
        f"All Gemini models/keys exhausted after retries. "
        f"Last error: {last_error}"
    )


def call_gemini(content: str, theme: str, max_retries: int = 5) -> str:
    def _run(model: str) -> str:
        tried_keys = set()
        for _ in range(max_retries):
            api_key = key_manager.get_key()
            if api_key in tried_keys and len(key_manager._keys) > 1:
                api_key = key_manager.get_key()
            tried_keys.add(api_key)
            client = genai.Client(api_key=api_key)
            response = client.models.generate_content(
                model=model,
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
        raise RateLimitError("No API key available for this model.")

    return _try_models(_run, max_retries)


@app.post("/api/generate", response_model=GenerateResponse)
async def generate_ebook(request: GenerateRequest):
    if not request.content.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")
    _require_keys()

    try:
        markdown_text = call_gemini(request.content, request.theme)
        return GenerateResponse(markdown=markdown_text, complete=True)
    except RateLimitError as e:
        if _is_quota_error(str(e)):
            raise _quota_error()
        raise HTTPException(status_code=429, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini API error: {str(e)}")


@app.post("/api/generate-ebook", response_model=GenerateResponse)
async def generate_ebook_v2(request: GenerateRequest):
    return await generate_ebook(request)


def _call_gemini_parts(system_prompt: str, user_text: str, temperature: float = 0.7) -> str:
    def _run(model: str) -> str:
        api_key = key_manager.get_key()
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=model,
            contents=[types.Part.from_text(text=user_text)],
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=temperature,
            ),
        )
        return response.text or ""

    return _try_models(_run, max_retries=5)


def generate_book_structure(
    content: str, template_id: str, target_pages: int, lang: str = "en"
) -> dict:
    """Gemini produces a structured book; if JSON parsing fails, fall back to
    the markdown generator + block parser so generation never hard-fails."""
    lang_name = LANG_NAMES.get(lang, "English")
    system_prompt = (
        BOOK_SYSTEM_PROMPT.replace("<<TARGET_PAGES>>", str(target_pages))
        .replace("<<LANGUAGE>>", lang_name)
        .replace("<<LANGUAGE_RULE>>", _language_rule(lang))
    )
    user_text = (
        f"Template: {template_id}\nTarget pages: {target_pages}\n"
        f"WRITE THE ENTIRE BOOK IN {lang_name.upper()}. "
        f"Translate every concept, example, and explanation into {lang_name}. "
        f"Do NOT copy non-English words from these notes into the output — "
        f"everything the reader sees must be in {lang_name} (except code identifiers, "
        f"library names, API names, URLs, and string literals inside code blocks).\n\n"
        "Tell this as one continuous story, inside a single everyday world, with "
        "named characters, a cliffhanger at the end of every section, and every "
        "hard word explained in plain language right after it appears.\n\n"
        f"Notes to turn into the story:\n{content}"
    )
    raw = _call_gemini_parts(system_prompt, user_text, temperature=0.5)
    cleaned = _strip_json_fence(raw)
    try:
        parsed = json.loads(cleaned)
    except Exception:
        parsed = None
    if isinstance(parsed, dict) and isinstance(parsed.get("sections"), list):
        book = _sanitize_book(parsed, template_id, target_pages, content)
        # Generate images for non-programming topics
        if not is_code_related(content):
            book = _generate_images_for_book(book)
        return book
    # fallback: legacy markdown -> structured blocks
    markdown = call_gemini(content, template_id, max_retries=3)
    blocks, title = bookmod.markdown_to_blocks(markdown)
    # Filter code blocks for non-programming topics
    if not is_code_related(content):
        blocks = [b for b in blocks if b.get("type") != "code"]
    book = {
        "title": title or "Ebook",
        "subtitle": STORY_SUBTITLE,
        "template_id": template_id,
        "target_pages": target_pages,
        "sections": [{"title": title or "Ebook", "blocks": blocks}],
        "language": lang,
    }
    if not is_code_related(content):
        book = _generate_images_for_book(book)
    return book


def translate_book_structure(book: dict, lang: str, template_id: str = "", target_pages: int = 12) -> dict:
    """Translate a structured English book into another language (e.g. Bengali)
    while keeping the exact block structure. Code and identifiers stay English;
    prose, titles, and code comments may be translated."""
    if lang not in LANG_NAMES or lang == "en":
        return book
    lang_name = LANG_NAMES[lang]
    payload = json.dumps(book, ensure_ascii=False)
    user_text = (
        f"Target language: {lang_name}\n\n"
        "Translate this structured book:\n"
        f"{payload}"
    )
    system_prompt = TRANSLATE_SYSTEM_PROMPT.format(lang=lang_name)
    raw = _call_gemini_parts(system_prompt, user_text, temperature=0.4)
    cleaned = _strip_json_fence(raw)
    try:
        translated = json.loads(cleaned)
    except Exception:
        traceback.print_exc()
        return book
    if not (isinstance(translated, dict) and isinstance(translated.get("sections"), list)):
        return book
    translated.setdefault("template_id", book.get("template_id", template_id))
    translated.setdefault("target_pages", book.get("target_pages", target_pages))
    translated.setdefault("title", book.get("title", "Ebook"))
    translated.setdefault("subtitle", book.get("subtitle", ""))
    needs_images = any(
        block.get("type") == "image" and not block.get("image_data")
        for sec in translated.get("sections", [])
        for block in sec.get("blocks", [])
    )
    if needs_images:
        translated = _generate_images_for_book(translated)
    return translated


# Used whenever the model forgets a subtitle: still promises a story, never
# reads like a course catalogue.
STORY_SUBTITLE = "A story you can finish in one sitting — and still remember tomorrow"


def _strip_json_fence(raw: str) -> str:
    """Pull the JSON object out of a model reply that may be fenced or chatty."""
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"```\s*$", "", text).strip()
    text = text.removeprefix("json").strip()
    if not text.startswith("{"):
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            text = text[start : end + 1]
    return text



def _sanitize_book(book: dict, template_id: str, target_pages: int, content: str = "") -> dict:
    """Validate/repair a Gemini-returned book into the canonical shape.
    Strips code blocks if the topic is not programming-related."""
    sections = []
    allow_code = is_code_related(content) if content else True
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
                if allow_code:
                    blocks.append(bookmod.code_block(b.get("lang", "text"), b.get("code", "")))
            elif kind == "diagram":
                spec = b.get("spec", "")
                if "mermaid" in spec.lower():
                    spec = spec.split("\n", 1)[-1]
                blocks.append(bookmod.diagram_block(spec, b.get("caption", "")))
            elif kind == "image":
                prompt = b.get("prompt", "")
                caption = b.get("caption", "")
                if prompt:
                    blocks.append(bookmod.image_block(prompt, caption))
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
    sections = _ensure_story_ending(sections)
    return {
        "title": book.get("title") or "Ebook",
        "subtitle": book.get("subtitle") or STORY_SUBTITLE,
        "template_id": template_id,
        "target_pages": target_pages,
        "sections": sections,
    }


def _generate_images_for_book(book: dict) -> dict:
    """Generate images for selected image blocks in the book.

    Limits to max 2 images per book (1 for books under 10 pages).
    Each image gets a unique, detailed prompt for better variety.
    Returns book unchanged if image generation is disabled or fails.
    """
    if not ENABLE_IMAGE_GEN:
        print("IMAGE_GEN_DISABLED")
        return book
    if not UNSPLASH_ACCESS_KEY:
        print("UNSPLASH_KEY_MISSING: Set UNSPLASH_ACCESS_KEY in backend/.env to enable stock photos")
        return book

    target_pages = book.get("target_pages", 10)
    max_images = 1 if target_pages < 10 else 2

    all_image_blocks = []
    for sec in book.get("sections", []):
        for block in sec.get("blocks", []):
            if block.get("type") == "image" and not block.get("image_data"):
                all_image_blocks.append(block)

    print(
        f"IMAGE_GEN: sections={len(book.get('sections', []))}, "
        f"image_blocks={len(all_image_blocks)}, max_images={max_images}"
    )

    if not all_image_blocks:
        return book

    selected_blocks = _select_best_image_blocks(all_image_blocks, max_images, book)
    print(f"IMAGE_GEN: selected {len(selected_blocks)} blocks for generation")

    for block in selected_blocks:
        prompt = block.get("prompt", "")
        if not prompt:
            continue
        try:
            enhanced_prompt = _enhance_image_prompt(prompt, len(all_image_blocks))
            print(f"FETCHING_IMAGE: {enhanced_prompt[:80]}...")
            image_data = generate_image(enhanced_prompt)
            block["image_data"] = image_data
            print(f"IMAGE_FETCHED: success for '{prompt[:50]}...' len={len(image_data)}")
        except Exception as e:
            error_msg = str(e)[:200]
            print(f"IMAGE_FETCH_FAILED: {error_msg}")
            # Leave block without image_data - it will be skipped cleanly

    return book


def _select_best_image_blocks(blocks: list, max_count: int, book: dict) -> list:
    """Select the best image blocks to generate, prioritizing variety."""
    if len(blocks) <= max_count:
        return blocks
    
    # Group blocks by section index for variety
    section_map = {}
    for block in blocks:
        # Find which section this block belongs to
        for i, sec in enumerate(book.get("sections", [])):
            if block in sec.get("blocks", []):
                section_map.setdefault(i, []).append(block)
                break
    
    selected = []
    # Pick one from each section, spreading evenly
    section_indices = sorted(section_map.keys())
    for idx in section_indices:
        if len(selected) >= max_count:
            break
        # Pick the first block from this section
        if section_map[idx]:
            selected.append(section_map[idx][0])
    
    # If we still need more, add from any section
    if len(selected) < max_count:
        for block in blocks:
            if block not in selected:
                selected.append(block)
                if len(selected) >= max_count:
                    break
    
    return selected[:max_count]


def _enhance_image_prompt(prompt: str, total_images: int) -> str:
    """Enhance the prompt with style variations to ensure diverse images."""
    # Add specific style modifiers based on position for variety
    styles = [
        "cinematic lighting, detailed illustration style",
        "warm watercolor painting style, soft colors",
        "vibrant digital art, modern illustration",
        "cozy atmospheric photography style, natural light",
    ]
    # Use hash of prompt to pick a consistent but varied style
    style_idx = hash(prompt) % len(styles)
    style = styles[style_idx % min(len(styles), total_images)]
    
    return f"{prompt}, {style}, high quality, detailed"


def _ensure_story_ending(sections: list) -> list:
    """Deterministic story guarantee: a story must land on a moral.

    The prompt asks for a closing takeaway, but models forget. Rather than
    trusting the prompt alone, we check the last section and, if it has no
    takeaway callout, we promote its own closing sentence into one. Nothing is
    invented — we reuse the book's own words.
    """
    if not sections:
        return sections
    has_takeaway = any(
        b.get("type") == "callout" and b.get("kind") == "takeaway"
        for sec in sections
        for b in sec.get("blocks", [])
    )
    if has_takeaway:
        return sections

    last = sections[-1]
    closing = ""
    for block in reversed(last.get("blocks", [])):
        if block.get("type") == "paragraph" and block.get("text"):
            sentences = [s for s in re.split(r"(?<=[.!?])\s+", block["text"].strip()) if s]
            closing = sentences[-1] if sentences else ""
            break
    if not closing:
        closing = (
            f"Remember the story of {last.get('title', 'this chapter')} — that picture "
            "is the whole idea."
        )
    last.setdefault("blocks", []).append(
        bookmod.callout("takeaway", f"The moral of the story: {closing}")
    )
    return sections



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
    """Generate a structured book outline and verify/adjust real page count.

    The finished outline is saved to Neon (when configured) so the reader can
    come back to it later — Render's disk does not survive a redeploy.
    """
    if not request.content.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")
    _require_keys()
    # "both" = English primary + a Bengali translation; "bn" = Bengali only;
    # anything else (including "en") = English only.
    language = request.language if request.language in ("en", "bn", "both") else "en"
    template = _load_template(request.template_id)
    started = time.time()
    try:
        primary_lang = "bn" if language == "bn" else "en"
        book = generate_book_structure(
            request.content, request.template_id, request.target_pages, lang=primary_lang
        )
        # Page-count verification is intentionally skipped here to keep
        # generation fast. The download render will produce the final PDF
        # in a single pass; the TOC will show blank page numbers rather
        # than burning an extra ~10-20s per render during generation.
        pages = bookmod.estimate_pages(book)
        book_bn = None
        if language == "both":
            book_bn = translate_book_structure(
                book, "bn", request.template_id, request.target_pages
            )
        ebook_id = db.save_ebook(
            book=book,
            template_id=request.template_id,
            target_pages=request.target_pages,
            page_count=pages,
            source_content=request.content,
            book_bn=book_bn,
        )
        db.log_event(
            "generate-book",
            "ok",
            ebook_id=ebook_id,
            duration_ms=int((time.time() - started) * 1000),
            detail=f"{len(book.get('sections', []))} sections / {pages} pages",
        )
        return {
            "book": book,
            "book_bn": book_bn,
            "page_count": pages,
            "target_pages": request.target_pages,
            "template_id": request.template_id,
            "language": language,
            "ebook_id": ebook_id,
        }

    except RateLimitError as e:
        db.log_event("generate-book", "rate_limited", detail=str(e))
        if _is_quota_error(str(e)):
            raise _quota_error()
        raise HTTPException(status_code=429, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        import traceback

        traceback.print_exc()
        db.log_event("generate-book", "error", detail=str(e))
        raise HTTPException(status_code=500, detail=f"Book generation failed: {str(e)}")



@app.post("/api/translate-book")
def translate_book(request: TranslateRequest):
    """Translate an already-generated structured book into another language
    (currently Bengali). Returns the translated book with the same structure."""
    if not request.book:
        raise HTTPException(status_code=400, detail="No book provided")
    _require_keys()
    if request.language not in ("bn", "both"):
        raise HTTPException(status_code=400, detail="Only translation into Bengali is supported")
    try:
        translated = translate_book_structure(
            request.book, request.language, request.template_id, request.target_pages
        )
        return {
            "book": translated,
            "language": request.language,
            "template_id": request.template_id,
        }
    except RateLimitError as e:
        if _is_quota_error(str(e)):
            raise _quota_error()
        raise HTTPException(status_code=429, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Translation failed: {str(e)}")


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
        started = time.time()
        # For a Bengali PDF, prefer the already-translated book when present.
        book_payload = request.book
        if request.language == "bn" and isinstance(request.book.get("book_bn"), dict):
            book_payload = request.book["book_bn"]
        try:
            template = _load_template(request.template_id)
            entries = bookmod.book_entries(book_payload)
            document = bookmod.render_book_document(book_payload, template, page_map=None)
            pdf_path = compile_document_to_pdf(document, entries, template=template)
            # Cleanup temp image files
            bookmod.cleanup_tmp_images(book_payload)
            db.log_event(
                "download-pdf",
                "ok",
                ebook_id=request.ebook_id,
                duration_ms=int((time.time() - started) * 1000),
            )
            return _pdf_response(
                pdf_path,
                filename=_pdf_filename(book_payload.get("title")),
                ebook_id=request.ebook_id,
            )
        except HTTPException:
            raise
        except Exception as e:
            # Cleanup on error too
            bookmod.cleanup_tmp_images(book_payload)
            import traceback

            traceback.print_exc()
            db.log_event("download-pdf", "error", ebook_id=request.ebook_id, detail=str(e))
            raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")

    if not request.content or not request.content.strip():
        raise HTTPException(status_code=400, detail="No content to convert to PDF")

    try:
        pdf_path = compile_markdown_to_pdf(request.content, request.theme)
        return _pdf_response(pdf_path, filename="ebook.pdf", ebook_id=request.ebook_id)
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")


def _pdf_filename(title: Optional[str]) -> str:
    """`The Bakery With One Oven` -> `the-bakery-with-one-oven.pdf`."""
    slug = re.sub(r"[^a-z0-9]+", "-", (title or "ebook").lower()).strip("-")
    return f"{slug[:60] or 'ebook'}.pdf"


def _pdf_response(pdf_path: str, filename: str, ebook_id: Optional[str]) -> Response:
    """Stream the compiled PDF from memory, persist it to Neon, and delete the
    temp file.

    Reading the bytes (instead of `FileResponse`) matters on Render: the
    container filesystem is ephemeral and read-only-ish per deploy, so the only
    durable copy is the one in Postgres.
    """
    with open(pdf_path, "rb") as fh:
        data = fh.read()
    try:
        os.remove(pdf_path)
    except OSError:
        pass
    if ebook_id:
        db.store_pdf(ebook_id, data)
    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(data)),
        },
    )


# ---------------------------------------------------------------------------
# Library (Neon-backed history)
# ---------------------------------------------------------------------------


@app.get("/api/library")
def library(limit: int = 12):
    """Recent ebooks. Returns an empty list (never an error) when no database is
    configured, so the UI degrades gracefully."""
    return {
        "items": db.list_ebooks(limit),
        "database": db.is_configured(),
    }


@app.get("/api/library/{ebook_id}")
def library_item(ebook_id: str):
    entry = db.get_ebook(ebook_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Ebook not found")
    return entry


@app.get("/api/library/{ebook_id}/pdf")
def library_pdf(ebook_id: str):
    """Serve the stored PDF — no Gemini call, no Chromium render, instant."""
    entry = db.get_ebook(ebook_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Ebook not found")
    data = db.get_pdf(ebook_id)
    if not data:
        raise HTTPException(
            status_code=404,
            detail="No PDF stored for this ebook yet — open it and download once.",
        )
    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{_pdf_filename(entry.get("title"))}"',
            "Content-Length": str(len(data)),
        },
    )


@app.delete("/api/library/{ebook_id}")
def library_delete(ebook_id: str):
    if not db.delete_ebook(ebook_id):
        raise HTTPException(status_code=404, detail="Ebook not found")
    return {"deleted": ebook_id}


@app.get("/api/health")
async def health_check():
    """Deployment probe: Render pings this, and it tells you at a glance whether
    keys and the database are wired up."""
    return {
        "status": "ok",
        "model": GEMINI_MODEL,
        "keys_available": len(key_manager._keys),
        "key_status": key_manager.status(),
        "database": db.health(),
        "page_verification": os.environ.get("PAGE_VERIFY", "true"),
        "allowed_origins": _origins,
    }


@app.get("/")
async def root():
    return {
        "service": "AI Ebook Generator API",
        "docs": "/docs",
        "health": "/api/health",
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
