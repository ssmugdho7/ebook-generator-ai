"""Comment-based incremental editor.

Turns a user's natural-language comment on the preview ("shorten section 3",
"make the heading smaller", "add a diagram", "add a code example") into a
targeted structural edit on the book. Rule-based so it is fast, deterministic,
and testable offline (no LLM round-trip required for the common edits).
"""

import json
import re

import book as bookmod


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


def _is_code_topic(book: dict) -> bool:
    """Check if the book is about programming/coding or already contains code."""
    text = f"{book.get('title', '')} {book.get('subtitle', '')}".lower()
    if _CODE_KEYWORDS.search(text):
        return True
    # Also allow code if the book already contains code blocks
    for sec in book.get("sections", []):
        for b in sec.get("blocks", []):
            if b.get("type") == "code":
                return True
    return False


INTENT_HEADING_SM = re.compile(r"(smaller|shrink|shorter|lower)\s+(the\s+)?(heading|title)|heading.*(smaller|shrink)|smaller.*(heading|title)|make\s+(the\s+)?(heading|title)\s+(smaller|shrink|shorter)|make\s+heading\s+smaller", re.I)
INTENT_HEADING_LG = re.compile(r"(bigger|larger|big|largest|louder)\s+(the\s+)?(heading|title)|heading.*(bigger|larger)|make\s+(the\s+)?(heading|title)\s+(bigger|larger|big)|make\s+heading\s+bigger", re.I)
INTENT_DIAGRAM = re.compile(r"add.*(diagram|figure|visual|chart|mermaid)|(diagram|visual|chart).*(add|include|needs?|want)", re.I)
INTENT_REMOVE_DIAGRAM = re.compile(r"(remove|delete|drop|take out).*(diagram|figure|visual|chart)|(diagram|figure|visual|chart).*(remove|delete|drop)", re.I)
INTENT_CODE = re.compile(r"add.*(code|example|sample|snippet)|(code|example|snippet).*(add|include|needs?|want)", re.I)
INTENT_SHORTEN = re.compile(r"(shorten|make (it |this |the |section )?shorter|too long|trim|cut down|condense|tighten)", re.I)
INTENT_LENGTHEN = re.compile(r"(lengthen|expand|make (it |this |the |section )?longer|more detail|more depth|add more (content|detail))", re.I)
INTENT_CALLOUT = re.compile(r"add.*(callout|tip|note|warning|example box)", re.I)
INTENT_TABLE = re.compile(r"add.*(table|comparison|comparison table)|(table|comparison).*(add|include)", re.I)
INTENT_LIST = re.compile(r"add.*(list|bullets)|(list|bullets).*(add|include)", re.I)
INTENT_SUMMARY = re.compile(r"(add|write|include).*(summary|takeaway|key (points|ideas))", re.I)


def _target_sections(book, comment: str):
    """Return (list of matching section indexes, matcher_description)."""
    sections = bookmod.book_sections(book)
    c = comment.strip().lower()

    # explicit number: "section 3", "#3", "3rd section"
    m = re.search(r"(?:section|sec\.?)\s*#?(\d+)", c)
    if m:
        idx = int(m.group(1)) - 1
        if 0 <= idx < len(sections):
            return [idx], f"section {idx + 1}"
    m = re.search(r"#(\d+)", c)
    if m:
        idx = int(m.group(1)) - 1
        if 0 <= idx < len(sections):
            return [idx], f"section {idx + 1}"

    if "first section" in c or "first part" in c:
        return [0], "first section"
    if "last section" in c or "final section" in c or "ending" in c:
        return [len(sections) - 1], "last section"

    # title substring match
    words = [w for w in re.findall(r"[a-z]{3,}", c) if w not in {
        "the", "and", "with", "make", "add", "section", "this", "please", "for",
        "that", "too", "more", "want", "heading", "diagram", "shorter", "longer",
        "code", "example", "remove", "delete", "smaller", "bigger", "summary",
    }]
    best = None
    best_score = 0
    for i, sec in enumerate(sections):
        title_words = set(re.findall(r"[a-z]{3,}", sec["title"].lower()))
        score = sum(1 for w in words if w in title_words)
        if score > best_score:
            best, best_score = i, score
    if best is not None and best_score >= 1:
        return [best], f"section {best + 1} ({sections[best]['title']})"
    return list(range(len(sections))), "whole book"


def apply_comment(book: dict, comment: str) -> dict:
    """Return {'book': ..., 'changed_sections': [...], 'notes': [...]}."""
    book = dict(book)
    sections = [dict(s) for s in bookmod.book_sections(book)]
    book["sections"] = sections
    allow_code = _is_code_topic(book)

    targets, where = _target_sections(book, comment)
    notes = [f"Targeted {where}"]
    changed = []
    c = comment.strip()

    for idx in targets:
        sec = sections[idx]
        before_blocks = [b.get("text", b.get("code", "")) for b in sec["blocks"]]
        before_scale = sec.get("title_scale")
        did = _apply_to_section(sec, c, idx, allow_code=allow_code)
        after_blocks = [b.get("text", b.get("code", "")) for b in sec["blocks"]]
        after_scale = sec.get("title_scale")
        if did and (before_blocks != after_blocks or before_scale != after_scale):
            changed.append(idx)

    if not changed:
        notes.append("No structural edit matched; the comment may be too vague.")
    else:
        notes.append(f"Edited {len(changed)} section(s).")
    return {"book": book, "changed_sections": changed, "notes": notes}


def _apply_to_section(sec: dict, comment: str, idx: int, allow_code: bool = True) -> bool:
    did = False
    blocks = sec.get("blocks", [])

    if INTENT_HEADING_SM.search(comment):
        sec["title_scale"] = "sm"
        did = True
    elif INTENT_HEADING_LG.search(comment):
        sec["title_scale"] = "lg"
        did = True

    if INTENT_REMOVE_DIAGRAM.search(comment):
        blocks = [b for b in blocks if b["type"] != "diagram"]
        sec["blocks"] = blocks
        did = True
    elif INTENT_DIAGRAM.search(comment):
        spec = _diagram_for_section(sec, idx)
        blocks.append(bookmod.diagram_block(spec, caption="Overview"))
        sec["blocks"] = blocks
        did = True

    if INTENT_CODE.search(comment) and allow_code:
        blocks.append(_code_for_section(sec))
        sec["blocks"] = blocks
        did = True

    if INTENT_CALLOUT.search(comment):
        kind = "warn" if "warning" in comment.lower() else "tip"
        blocks.append(bookmod.callout(kind, "Key point: " + _first_sentence(sec)))
        sec["blocks"] = blocks
        did = True

    if INTENT_TABLE.search(comment):
        blocks.append(_table_for_section(sec, idx))
        sec["blocks"] = blocks
        did = True

    if INTENT_LIST.search(comment):
        blocks.append(bookmod.list_block(_bullets_for_section(sec)))
        sec["blocks"] = blocks
        did = True

    if INTENT_SUMMARY.search(comment):
        blocks.append(bookmod.callout("takeaway", _first_sentence(sec)))
        sec["blocks"] = blocks
        did = True

    if INTENT_SHORTEN.search(comment):
        for b in blocks:
            if b["type"] == "paragraph":
                bookmod._trim_paragraph(b)
        did = True
    elif INTENT_LENGTHEN.search(comment):
        new_blocks = []
        for b in blocks:
            new_blocks.append(b)
            if b["type"] == "paragraph":
                sentences = re.split(r"(?<=[.!?])\s+", b.get("text", "").strip())
                if len(sentences) > 1:
                    new_blocks.append(bookmod.para(" ".join(sentences[len(sentences) // 2:])))
        sec["blocks"] = new_blocks
        did = True

    return did


# ---------------------------------------------------------------------------
# content builders for insert-intents
# ---------------------------------------------------------------------------


def _first_sentence(sec: dict) -> str:
    for b in sec.get("blocks", []):
        if b["type"] == "paragraph":
            s = re.split(r"(?<=[.!?])\s+", b.get("text", "").strip())
            return s[0] if s else sec["title"]
    return sec["title"]


def _diagram_for_section(sec: dict, idx: int) -> str:
    title = re.sub(r"[^A-Za-z0-9 ]", "", sec["title"])
    words = re.findall(r"[A-Za-z0-9]+", title)[:3]
    nodes = words or [f"Section {idx + 1}"]
    spec = "flowchart LR\n"
    for i, node in enumerate(nodes):
        spec += f"    {node.lower()}[{node}]\n"
    for i in range(len(nodes) - 1):
        spec += f"    {nodes[i].lower()} --> {nodes[i + 1].lower()}\n"
    spec += "    result[Result] --> learn[Learn & practice]\n"
    return spec


def _code_for_section(sec: dict) -> dict:
    title = re.sub(r"\s+", "_", re.sub(r"[^A-Za-z0-9 ]", "", sec["title"])).lower()
    snippet = f"""def {title or "example"}():
    # step 1: state the goal
    goal = "Understand {sec['title']}"

    # step 2: implement the core idea
    result = run_example(goal)

    # step 3: verify and reflect
    if result:
        print("Success:", result)
    return result"""
    return bookmod.code_block("python", snippet)


def _table_for_section(sec: dict, idx: int) -> dict:
    words = re.findall(r"[A-Za-z0-9]+", sec["title"])
    a = words[0] if words else "Before"
    b = words[-1] if len(words) > 1 else "After"
    return bookmod.table_block(
        ["Aspect", "Without", "With"],
        [
            ["Speed", "Slow", "Fast"],
            ["Clarity", "Confusing", "Clear"],
            ["Result", "Errors", f"Works: {a.lower()}-to-{b.lower()}"],
        ],
    )


def _bullets_for_section(sec: dict) -> list:
    return [
        sec["title"],
        _first_sentence(sec),
        "Try the example to make it stick.",
    ]


# ---------------------------------------------------------------------------
# LLM-driven section editing (the Book Studio "AI edit" path)
# ---------------------------------------------------------------------------
#
# This is the AI companion to the deterministic `apply_comment` flow above. It
# targets ONE section only and never touches the rest of the book. The actual
# Gemini call is injected (`call_gemini`) so this module stays free of key
# management and reuses the caller's rotation/retry system.

_LANGUAGE_RULE = {
    "en": (
        "LANGUAGE: Write the ENTIRE section in English. Keep every code "
        "identifier, function name, library name, API name, URL, and string "
        "literal exactly as they are in English. Code comments MAY be in "
        "English. Everything the reader sees — title, prose, headings, "
        "callouts, lists, tables, captions, the quiz — is in English."
    ),
    "bn": (
        "LANGUAGE: Write the ENTIRE section in BENGALI (বাংলা). The title, "
        "subtitle, every paragraph, callout, list, table, caption, and quiz "
        "MUST be in Bengali script. English is ONLY allowed inside code blocks "
        "(identifiers, function names, library names, URLs, string literals) "
        "and optionally inside code comments. If you write the section in "
        "English you have failed the task."
    ),
}

# Per-action instructions appended to the system prompt.
_ACTION_GUIDANCE = {
    "edit": (
        "USER INSTRUCTION MODE: Rewrite the section to follow the user's "
        "custom instruction below. Preserve the section's core topic and title "
        "unless the instruction says otherwise. Improve clarity, flow, and "
        "accuracy while keeping the same general length."
    ),
    "simplify": (
        "SIMPLIFY: Rewrite the section using plain, everyday words a curious "
        "beginner understands. Shorten long sentences, drop jargon (or define it "
        "in one plain sentence), and keep every fact correct."
    ),
    "expand": (
        "EXPAND: Add more explanation, a second worked example or exercise, and "
        "extra detail so the section is noticeably richer — but keep it tight "
        "and on-topic. Do not pad with filler."
    ),
    "add_examples": (
        "ADD EXAMPLES: Keep the existing content and APPEND 1-2 concrete, "
        "real-world example callouts (kind 'example') that make the idea stick. "
        "Do not rewrite the original paragraphs."
    ),
    "add_code": (
        "ADD CODE: Keep the existing content and APPEND one runnable code block "
        "(type 'code') that demonstrates the section's idea. Only do this if the "
        "book is programming-related; otherwise skip the code block and instead "
        "add a concrete example callout. Explain what the code does briefly."
    ),
    "add_diagram": (
        "ADD DIAGRAM: Keep the existing content and APPEND one mermaid diagram "
        "block (type 'diagram') that clarifies a flow, structure, or sequence in "
        "the section. Use valid mermaid (flowchart LR/TD or sequenceDiagram) with "
        "short node labels."
    ),
    "improve": (
        "IMPROVE WRITING: Rewrite the section to improve flow, vividness, and "
        "clarity while preserving the exact meaning and all facts. Vary sentence "
        "length; keep the same general length."
    ),
    "regenerate": (
        "REGENERATE: Write the whole section fresh on the same topic/title, "
        "keeping the core facts but presenting them in a new, stronger way."
    ),
    "add_quiz": (
        "ADD QUIZ: Keep the existing content and APPEND a short quiz: a list "
        "block of 3-4 questions, followed by a 'takeaway' callout giving the "
        "answers or key points to check."
    ),
}


def _section_edit_system_prompt(action: str, lang: str, is_code: bool) -> str:
    guidance = _ACTION_GUIDANCE.get(action, _ACTION_GUIDANCE["improve"])
    lang_rule = _LANGUAGE_RULE.get(lang, _LANGUAGE_RULE["en"])
    code_note = (
        "Code blocks are welcome in this section."
        if is_code
        else "This is a non-programming book: do NOT include 'code' blocks; "
        "use 'example' callouts instead."
    )
    return f"""You are an expert book editor improving ONE section of a structured ebook.
{lang_rule}

TASK
{guidance}
{code_note}

OUTPUT FORMAT
Return ONLY a single valid JSON object (no markdown fence, no commentary) for the
edited section, matching this schema exactly:

{{
  "title": "string (keep the section's title unless the instruction changes it)",
  "blocks": [
    {{"type": "paragraph", "text": "string"}},
    {{"type": "subheading", "text": "string"}},
    {{"type": "code", "lang": "python", "code": "string (real, runnable code)"}},
    {{"type": "diagram", "spec": "valid mermaid source", "caption": "string"}},
    {{"type": "callout", "kind": "info|tip|warn|example|takeaway", "text": "string"}},
    {{"type": "list", "ordered": false, "items": ["string"]}},
    {{"type": "table", "header": ["string"], "rows": [["string"]]}},
    {{"type": "quote", "text": "string"}}
  ]
}}

RULES
- Use only the block types above. NEVER use an "image" block (images are generated separately).
- Every paragraph needs 2-5 sentences. Every code block must be real and runnable.
- Do not change facts from the user's notes. Do not invent false claims.
- Keep the section's identity (same title/topic) unless the action says otherwise.
- Return raw JSON only."""


def _section_edit_user_text(book, index, section, action, instruction) -> str:
    title = book.get("title", "")
    subtitle = book.get("subtitle", "")
    ctx = f"BOOK TITLE: {title}\nBOOK SUBTITLE: {subtitle}\n"
    if action == "edit" and instruction:
        ctx += f"USER INSTRUCTION: {instruction}\n"
    elif instruction:
        ctx += f"EXTRA NOTE: {instruction}\n"
    ctx += (
        f"\nEdit SECTION INDEX {index} (0-based). Current section JSON:\n"
        + json.dumps(section, ensure_ascii=False)
    )
    return ctx


def sanitize_section(section: dict, allow_code: bool, fallback_title: str = "") -> dict:
    """Validate/repair a model-returned section into the canonical shape.

    Raises ValueError if the result is not a usable section (so the caller can
    keep the original). Drops unknown block types and enforces required fields,
    mirroring `_sanitize_book` in book.py for a single section.
    """
    if not isinstance(section, dict):
        raise ValueError("AI response is not a JSON object")

    raw_title = section.get("title")
    title = (raw_title or "").strip() if isinstance(raw_title, str) else ""
    if not title:
        title = (fallback_title or "").strip() or "Section"
    title = title[:200]

    blocks_in = section.get("blocks")
    if not isinstance(blocks_in, list):
        raise ValueError("AI response 'blocks' is missing or not a list")

    out_blocks = []
    for i, b in enumerate(blocks_in):
        if not isinstance(b, dict):
            continue
        kind = b.get("type")
        if kind == "paragraph":
            if isinstance(b.get("text"), str) and b["text"].strip():
                out_blocks.append(bookmod.para(b["text"]))
        elif kind == "subheading":
            if isinstance(b.get("text"), str) and b["text"].strip():
                out_blocks.append(bookmod.subheading(b["text"]))
        elif kind == "code":
            if allow_code and isinstance(b.get("code"), str) and b["code"].strip():
                lang = b.get("lang") or "text"
                out_blocks.append(bookmod.code_block(lang, b["code"]))
        elif kind == "diagram":
            spec = b.get("spec") or ""
            if isinstance(spec, str) and spec.strip():
                out_blocks.append(bookmod.diagram_block(spec, b.get("caption", "") or ""))
        elif kind == "callout":
            kind_c = b.get("kind") if b.get("kind") in ("info", "tip", "warn", "example", "takeaway") else "info"
            if isinstance(b.get("text"), str) and b["text"].strip():
                out_blocks.append(bookmod.callout(kind_c, b["text"]))
        elif kind == "list":
            items = [str(x) for x in (b.get("items") or []) if str(x).strip()]
            if items:
                out_blocks.append(bookmod.list_block(items, bool(b.get("ordered"))))
        elif kind == "table":
            header = [str(x) for x in (b.get("header") or [])]
            rows = [[str(c) for c in r] for r in (b.get("rows") or []) if isinstance(r, list)]
            if header and rows:
                out_blocks.append(bookmod.table_block(header, rows))
        elif kind == "quote":
            if isinstance(b.get("text"), str) and b["text"].strip():
                out_blocks.append(bookmod.quote(b["text"]))
        # unknown block types are dropped (never corrupt the book)

    if not out_blocks:
        raise ValueError("AI returned a section with no usable content blocks")

    return {"title": title, "blocks": out_blocks}


def apply_section_edit(book: dict, index: int, new_section: dict) -> dict:
    """Return a new book dict with only section `index` replaced."""
    book = dict(book)
    sections = [dict(s) for s in bookmod.book_sections(book)]
    sections[index] = dict(new_section)
    book["sections"] = sections
    return book


def edit_section_via_ai(
    book: dict,
    index: int,
    action: str,
    instruction: str,
    lang: str,
    call_gemini,
) -> dict:
    """Edit ONE section with Gemini and return the updated book.

    `call_gemini(system_prompt, user_text) -> str` is injected by the caller so
    key rotation/retry is reused. Raises ValueError if the section index is out
    of range or the model returns invalid JSON (caller keeps the original).
    """
    sections = bookmod.book_sections(book)
    if not (0 <= index < len(sections)):
        raise ValueError(f"Section index {index} out of range (0..{len(sections) - 1})")

    is_code = _is_code_topic(book)
    system_prompt = _section_edit_system_prompt(action, lang, is_code)
    user_text = _section_edit_user_text(book, index, sections[index], action, instruction or "")

    raw = call_gemini(system_prompt, user_text)
    cleaned = _strip_json_fence(raw)
    try:
        parsed = json.loads(cleaned)
    except Exception:
        raise ValueError("AI response was not valid JSON")

    new_section = sanitize_section(parsed, allow_code=is_code, fallback_title=sections[index].get("title", ""))
    return apply_section_edit(book, index, new_section)


def _strip_json_fence(raw: str) -> str:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"```\s*$", "", text).strip()
    text = text.removeprefix("json").strip()
    if not text.startswith("{"):
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            text = text[start : end + 1]
    return text
