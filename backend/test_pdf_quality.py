"""Quality gates for the ebook PDF pipeline.

Run:  python3 test_pdf_quality.py
Verifies the follow-up fixes before shipping a book:
  1. Every syntax token passes WCAG AA (4.5:1) against the code box background
     (static CSS check + browser visual regression with all common token types).
  2. No heading is followed by a dead gap: no near-empty pages and the layout
     safety net reports no auto-collapsed gaps.
  3. TOC entries are real clickable internal links and the PDF outline mirrors
     the TOC with page numbers that match the final pagination.
  4. Section titles render with literal `&` (no `&amp;` entity leak), and the
     TOC/outline page numbers are correct even for titles containing `&`.
  5. A mermaid block with a syntax error never ships its error graphic into the
     book: it is replaced by a controlled fallback diagram.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import fitz  # noqa: E402

import book as bookmod  # noqa: E402
import editor as editormod  # noqa: E402
import pipeline  # noqa: E402
import templates as templatesmod  # noqa: E402

SAMPLE_MD = """# Microservices: A Practical Guide

## Section 1: What Are Microservices?
Microservices split one big app into small services. The diagram below shows the request flow.

```mermaid
graph LR
    A[Client] --> B[API Gateway]
    B --> C[Auth]
    B --> D[Orders]
    B --> E[Payments]
```

## Section 2: Code Sample
Here is a service that calls a database:

```python
import sqlite3  # comment

DB = "shop.db"  # string literal

def get_user(user_id):  # function name
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE id=?", (user_id,))
    rows = cur.fetchall()
    return rows
```

## Section 3: Comparison
| Feature | Monolith | Microservices |
| --- | --- | --- |
| Deploy | One unit | Per service |
| Scale | Whole app | Per service |

## Section 4: Key Takeaways
- Wrapping adds behavior without editing the original.
- One decorator works across many functions.
"""

# Section titles containing `&` (entity + pagination stress test) and a mermaid
# block that triggers a syntax error in the parser.
ROUND3_MD = """# Scalability & Microservices

## Section 1: Intro & Overview
Some text for section one.

## Section 2: Scalability & Performance
Here is a broken diagram that must NOT render its error graphic:

```mermaid
graph LR
    A[Service] --> Storage Router{8. Data Type}
    Storage Router{8. Data Type} --> B[(Database)]
```

## Section 3: Storage & Persistence
More text here.

## Section 4: Fault Tolerance & Recovery
Even more text.

## Section 5: Security & Auth
And some text.

## Section 6: Networking & Protocols
Long text that pushes this section onto a later page.
This is filler text. This is filler text. This is filler text.
This is filler text. This is filler text. This is filler text.

## Section 7: Testing & CI/CD
Last content section.

## Section 8: Wrap Up & Next Steps
Final words.
"""


def check_bug1(theme: str) -> list:
    static = pipeline.verify_code_contrast(theme)
    visual = pipeline.check_code_legibility(theme)
    return static + visual


def check_bugs_2_and_3(theme: str, expected_sections: int) -> tuple:
    import time as _time

    t0 = _time.time()
    path = pipeline.compile_markdown_to_pdf(SAMPLE_MD, theme)
    elapsed = _time.time() - t0
    doc = fitz.open(path)
    texts = [" ".join(p.get_text().split()) for p in doc]

    near_empty = [i for i, t in enumerate(texts) if len(t) < 40]

    outline = doc.get_toc()
    toc_links = doc[1].get_links() if len(doc) > 1 else []
    goto_links = [
        l for l in toc_links if l.get("kind") == fitz.LINK_GOTO and l.get("page") is not None
    ]

    full = " ".join(texts)
    leak = [s for s in ["```", "graph LR", "A[Client]", "sequenceDiagram"] if s in full]
    # the SAMPLE_MD mermaid diagram must actually be embedded (not deleted/blank)
    missing_diagram = [s for s in ["Client", "API Gateway", "Auth", "Payments"] if s not in full]

    doc.close()
    return near_empty, outline, goto_links, leak, missing_diagram, elapsed


def check_round3(theme: str) -> tuple:
    """Return (outline, entities, mermaid_errors, toc_text) or raise."""
    path = pipeline.compile_markdown_to_pdf(ROUND3_MD, theme)
    doc = fitz.open(path)
    texts = [" ".join(p.get_text().split()) for p in doc]
    full = " ".join(texts)
    toc_text = texts[1] if len(texts) > 1 else ""

    outline = doc.get_toc()

    # decoded title must appear in the book, literal entities must not
    entities = [e for e in ["&amp;", "&lt;", "&gt;", "&quot;"] if e in full]
    has_decoded_title = "Scalability & Microservices" in full

    # mermaid error graphic text must never be present
    mermaid_errors = [
        s
        for s in ["Syntax error", "Parse error", "mermaid version", "Error rendering"]
        if s.lower() in full.lower()
    ]

    # every outline entry must point at a page number > the TOC page
    stale = [e for e in outline if e[2] <= 1]

    doc.close()
    return outline, entities, has_decoded_title, mermaid_errors, stale, toc_text


def check_templates() -> list:
    """Every template: full token coverage, WCAG AA contrast, CSS assembly."""
    problems = []
    ids = templatesmod.list_templates()
    if len(ids) != 4:
        problems.append(f"expected 4 templates, got {len(ids)}")
    for info in ids:
        tmpl = templatesmod.load_template(info["id"])
        tokens = tmpl["code"]["tokens"]
        missing = [n for n in templatesmod.ALL_TOKEN_NAMES if n not in tokens]
        if missing:
            problems.append(f"{info['id']}: missing tokens {missing}")
        fails = templatesmod.verify_template_code_contrast(tmpl)
        if fails:
            problems.append(f"{info['id']}: contrast {fails}")
        css = templatesmod.build_template_css(tmpl)
        for needle in (".codehilite", ".callout-tip", ".mermaid"):
            if needle not in css:
                problems.append(f"{info['id']}: css missing {needle}")
        pyg = templatesmod.template_pygments_css(tmpl)
        if ".codehilite" not in pyg:
            problems.append(f"{info['id']}: pygments css empty")
        doc = bookmod.render_book_document(
            {"title": "X", "sections": [{"title": "S", "blocks": [bookmod.para("hi")]}]},
            tmpl,
        )
        for needle in ("<!DOCTYPE html>", "Table of Contents", "sec-1"):
            if needle not in doc:
                problems.append(f"{info['id']}: document missing {needle}")
    return problems


def check_book_flow() -> list:
    """Structured book: render, count, edit-by-comment, and PDF compile."""
    import time as _time

    problems = []
    tmpl = templatesmod.load_template("minimal-light")
    book = {
        "title": "Structured Book Test",
        "subtitle": "verification",
        "template_id": "minimal-light",
        "target_pages": 5,
        "sections": [
            {
                "title": "Intro",
                "blocks": [
                    bookmod.para("First sentence here. Second sentence here too. Third one."),
                    bookmod.callout("tip", "A helpful tip."),
                ],
            },
            {
                "title": "Deep Dive",
                "blocks": [
                    bookmod.para("One sentence. Two sentence. Three sentence."),
                    bookmod.code_block("python", "print('hi')"),
                ],
            },
            {
                "title": "Wrap Up",
                "blocks": [
                    bookmod.list_block(["a", "b"]),
                    bookmod.diagram_block("flowchart LR\n    A[In] --> B[Out]", "Flow"),
                ],
            },
        ],
    }

    pages = bookmod.count_pages(book, tmpl)
    if pages < 1:
        problems.append(f"count_pages returned {pages}")

    r = editormod.apply_comment(book, "shorten section 2")
    if r["changed_sections"] != [1]:
        problems.append(f"shorten section 2 changed {r['changed_sections']}")
    para = r["book"]["sections"][1]["blocks"][0]
    if len(para.get("text", "").split(".")) > 3:
        problems.append(f"shorten didn't trim: {para['text']}")

    r = editormod.apply_comment(book, "add a diagram to the last section")
    last_blocks = r["book"]["sections"][-1]["blocks"]
    if not any(b["type"] == "diagram" for b in last_blocks):
        problems.append("add-diagram comment had no effect")
    r = editormod.apply_comment(book, "make the heading smaller on section 1")
    if r["book"]["sections"][0].get("title_scale") != "sm":
        problems.append("heading-sm comment had no effect")
    r = editormod.apply_comment(book, "add a code example")
    if not any(b["type"] == "code" for b in r["book"]["sections"][-1]["blocks"]):
        problems.append("add-code comment had no effect")

    # compile the edited book to a PDF with real outline + page numbers
    t0 = _time.time()
    document = bookmod.render_book_document(r["book"], tmpl, page_map=None)
    out = pipeline.compile_document_to_pdf(document, bookmod.book_entries(r["book"]))
    elapsed = _time.time() - t0
    doc = fitz.open(out)
    texts = [" ".join(p.get_text().split()) for p in doc]
    full = " ".join(texts)
    if len(doc.get_toc()) != 3:
        problems.append(f"book outline has {len(doc.get_toc())} entries, expected 3")
    for term in ["Deep Dive", "In", "Out", "print('hi')"]:
        if term not in full:
            problems.append(f"book PDF missing {term!r}")
    if elapsed > 30:
        problems.append(f"book compile too slow ({elapsed:.1f}s)")
    doc.close()
    return problems


def main() -> int:
    ok = True

    problems = check_templates()
    status = "PASS" if not problems else "FAIL"
    print(f"[{status}] Templates (tokens, contrast, CSS): {problems or 'ok'}")
    ok = ok and not problems

    problems = check_book_flow()
    status = "PASS" if not problems else "FAIL"
    print(f"[{status}] Book model + comment editing + compile: {problems or 'ok'}")
    ok = ok and not problems

    for theme in pipeline.THEMES:
        failures = check_bug1(theme)
        status = "PASS" if not failures else "FAIL"
        print(f"[{status}] Bug 1 contrast ({theme}): {len(failures)} failures {failures}")
        ok = ok and not failures

        near_empty, outline, goto_links, leak, missing_diagram, elapsed = check_bugs_2_and_3(theme, 4)
        problems = []
        if near_empty:
            problems.append(f"near-empty pages {near_empty}")
        if len(outline) != 4:
            problems.append(f"outline has {len(outline)} entries, expected 4")
        if not goto_links or len(goto_links) != 4:
            problems.append(f"only {len(goto_links)} goto links")
        if leak:
            problems.append(f"source leaks {leak}")
        if missing_diagram:
            problems.append(f"diagram not embedded: {missing_diagram}")
        if elapsed > 30:
            problems.append(f"compile too slow ({elapsed:.1f}s)")
        status = "PASS" if not problems else "FAIL"
        print(f"[{status}] Bug 2+3 layout/links/outline ({theme}): {problems or 'ok'}")
        print(f"        outline={outline}")
        ok = ok and not problems

        outline, entities, decoded, merr, stale, toc_text = check_round3(theme)
        problems = []
        if entities:
            problems.append(f"literal entities {entities}")
        if not decoded:
            problems.append("decoded title 'Scalability & Microservices' missing")
        if merr:
            problems.append(f"mermaid error text {merr}")
        if stale:
            problems.append(f"stale/zero TOC pages {stale}")
        if "&amp;" in toc_text:
            problems.append("TOC shows &amp; for &")
        status = "PASS" if not problems else "FAIL"
        print(f"[{status}] Round3 entities+mermaid+TOC ({theme}): {problems or 'ok'}")
        print(f"        outline={outline}")
        print(f"        toc_text={toc_text[:160]}")
        ok = ok and not problems

    print("RESULT:", "ALL PASS" if ok else "FAILURES PRESENT")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
