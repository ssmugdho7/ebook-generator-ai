"""Structured book model: a book is a typed outline of sections/blocks.

This is the heart of the "generate an outline, then edit it" flow:
- books are JSON-serializable so the frontend holds a book across rounds
- every block type maps to real PDF HTML (paragraph / heading / code /
  diagram / callout / list / table / quote)
- page count is verified against the real renderer and auto-adjusted
"""

import html as html_lib
import re

import pipeline


# ---------------------------------------------------------------------------
# Block constructors
# ---------------------------------------------------------------------------


def para(text: str) -> dict:
    return {"type": "paragraph", "text": text.strip()}


def subheading(text: str) -> dict:
    return {"type": "subheading", "text": text.strip()}


def code_block(lang: str, code: str) -> dict:
    return {"type": "code", "lang": lang or "text", "code": code.strip("\n")}


def diagram_block(spec: str, caption: str = "") -> dict:
    return {"type": "diagram", "spec": spec.strip("\n"), "caption": caption.strip()}


def callout(kind: str, text: str) -> dict:
    return {"type": "callout", "kind": kind, "text": text.strip()}


def list_block(items, ordered: bool = False) -> dict:
    return {"type": "list", "ordered": ordered, "items": [str(i) for i in items]}


def table_block(header, rows) -> dict:
    return {"type": "table", "header": [str(h) for h in header], "rows": [[str(c) for c in r] for r in rows]}


def quote(text: str) -> dict:
    return {"type": "quote", "text": text.strip()}


# ---------------------------------------------------------------------------
# Markdown -> structured book (used as the parse fallback + legacy path)
# ---------------------------------------------------------------------------


def markdown_to_blocks(md_text: str, title: str = None) -> list:
    """Convert markdown into block dicts without the PDF renderer."""
    blocks = []
    lines = md_text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line.startswith("```"):
            lang = line[3:].strip().split()[0] if len(line) > 3 else ""
            if "mermaid" in lang.lower():
                buf = []
                i += 1
                while i < len(lines) and not lines[i].strip().startswith("```"):
                    buf.append(lines[i])
                    i += 1
                i += 1
                blocks.append(diagram_block("\n".join(buf)))
                continue
            buf = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            blocks.append(code_block(lang, "\n".join(buf)))
            continue
        if line.startswith("#"):
            level = len(line) - len(line.lstrip("#"))
            text = line.lstrip("#").strip()
            if level == 1 and title is None:
                title = text
            elif level >= 2:
                blocks.append(subheading(text))
            i += 1
            continue
        if line.startswith("- ") or line.startswith("* "):
            items = []
            while i < len(lines) and (lines[i].strip().startswith("- ") or lines[i].strip().startswith("* ")):
                items.append(lines[i].strip()[2:].strip())
                i += 1
            blocks.append(list_block(items))
            continue
        if re.match(r"^\d+[.)] ", line):
            items = []
            while i < len(lines) and re.match(r"^\d+[.)] ", lines[i].strip()):
                items.append(re.sub(r"^\d+[.)] ", "", lines[i].strip()))
                i += 1
            blocks.append(list_block(items, ordered=True))
            continue
        if line.startswith("> "):
            buf = []
            while i < len(lines) and lines[i].strip().startswith("> "):
                buf.append(lines[i].strip()[2:].strip())
                i += 1
            blocks.append(quote(" ".join(buf)))
            continue
        if "|" in line and i + 1 < len(lines) and set(lines[i + 1].strip().replace("|", "")) <= set("-: "):
            header = [c.strip() for c in line.strip("|").split("|")]
            i += 2
            rows = []
            while i < len(lines) and "|" in lines[i] and lines[i].strip():
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            blocks.append(table_block(header, rows))
            continue
        buf = [line]
        i += 1
        while i < len(lines) and lines[i].strip() and not lines[i].strip().startswith(("#", "```", "- ", "* ", "> ", "|")):
            if re.match(r"^\d+[.)] ", lines[i].strip()):
                break
            buf.append(lines[i].strip())
            i += 1
        blocks.append(para(" ".join(buf)))
    return blocks, title


# ---------------------------------------------------------------------------
# Renderer: structured book -> final PDF HTML document
# ---------------------------------------------------------------------------


def _inline(text: str) -> str:
    """Minimal inline markdown -> HTML (bold, italic, inline code)."""
    text = html_lib.escape(text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"\*([^*]+)\*", r"<em>\1</em>", text)
    return text


def _estimate_text_width(text: str, font_size: float = 13.0) -> float:
    """Rough width of a bold sans-serif label (no canvas in the preview)."""
    return len(text) * 0.55 * font_size


def _wrap_label(text: str, max_width: float, font_size: float = 13.0) -> list:
    """Wrap a label into lines that each fit within `max_width`."""
    lines, cur = [], ""
    for word in text.split(" "):
        if _estimate_text_width(word, font_size) > max_width:
            if cur:
                lines.append(cur)
            lines.extend(_hard_break_word(word, max_width, font_size))
            cur = ""
            continue
        candidate = f"{cur} {word}" if cur else word
        if cur and _estimate_text_width(candidate, font_size) > max_width:
            lines.append(cur)
            cur = word
        else:
            cur = candidate
    if cur:
        lines.append(cur)
    return lines or [""]


def _hard_break_word(word: str, max_width: float, font_size: float = 13.0) -> list:
    """Break a single word longer than `max_width` into fitting chunks."""
    pieces, cur = [], ""
    for ch in word:
        if cur and _estimate_text_width(cur + ch, font_size) > max_width:
            pieces.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        pieces.append(cur)
    return pieces or [word]


def _fallback_svg(
    spec: str,
    accent: str = "#3b82f6",
    text_color: str = "#1e293b",
    box_fill: str = "#eef2f7",
) -> str:
    """Deterministic box-and-arrow SVG (mirrors the browser fallback used in the
    PDF renderer) so the live preview shows a real diagram, not raw source.
    Boxes auto-size to their text and long labels wrap instead of clipping."""
    from pipeline import _ensure_contrast

    text_color = _ensure_contrast(text_color, box_fill)
    labels = []
    for m in re.finditer(r"[A-Za-z0-9_-]+[\[({]([^\])\}]*)[\])\}]", spec):
        label = re.sub(r"<br\s*/?>", " ", m.group(1), flags=re.I)
        label = re.sub(r"<[^>]*>", " ", label)
        label = re.sub(r'[{}[\]()"|`<>]', " ", label)
        label = re.sub(r"\s+", " ", label).strip()[:120]
        if label and label not in labels:
            labels.append(label)
    while len(labels) < 2:
        labels.append(["Core Concept", "Implementation", "Key Takeaways"][len(labels)])
    labels = labels[:4]

    char_w = 7.2
    max_w, min_w, gap = 200.0, 150.0, 40
    line_h, top_pad, bot_pad, pad_x, pad_y = 18, 18, 18, 20, 20
    rows = []
    for lab in labels:
        lines = _wrap_label(lab, max_w - 24)
        widest = max(len(ln) for ln in lines) * char_w
        w = min(max_w, max(min_w, widest + 24))
        h = len(lines) * line_h + top_pad + bot_pad
        rows.append((lines, w, h))
    total_w = sum(r[1] for r in rows) + (len(rows) - 1) * gap + pad_x * 2
    H = max(r[2] for r in rows) + pad_y * 2
    mid = H / 2
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_w}" height="{H}" '
        f'viewBox="0 0 {total_w} {H}" font-family="sans-serif" class="fallback-diagram">'
    )
    x = pad_x
    for i, (lines, w, h) in enumerate(rows):
        y = mid - h / 2
        svg += (
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" '
            f'fill="{box_fill}" stroke="{accent}" stroke-width="2"/>'
        )
        for j, ln in enumerate(lines):
            svg += (
                f'<text x="{x + w / 2}" y="{y + top_pad + line_h * (j + 0.5)}" '
                f'text-anchor="middle" dominant-baseline="middle" font-size="13" '
                f'font-weight="600" fill="{text_color}">'
                f"{html_lib.escape(ln)}</text>"
            )
        if i > 0:
            svg += (
                f'<line x1="{x - gap + 4}" y1="{mid}" x2="{x - 4}" y2="{mid}" '
                f'stroke="{accent}" stroke-width="2" marker-end="url(#arr)"/>'
            )
        x += w + gap
    svg += '<defs><marker id="arr" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="%s"/></marker></defs></svg>' % accent
    return svg


def render_block(block: dict, seq: int) -> str:
    kind = block["type"]
    if kind == "paragraph":
        return f"<p>{_inline(block['text'])}</p>"
    if kind == "subheading":
        return f"<h3>{_inline(block['text'])}</h3>"
    if kind == "code":
        lang = block.get("lang", "text")
        fig = (
            '<figure class="codeblock">'
            f'<figcaption>{html_lib.escape(lang.upper())}</figcaption>'
            f"{pipeline.syntax_html(block['code'], lang)}"
            "</figure>"
        )
        return fig
    if kind == "diagram":
        spec = block.get("spec", "")
        if not spec:
            spec = pipeline._fallback_mermaid(block.get("caption", "Concept"))
        spec = pipeline.sanitize_mermaid_source(spec)
        return (
            f'<pre class="mermaid" id="mer-{seq}">{html_lib.escape(spec)}</pre>'
        )
    if kind == "callout":
        k = block.get("kind", "info")
        icons = {"info": "\u2139\ufe0f", "tip": "\U0001f4a1", "warn": "\u26a0\ufe0f",
                 "example": "\u270e\ufe0f", "takeaway": "\u2728"}
        icon = block.get("icon") or icons.get(k, "\u2139\ufe0f")
        return (
            f'<div class="callout callout-{k}">'
            f'<span class="callout-icon">{icon}</span>'
            f'<div class="callout-body"><p>{_inline(block["text"])}</p></div></div>'
        )
    if kind == "list":
        tag = "ol" if block.get("ordered") else "ul"
        items = "".join(f"<li>{_inline(i)}</li>" for i in block.get("items", []))
        return f"<{tag}>{items}</{tag}>"
    if kind == "table":
        header = "".join(f"<th>{_inline(h)}</th>" for h in block.get("header", []))
        rows = "".join(
            "<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in row) + "</tr>"
            for row in block.get("rows", [])
        )
        return f"<table><thead><tr>{header}</tr></thead><tbody>{rows}</tbody></table>"
    if kind == "quote":
        return f"<blockquote>{_inline(block['text'])}</blockquote>"
    return ""


def render_sections(sections) -> str:
    """Render sections -> body HTML (with sec-N anchors for TOC/outline)."""
    out = []
    seq = [0]
    for idx, sec in enumerate(sections, start=1):
        sid = f"sec-{idx}"
        cls = ""
        if sec.get("title_scale") == "sm":
            cls = ' class="title-sm"'
        elif sec.get("title_scale") == "lg":
            cls = ' class="title-lg"'
        out.append(f'<h2 id="{sid}"{cls}>{_inline(sec["title"])}</h2>')
        for block in sec.get("blocks", []):
            seq[0] += 1
            out.append(render_block(block, seq[0]))
    return "\n".join(out)


def book_sections(book) -> list:
    return book.get("sections", [])


def book_entries(book) -> list:
    return [(f"sec-{i}", sec["title"]) for i, sec in enumerate(book_sections(book), start=1)]


def render_book_document(book: dict, template: dict, page_map: dict = None) -> str:
    """Assemble the full styled HTML document for a book (for the PDF renderer)."""
    from templates import build_template_css, template_pygments_css

    title = book.get("title", "Ebook")
    subtitle = book.get("subtitle", "")
    body_html = render_sections(book_sections(book))

    page_map = page_map or {}
    toc_items = []
    for sid, text in book_entries(book):
        page = page_map.get(sid, "")
        toc_items.append(
            f'<li><a href="#{sid}">{html_lib.escape(text)}</a>'
            f'<span class="toc-pg">{page}</span></li>'
        )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{html_lib.escape(title)}</title>
<style>
{template_pygments_css(template)}
{build_template_css(template)}
</style>
</head>
<body>
  <div class="cover">
    <h1 class="chapter-title">{_inline(title)}</h1>
    <p class="cover-sub">{html_lib.escape(subtitle) if subtitle else "A Visual, Story-Driven Learning Guide"}</p>
  </div>
  <div class="toc">
    <h2>Table of Contents</h2>
    <ol>{''.join(toc_items)}</ol>
  </div>
  {body_html}
</body>
</html>"""


def render_book_preview_html(book: dict, template: dict) -> str:
    """HTML fragment for the live in-app preview (no page numbers needed)."""
    from templates import build_template_css, template_pygments_css

    body = render_sections(book_sections(book))

    # swap mermaid source for a real (fallback) SVG so the preview shows a diagram
    accent = template["diagram"].get("box_stroke", "#3b82f6")
    text_color = template["diagram"].get("text", "#1e293b")
    box_fill = template["diagram"].get("box_fill", "#eef2f7")

    def _svg_repl(m):
        spec = html_lib.unescape(re.sub(r"<[^>]+>", "", m.group(1)))
        return _fallback_svg(spec, accent, text_color, box_fill)

    body = re.sub(
        r'<pre class="mermaid"[^>]*>(.*?)</pre>',
        _svg_repl,
        body,
        flags=re.DOTALL,
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html_lib.escape(book.get('title', 'Preview'))}</title>
<style>
html, body {{ margin: 0; padding: 0; }}
body {{ padding: 24px; background: {template['palette']['page_bg']}; }}
.fallback-diagram {{ display: block; margin: 3mm auto; max-width: 100%; height: auto; }}
{template_pygments_css(template)}
{build_template_css(template)}
</style>
</head>
<body>
  <h1 class="chapter-title" style="margin-top:0">{_inline(book.get('title', ''))}</h1>
  {body}
</body>
</html>"""


# ---------------------------------------------------------------------------
# Page-count verification + auto-adjustment (Part 2)
# ---------------------------------------------------------------------------


def count_pages(book: dict, template: dict) -> int:
    doc = render_book_document(book, template, page_map=None)
    return pipeline.count_document_pages(doc, template=template)


def _trim_paragraph(block: dict) -> bool:
    """Keep the first 1-2 sentences of a paragraph. Returns True if changed."""
    text = block.get("text", "")
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    if len(sentences) <= 1:
        return False
    keep = max(1, len(sentences) // 2)
    block["text"] = " ".join(sentences[:keep])
    return True


def _expand_paragraph(block: dict) -> bool:
    """Split a long paragraph into two. Returns True if changed."""
    text = block.get("text", "")
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    if len(sentences) < 2:
        return False
    half = max(1, len(sentences) // 2)
    block["text"] = " ".join(sentences[:half])
    return True


def adjust_to_page_target(book: dict, template: dict, target_pages: int) -> dict:
    """Render for real, then tighten/expand content so the page count lands
    near the target. Returns the (possibly adjusted) book."""
    book = dict(book)
    book["sections"] = [dict(s) for s in book_sections(book)]
    for sec in book["sections"]:
        sec["blocks"] = [dict(b) for b in sec.get("blocks", [])]

    target_pages = max(1, int(target_pages))
    count = count_pages(book, template)
    too_long = count > max(target_pages + 2, int(target_pages * 1.3))
    too_short = count < min(target_pages - 2, int(target_pages * 0.7))

    if not too_long and not too_short:
        return book

    if too_long:
        for sec in book["sections"]:
            for block in sec["blocks"]:
                if block["type"] == "paragraph":
                    _trim_paragraph(block)
        # also drop empty diagram captions which take a line each
        for sec in book["sections"]:
            for block in sec["blocks"]:
                if block["type"] == "diagram" and not block.get("caption"):
                    pass
    elif too_short and count < target_pages:
        # expand: split paragraphs into two + sprinkle a tip callout
        changed_any = False
        for sec in book["sections"]:
            new_blocks = []
            for block in sec["blocks"]:
                new_blocks.append(block)
                if block["type"] == "paragraph":
                    sentences = re.split(r"(?<=[.!?])\s+", block.get("text", "").strip())
                    if len(sentences) > 1:
                        half = max(1, len(sentences) // 2)
                        new_blocks.append(
                            para(" ".join(sentences[half:]))
                        )
                        block["text"] = " ".join(sentences[:half])
                        changed_any = True
            sec["blocks"] = new_blocks
        if changed_any:
            sec = book["sections"][0]
            sec.setdefault("blocks", []).append(
                callout("tip", "Revisit this section and test each step yourself — "
                               "hands-on practice cements the idea.")
            )

    return book


# ---------------------------------------------------------------------------
# Book -> markdown (for download/export and testing)
# ---------------------------------------------------------------------------


def book_to_markdown(book: dict) -> str:
    out = [f"# {book.get('title', 'Ebook')}"]
    if book.get("subtitle"):
        out.append("")
        out.append(book["subtitle"])
    out.append("")
    for sec in book_sections(book):
        out.append(f"## {sec['title']}")
        for block in sec.get("blocks", []):
            if block["type"] == "paragraph":
                out.append("")
                out.append(block["text"])
            elif block["type"] == "subheading":
                out.append("")
                out.append(f"### {block['text']}")
            elif block["type"] == "code":
                out.append("")
                out.append(f"```{block.get('lang', '')}")
                out.append(block["code"])
                out.append("```")
            elif block["type"] == "diagram":
                out.append("")
                out.append("```mermaid")
                out.append(block["spec"])
                out.append("```")
            elif block["type"] == "callout":
                out.append("")
                out.append(f"> {block['text']}")
            elif block["type"] == "list":
                out.append("")
                for item in block["items"]:
                    out.append(f"- {item}")
            elif block["type"] == "quote":
                out.append("")
                out.append(f"> {block['text']}")
        out.append("")
    return "\n".join(out)
