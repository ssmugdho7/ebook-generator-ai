"""Comment-based incremental editor.

Turns a user's natural-language comment on the preview ("shorten section 3",
"make the heading smaller", "add a diagram", "add a code example") into a
targeted structural edit on the book. Rule-based so it is fast, deterministic,
and testable offline (no LLM round-trip required for the common edits).
"""

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
