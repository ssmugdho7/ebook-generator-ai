"""Markdown -> HTML -> PDF pipeline.

Decouples content parsing, diagram rendering, and final layout:

  raw markdown
      -> python-markdown (real parser) -> HTML
      -> mermaid blocks rendered to SVG images via Playwright + mermaid.js
      -> Chromium print-to-PDF respecting CSS page-break rules

All themes, typography, syntax highlighting, and pagination are controlled in CSS.
"""

import os
import re
import uuid
from typing import Dict, List

import html as html_lib
import markdown as md

from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import get_lexer_by_name
from pygments.style import Style
from pygments.styles import get_style_by_name
from pygments.token import Token
from pygments.util import ClassNotFound

MERMAID_SRC = os.path.join(os.path.dirname(__file__), "assets", "mermaid.min.js")

# ---------------------------------------------------------------------------
# Entities / guards
# ---------------------------------------------------------------------------

ASCII_DIAGRAM_HINTS = None  # defined below


def looks_like_ascii_diagram(code: str) -> bool:
    """Detect unlabeled ASCII-art diagrams (boxes/arrows, no real language)."""
    lines = [ln for ln in code.split("\n") if ln.strip()]
    if not lines:
        return False
    # heavy box-drawing / arrow usage
    boxy = sum(1 for ln in lines if re.search(r"[+\-]|[-=][>=]|<[-=]|v|\^|\|", ln))
    ratio = boxy / len(lines)
    # short lines, no identifiers with letters/equals that look like code
    has_code_tokens = any(re.search(r"(def |class |import |function |=>|;|\{\})", ln) for ln in lines)
    return ratio >= 0.6 and not has_code_tokens


DIAGRAM_REFERENCE = re.compile(
    r"\b(diagram|flow( |-)?chart|figure|architecture\s+diagram|illustrat\w*|"
    r"chart\s+below|below\s+demonstrat\w*|overview\s+graph)\b",
    re.IGNORECASE,
)

_SKIP_WORDS = set(
    "a an the of and or to in on for with is are was were be been this that these those "
    "from by as at it its not but you your can will have has had using use used how what "
    "why when where which who code coding concept concepts section example below above "
    "look into".split()
)


def _fallback_mermaid(title: str) -> str:
    """Generate a valid mermaid flowchart from a heading when none exists."""
    words = [w.strip(".,;:#*`[]()").lower() for w in re.split(r"[\s]+", title)]
    nodes = []
    seen = set()
    for w in words:
        w = w.strip(":-")
        if len(w) >= 4 and w not in _SKIP_WORDS and w not in seen:
            seen.add(w)
            nodes.append(w.capitalize())
        if len(nodes) >= 4:
            break
    if len(nodes) < 2:
        nodes = ["Main Concept", "Core Mechanics", "Implementation"]
    parts = ["flowchart LR"]
    prev = "A0"
    for i, n in enumerate(nodes):
        node_id = f"N{i}"
        parts.append(f"    {node_id}[{n}]")
        if i > 0:
            parts.append(f"    {prev} --> {node_id}")
        prev = node_id
    parts.append(f"    {prev} --> Final[Key Takeaways]")
    return "\n".join(parts)


def _sanitize_mermaid_label(label: str, max_len: int = 60) -> str:
    """Make a node label safe for mermaid: strip shape/quote/pipe chars that
    break parsing, collapse whitespace, and cap the length."""
    label = label.replace("\\", "")
    label = html_lib.unescape(label)
    label = re.sub(r"[\r\n\t\f\v]+", " ", label)
    for ch in ('{', '}', '[', ']', '(', ')', '"', '`', '|', '#'):
        label = label.replace(ch, " ")
    label = re.sub(r"[<>]", "", label)
    label = re.sub(r"\s+", " ", label).strip()
    return label[:max_len]


def _fallback_mermaid_for_source(source: str) -> str:
    """Build a valid box-and-arrow flowchart from a broken diagram definition,
    salvaging whatever node labels we can from the original source."""
    labels = []
    for m in re.finditer(r"[A-Za-z0-9_-]+\[([^\]]*)\]", source):
        labels.append(_sanitize_mermaid_label(m.group(1)))
    for m in re.finditer(r"[A-Za-z0-9_-]+\{([^}]*)\}", source):
        labels.append(_sanitize_mermaid_label(m.group(1)))
    for m in re.finditer(r"[A-Za-z0-9_-]+\(([^)]*)\)", source):
        labels.append(_sanitize_mermaid_label(m.group(1)))
    labels = [l for l in labels if l]
    while len(labels) < 2:
        labels.append(["Core Concept", "Implementation", "Key Takeaways"][len(labels)])
    labels = labels[:4]

    parts = ["flowchart LR"]
    prev = "A0"
    for i, label in enumerate(labels):
        node_id = f"N{i}"
        parts.append(f'    {node_id}["{label}"]')
        if i > 0:
            parts.append(f"    {prev} --> {node_id}")
        prev = node_id
    return "\n".join(parts)


def sanitize_mermaid_source(source: str) -> str:
    """Best-effort cleanup of a raw mermaid definition before rendering."""
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", source)


def lint_mermaid_source(source: str) -> List[str]:
    """Return a list of problems found in a mermaid definition.

    An empty list means the block should render fine; any problem means the
    block is swapped for a controlled fallback before it ever reaches mermaid.
    """
    problems: List[str] = []
    if not source.strip():
        problems.append("empty diagram")
    # a node id with a space directly before '{' is not valid mermaid
    # (e.g. 'Storage Router{8. Data Type}') and breaks the whole parse.
    if re.search(r"\b[A-Za-z0-9_-]+ [A-Za-z0-9_-]+\s*\{", source):
        problems.append("node id with space before '{'")
    if source.count("{") != source.count("}"):
        problems.append("unbalanced braces")
    if source.count('"') % 2 != 0:
        problems.append("unbalanced double quotes")
    for ln in source.splitlines():
        outside = re.sub(r"\[[^\]]*\]|\([^)]*\)|\{[^}]*\}", "", ln)
        if "|" in outside and "-->" not in outside:
            problems.append("stray '|' outside a label")
    return problems


def ensure_diagrams(markdown_text: str) -> str:
    """Guarantee every section that mentions a diagram actually contains one."""
    lines = markdown_text.split("\n")
    sections: List[List[str]] = [[]]
    for ln in lines:
        if (ln.startswith("## ") or ln.startswith("# ")) and sections[-1]:
            sections.append([ln])
        else:
            sections[-1].append(ln)

    out_lines: List[str] = []
    for sec in sections:
        block = "\n".join(sec).strip()
        if not block:
            continue
        out_lines.append(block)
        lower = block.lower()
        mentions = DIAGRAM_REFERENCE.search(lower)
        has_mermaid = "```mermaid" in lower
        if mentions and not has_mermaid:
            title_line = next(
                (ln.lstrip("# ").strip() for ln in sec if ln.startswith(("# ", "## "))),
                "Concept",
            )
            out_lines.append("\n```mermaid\n" + _fallback_mermaid(title_line) + "\n```\n")
    # Blank line between sections: a table ending a section must be followed
    # by a blank line, or the next ATX heading gets swallowed as a table row.
    return "\n\n".join(out_lines)


def reject_ascii_diagram_blocks(markdown_text: str) -> str:
    """Drop code fences that are unlabeled ASCII diagrams."""
    out: List[str] = []
    i = 0
    lines = markdown_text.split("\n")
    while i < len(lines):
        ln = lines[i]
        if ln.strip().startswith("```"):
            lang = ln.strip()[3:].strip().lower()
            body = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                body.append(lines[i])
                i += 1
            fence_close = lines[i] if i < len(lines) else ""
            i += 1
            if lang in ("text", "txt", "plain", "ascii", "diagram", "md", "markdown") or (
                lang == "" and looks_like_ascii_diagram("\n".join(body))
            ):
                continue  # drop it entirely
            out.append(f"{ln}\n" + "\n".join(body) + (f"\n{fence_close}" if fence_close else ""))
        else:
            out.append(ln)
        i += 1
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Markdown -> HTML (real parser)
# ---------------------------------------------------------------------------

_MERMAID_PREFIX = "MMMERMAIDTHISMARKER"
_MERMAID_SUFFIX = "MMMERMAIDTHISEND"


def _extract_mermaid(content: str):
    """Pull ```mermaid blocks out, returning (text_without_mermaid, defs dict).

    Blocks that fail the mermaid lint pass are replaced with a controlled
    fallback diagram so a syntax error never renders into the book.
    """
    defs: Dict[str, str] = {}
    parts: List[str] = []
    pattern = re.compile(r"^```mermaid\s*\n(.*?)^```\s*$", re.MULTILINE | re.DOTALL)
    pos = 0
    for m in pattern.finditer(content):
        parts.append(content[pos:m.start()])
        key = f"mermaid-{uuid.uuid4().hex[:10]}"
        definition = m.group(1).strip()
        problems = lint_mermaid_source(sanitize_mermaid_source(definition))
        if problems:
            print(f"MERMAID_LINT {key}: {problems} -> fallback")
            definition = _fallback_mermaid_for_source(definition)
        defs[key] = definition
        parts.append(f"{_MERMAID_PREFIX}{key}{_MERMAID_SUFFIX}\n")
        pos = m.end()
    parts.append(content[pos:])
    return "".join(parts), defs


def render_markdown_to_html(body_md: str) -> str:
    """Parse markdown with python-markdown; inline mermaid fences become divs."""
    text_no_mermaid, defs = _extract_mermaid(body_md)
    # strip leftover strikethrough markers (never rendered in the PDF)
    text_no_mermaid = re.sub(r"~~(.+?)~~", r"\1", text_no_mermaid)

    compiled = md.markdown(
        text_no_mermaid,
        extensions=[
            "fenced_code",
            "codehilite",
            "tables",
            "sane_lists",
            "toc",
            "attr_list",
        ],
        extension_configs={
            "codehilite": {
                "css_class": "codehilite",
                "guess_lang": True,
                "linenums": False,
            },
            "toc": {"anchorlink": True},
        },
    )

    # swap sentinels back for mermaid rendering
    for key, definition in defs.items():
        html_def = html_lib.escape(definition)
        compiled = compiled.replace(
            f"<p>{_MERMAID_PREFIX}{key}{_MERMAID_SUFFIX}</p>",
            f'<pre class="mermaid" id="{key}">{html_def}</pre>',
        )
        compiled = compiled.replace(
            f"{_MERMAID_PREFIX}{key}{_MERMAID_SUFFIX}",
            f'<pre class="mermaid" id="{key}">{html_def}</pre>',
        )
    return compiled


def add_language_labels(body_html: str, markdown_text: str) -> str:
    """Wrap syntax-highlighted code blocks in a figure whose label never detaches."""
    langs = [
        ln.strip()[3:].strip()
        for ln in markdown_text.split("\n")
        if ln.strip().startswith("```") and "mermaid" not in ln.strip().lower()
    ]

    counter = {"i": 0}

    def repl(m):
        lang = langs[counter["i"] % len(langs)] if langs else ""
        counter["i"] += 1
        figure = (
            '<figure class="codeblock">'
            f'<figcaption>{html_lib.escape(lang.upper())}</figcaption>'
            '<div class="codehilite">'
        )
        return figure + m.group(1) + "</div></figure>"

    return re.sub(
        r'<div class="codehilite">(<pre>.*?</pre>)</div>',
        repl,
        body_html,
        flags=re.DOTALL,
    )


_LIGHT_TOKENS = {
    Token.Text: "#1a1a1a",
    Token.Whitespace: "#5b6470",
    Token.Comment: "#005f00",
    Token.Comment.Preproc: "#006b4f",
    Token.Keyword: "#a32900",
    Token.Keyword.Type: "#005f8f",
    Token.Name: "#1a1a1a",
    Token.Name.Builtin: "#0000aa",
    Token.Name.Function: "#0b5394",
    Token.Name.Class: "#005c99",
    Token.Name.Namespace: "#005c99",
    Token.Name.Decorator: "#6f2da8",
    Token.Name.Attribute: "#006d5b",
    Token.Name.Tag: "#008000",
    Token.Name.Variable: "#0057a8",
    Token.Name.Constant: "#006b8f",
    Token.Literal.String: "#a31515",
    Token.Literal.String.Escape: "#0451a5",
    Token.Literal.String.Interpol: "#0451a5",
    Token.Literal.Number: "#08704a",
    Token.Operator: "#2a2a2a",
    Token.Punctuation: "#333333",
    Token.Error: "#b00020",
    Token.Generic.Heading: "#005f8f",
    Token.Generic.Deleted: "#b00020",
    Token.Generic.Inserted: "#08704a",
}


def _make_style(base_styles, overrides):
    palette = dict(base_styles)
    palette.update(overrides)

    class _ThemeStyle(Style):
        default_style = ""
        styles = palette

    return _ThemeStyle


def _light_style():
    return _make_style(_LIGHT_TOKENS, {})


def _dark_style():
    # monokai is designed for a dark background; override the one token that
    # fails WCAG AA on our dark boxes.
    base = get_style_by_name("monokai").styles
    return _make_style(base, {Token.Error: "#ff7edb"})


def resolve_pygments(style_key: str):
    if style_key == "light":
        return _light_style()
    if style_key == "dark":
        return _dark_style()
    return get_style_by_name(style_key)


def _wcag_contrast(a: str, b: str) -> float:
    def _lum(hexc: str) -> float:
        def _ch(c: float) -> float:
            c = c / 255.0
            return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

        r, g, bl = int(hexc[1:3], 16), int(hexc[3:5], 16), int(hexc[5:7], 16)
        return 0.2126 * _ch(r) + 0.7152 * _ch(g) + 0.0722 * _ch(bl)

    la, lb = _lum(a), _lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def verify_code_contrast(theme_key: str) -> List[str]:
    """Return token classes whose color fails WCAG AA (4.5:1) vs the code box."""
    t = THEMES[theme_key]
    bg = t["code_bg"]
    css = pygments_css(t["pygments"])
    failures = []
    for m in re.finditer(r"\.codehilite \.([a-z0-9]+) \{ color: (#[0-9a-fA-F]{3,6})", css):
        cls, color = m.group(1), m.group(2)
        if len(color) == 4:
            color = "#" + "".join(c * 2 for c in color[1:])
        if _wcag_contrast(color, bg) < 4.5:
            failures.append(f"{cls} ({color})")
    return failures


def pygments_css(style_key: str = "light") -> str:
    return HtmlFormatter(style=resolve_pygments(style_key)).get_style_defs(".codehilite")


def syntax_html(code: str, lang: str) -> str:
    """Highlight a code snippet; fall back to plain escaped text."""
    esc = html_lib.escape(code)
    if not lang:
        return f"<pre><code>{esc}</code></pre>"
    try:
        lexer = get_lexer_by_name(lang, stripall=False)
        body = (
            '<div class="codehilite">'
            + highlight(code, lexer, HtmlFormatter())
            + "</div>"
        )
        return body
    except ClassNotFound:
        return f'<div class="codehilite"><pre><code class="language-{html_lib.escape(lang)}">{esc}</code></pre></div>'


# ---------------------------------------------------------------------------
# Theme CSS
# ---------------------------------------------------------------------------

THEMES = {
    "Academic Textbook": {
        "pygments": "light",
        "page_bg": "#ffffff",
        "text": "#2a2a35",
        "heading": "#16324f",
        "accent": "#1f4e8c",
        "muted": "#5a6b7c",
        "code_bg": "#f4f4f7",
        "code_text": "#1a1a1a",
        "code_line": "#d9d9e3",
        "block_bg": "#f0f4f9",
        "label": "Academic Textbook",
        "font": '"Georgia", "Times New Roman", serif',
        "mono": '"Courier New", Courier, monospace',
        "title_page_bg": "#ffffff",
    },
    "Modern Tech Blog": {
        "pygments": "light",
        "page_bg": "#ffffff",
        "text": "#2d3748",
        "heading": "#1a202c",
        "accent": "#6366f1",
        "muted": "#718096",
        "code_bg": "#f4f4f7",
        "code_text": "#1a1a1a",
        "code_line": "#e2e8f0",
        "block_bg": "#f7f7fb",
        "label": "Modern Tech Blog",
        "font": '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        "mono": '"SF Mono", "Fira Code", Menlo, Consolas, monospace',
        "title_page_bg": "#ffffff",
    },
    "Dark Mode Minimalist": {
        "pygments": "dark",
        "page_bg": "#0b1120",
        "text": "#cbd5e1",
        "heading": "#f1f5f9",
        "accent": "#38bdf8",
        "muted": "#7f8ea3",
        "code_bg": "#0f172a",
        "code_text": "#f8f8f2",
        "code_line": "#1e293b",
        "block_bg": "#111a2c",
        "label": "Dark Mode Minimalist",
        "font": '"Inter", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
        "mono": '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
        "title_page_bg": "#0b1120",
    },
}


def css_from_vars(v: dict) -> str:
    """Build the shared stylesheet from a vars dict.

    `v` needs: page_bg, text, heading, accent, accent_soft, muted, block_bg,
    code_bg, code_text, code_line, title_page_bg, font, heading_font, mono,
    radius, callouts, diagram. Templates produce these via templates.template_css_vars.
    """
    accent = v.get("accent")
    accent_soft = v.get("accent_soft", v.get("block_bg"))
    radius = v.get("radius", "3mm")
    callouts = v.get("callouts", {})
    dia = v.get("diagram", {})

    header = """\
@page {
  size: A4;
  margin: 20mm 17mm 18mm 17mm;
  @top-center { content: string(chap-title); font-family: sans-serif;
                font-size: 8pt; color: MUTED; border-bottom: 0.4pt solid ACCENT;
                padding-bottom: 2mm; }
  @bottom-center { content: counter(page); font-family: sans-serif;
                   font-size: 8pt; color: MUTED; }
}
@page cover { @top-center { content: none; } @bottom-center { content: none; } }
"""

    cover = """\
.cover { page: cover; background: TITLE_BG; }
"""

    body = """\
html, body { margin: 0; padding: 0; }
body { background: PAGE_BG; color: TEXT; font-family: FONT; font-size: 10.5pt;
       line-height: 1.55; }
* { box-sizing: border-box; }

/* ---------- headings: never orphaned ---------- */
h1, h2, h3, h4 { color: HEADING; break-after: avoid; page-break-after: avoid;
                 orphans: 3; widows: 3; line-height: 1.25; }
h1 { font-size: 20pt; text-align: center; margin: 6mm 0 6mm; padding-bottom: 3mm;
     border-bottom: 2px solid ACCENT; break-before: page; page-break-before: always; }
h2 { font-size: 15pt; margin: 9mm 0 3mm; padding-left: 3mm;
     border-left: 3.5px solid ACCENT; }
h2.title-sm { font-size: 13pt; border-left-width: 2.5px; }
h2.title-lg { font-size: 18pt; }
h3 { font-size: 12pt; margin: 5mm 0 2mm; color: ACCENT; }

p { margin: 0 0 2.5mm; text-align: justify; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
li { margin-bottom: 1mm; orphans: 2; widows: 2; }
blockquote { margin: 3mm 0; padding: 2.5mm 4mm; border-left: 3px solid ACCENT;
             background: BLOCK_BG; color: MUTED; font-style: italic; }
strong { color: HEADING; }
a { color: ACCENT; text-decoration: none; }
hr { border: 0; border-top: 1px solid CODE_LINE; margin: 4mm 0; }
img { max-width: 100%; }

/* ---------- callouts / takeaways ---------- */
.callout { break-inside: avoid; page-break-inside: avoid; border-radius: RADIUS;
           padding: 3mm 4mm; margin: 3mm 0; border: 1px solid CC_BORDER;
           border-left-width: 3.5px; background: CC_BG; }
.callout-icon { float: left; font-size: 12pt; margin-right: 3mm; line-height: 1.4; }
.callout .callout-body { margin-left: 8mm; }
.callout .callout-body p:last-child { margin-bottom: 0; }
.callout-takeaway { border-left-width: 4px; }
.callout-takeaway .callout-body { font-weight: 600; color: HEADING; }

/* ---------- code blocks: highlighted + kept together ---------- */
.codehilite { background: CODE_BG; color: CODE_TEXT; border: 0.4pt solid CODE_LINE;
              border-radius: RADIUS; padding: 4mm; font-family: MONO; font-size: 8.5pt;
              line-height: 1.45; overflow: hidden; break-inside: avoid;
              page-break-inside: avoid; margin: 3mm 0; }
.codehilite pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
code { font-family: MONO; font-size: 8.8pt; background: CODE_BG;
       padding: 0 1.5mm; border-radius: 1.5mm; }
p code { background: BLOCK_BG; color: HEADING; }
.codehilite code { background: transparent; padding: 0; color: inherit; }

/* language label stays glued to code */
figure.codeblock { margin: 3mm 0; break-inside: avoid; page-break-inside: avoid; }
figure.codeblock figcaption { font-family: sans-serif; font-size: 7pt; color: MUTED;
    text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 1mm; }
figure.codeblock .codehilite { margin: 0; }

/* ---------- tables ---------- */
table { width: 100%; border-collapse: collapse; margin: 3mm 0; font-size: 9pt;
        break-inside: avoid; page-break-inside: avoid; }
th { background: ACCENT; color: #fff; text-align: left; padding: 2mm 2.5mm; }
td { border-bottom: 0.4pt solid CODE_LINE; padding: 2mm 2.5mm; }
tr:nth-child(even) td { background: BLOCK_BG; }

/* ---------- mermaid diagrams: real SVG images ---------- */
.mermaid { text-align: center; margin: 3mm 0; break-inside: avoid;
           page-break-inside: avoid; background: transparent; }
.mermaid svg { display: block; margin: 0 auto; max-width: 100%; height: auto; }
.merr { color: #b00020; font-size: 9pt; }

/* ---------- cover / title ---------- */
.cover-header { string-set: chap-title content(); }
.chapter-title { string-set: chap-title content(); }
h1.chapter-title { font-size: 26pt; text-align: center; margin-top: 70mm; }
.cover-sub { text-align: center; color: MUTED; font-size: 12pt; margin-top: 6mm; }

/* ---------- TOC: clickable, with page numbers ---------- */
.toc { break-before: page; page: cover; }
.toc h2 { border: none; padding: 0; color: HEADING; font-size: 16pt; }
.toc ol { list-style: none; padding: 0; counter-reset: toc; }
.toc li { counter-increment: toc; display: flex; justify-content: space-between;
          align-items: baseline; padding: 1.6mm 0; border-bottom: 0.3pt solid CODE_LINE;
          font-size: 11pt; }
.toc li::before { content: counter(toc) ".  "; color: ACCENT; font-weight: bold; }
.toc li a { color: TEXT; text-decoration: none; }
.toc li a:hover { color: ACCENT; }
.toc-pg { color: MUTED; min-width: 8mm; text-align: right; margin-left: 4mm; }

/* ---------- misc ---------- */
.section-limit { break-inside: avoid; }
"""

    callout_css = ""
    kinds = {"info", "tip", "warn", "example", "takeaway"}
    for kind in sorted(kinds):
        spec = callouts.get(kind, {})
        border = spec.get("border", accent)
        bg = spec.get("bg", accent_soft)
        callout_css += (
            f".callout-{kind} {{ background: {bg}; border-color: {border}; }}\n"
        )
    diagram_css = "".join(
        f".mermaid-{k} {{ --mm-fill: {dia.get('box_fill', '#fff')}; --mm-stroke: {dia.get('box_stroke', accent)}; }}"
        for k in ("line", "box", "cluster")
    )

    css = body.replace("PAGE_BG", v.get("page_bg", "#fff")).replace("TEXT", v.get("text", "#000"))
    css = css.replace("HEADING", v.get("heading", "#000")).replace("ACCENT", accent or "#000")
    css = css.replace("ACCENT_SOFT", accent_soft)
    css = css.replace("MUTED", v.get("muted", "#666"))
    css = css.replace("CODE_BG", v.get("code_bg", "#f5f5f5")).replace("CODE_LINE", v.get("code_line", "#ddd"))
    css = css.replace("CODE_TEXT", v.get("code_text", "#111"))
    css = css.replace("BLOCK_BG", v.get("block_bg", "#fafafa"))
    css = css.replace("FONT", v.get("font", "sans-serif"))
    css = css.replace("MONO", v.get("mono", "monospace"))
    css = css.replace("RADIUS", radius)
    css = css.replace("CC_BORDER", accent or "#000").replace("CC_BG", accent_soft)
    cover_css = cover.replace("TITLE_BG", v.get("title_page_bg", v.get("page_bg", "#fff")))
    header_css = header.replace("MUTED", v.get("muted", "#666")).replace("ACCENT", accent or "#000")
    return header_css + cover_css + "\n" + css + "\n" + callout_css + diagram_css


def build_css(theme_key: str) -> str:
    return css_from_vars(THEMES[theme_key])


# ---------------------------------------------------------------------------
# Final HTML assembly + Playwright PDF
# ---------------------------------------------------------------------------


def _add_section_anchors(body_html: str) -> str:
    """Give every h1-h3 a stable id (sec-N) usable as an internal link target."""
    counter = {"n": 0}

    def repl(m):
        tag = m.group(0)
        tag = re.sub(r'\s+id="[^"]*"', "", tag)
        counter["n"] += 1
        return tag[:-1] + f' id="sec-{counter["n"]}">'

    return re.sub(r"<h[1-3][^>]*>", repl, body_html)


def _section_entries(body_html: str) -> List[tuple]:
    """Return ordered [(sec-N, title)] for h2 sections (used for TOC + outline)."""
    entries = []
    for sid, txt in re.findall(
        r'<h2[^>]*id="(sec-\d+)"[^>]*>(.*?)</h2>', body_html, re.DOTALL
    ):
        text = re.sub(r"<[^>]+>", "", txt).strip()
        text = html_lib.unescape(text)
        entries.append((sid, text))
    return entries


def build_document(
    markdown_text: str, theme_key: str, page_map: Dict[str, int] = None
) -> str:
    t = THEMES[theme_key]
    failures = verify_code_contrast(theme_key)
    if failures:
        raise ValueError(
            f"[{theme_key}] code tokens fail WCAG AA contrast vs box: {failures}"
        )

    body_html = render_markdown_to_html(markdown_text)
    body_html = add_language_labels(body_html, markdown_text)
    body_html = _add_section_anchors(body_html)

    # title + toc extraction from rendered HTML
    title_match = re.search(r"<h1[^>]*>(.*?)</h1>", body_html, re.DOTALL)
    title = re.sub(r"<[^>]+>", "", title_match.group(1)).strip() if title_match else "Ebook"
    title = html_lib.unescape(title)

    page_map = page_map or {}
    toc_items = []
    for sid, text in _section_entries(body_html):
        page = page_map.get(sid, "")
        toc_items.append(
            f'<li><a href="#{sid}">{html_lib.escape(text)}</a>'
            f'<span class="toc-pg">{page}</span></li>'
        )

    pyg_css = pygments_css(t["pygments"])

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{html_lib.escape(title)}</title>
<style>
{pyg_css}
{build_css(theme_key)}
</style>
</head>
<body>
  <div class="cover">
    <h1 class="chapter-title">{html_lib.escape(title)}</h1>
    <p class="cover-sub">A Visual, Story-Driven Learning Guide &middot; {html_lib.escape(t['label'])}</p>
  </div>
  <div class="toc">
    <h2>Table of Contents</h2>
    <ol>{''.join(toc_items)}</ol>
  </div>
  {body_html}
</body>
</html>"""


async def render_pdf(
    markdown_text: str,
    theme_key: str,
    out_path: str,
    page_map: Dict[str, int] = None,
    document: str = None,
) -> str:
    """Render the final styled PDF. Returns output path.

    If `document` is given (a fully-assembled HTML string from
    book.render_book_document), it is used directly instead of building the
    document from markdown+theme.
    """
    document = document or build_document(markdown_text, theme_key, page_map)

    from playwright.async_api import async_playwright

    with open(MERMAID_SRC, "r", encoding="utf-8") as f:
        mermaid_js = f.read()

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        try:
            page = await browser.new_page()
            await page.set_content(document, wait_until="load")
            # inject mermaid and render diagrams into real SVG
            await page.add_script_tag(content=mermaid_js)
            await page.evaluate(r"""(async () => {
              if (!window.mermaid) return;
              mermaid.initialize({ startOnLoad: false, theme: 'neutral',
                                   securityLevel: 'loose',
                                   flowchart: { htmlLabels: true, useMaxWidth: true },
                                   themeVariables: { fontFamily: 'sans-serif' } });
              const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;')
                                 .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
              const buildFallbackSvg = (id, src) => {
                const labels = [];
                const re = /[A-Za-z0-9_-]+[\[({]([^\])\}]*)[\])\}]/g;
                let m;
                while ((m = re.exec(src))) {
                  let l = (m[1] || '').replace(/[{}[\]()"|`<>]/g, ' ')
                                      .replace(/\s+/g, ' ').trim().slice(0, 40);
                  if (l && !labels.includes(l)) labels.push(l);
                }
                while (labels.length < 2) {
                  labels.push(['Core Concept', 'Implementation', 'Key Takeaways'][labels.length]);
                }
                labels.length = Math.min(labels.length, 4);
                const nw = 150, gap = 40, h = 60, pad = 20;
                const w = labels.length * nw + (labels.length - 1) * gap + pad * 2;
                const H = h + pad * 2, mid = pad + h / 2, aid = 'a' + id.replace(/[^a-zA-Z0-9]/g, '');
                let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + H +
                          '" viewBox="0 0 ' + w + ' ' + H + '" font-family="sans-serif">';
                svg += '<defs><marker id="' + aid + '" markerWidth="10" markerHeight="10" refX="9" refY="3" ' +
                       'orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#3b82f6"/></marker></defs>';
                labels.forEach((lab, i) => {
                  const x = pad + i * (nw + gap);
                  svg += '<rect x="' + x + '" y="' + pad + '" width="' + nw + '" height="' + h +
                         '" rx="8" fill="#eef2f7" stroke="#3b82f6" stroke-width="2"/>';
                  svg += '<text x="' + (x + nw / 2) + '" y="' + mid + '" text-anchor="middle" ' +
                         'dominant-baseline="middle" font-size="13" fill="#1e293b">' + esc(lab) + '</text>';
                  if (i > 0) {
                    const px = pad + (i - 1) * (nw + gap) + nw;
                    svg += '<path d="M ' + px + ' ' + mid + ' H ' + (px + gap) +
                           '" stroke="#3b82f6" stroke-width="2" fill="none" marker-end="url(#' + aid + ')"/>';
                  }
                });
                return svg + '</svg>';
              };
              const els = Array.from(document.querySelectorAll('pre.mermaid'));
              for (const el of els) {
                const def = el.textContent.trim();
                if (!def) { el.innerHTML = buildFallbackSvg(el.id, 'Concept'); continue; }
                let svg = '';
                try {
                  const r = await mermaid.render('svg-' + el.id, def);
                  svg = r.svg || '';
                } catch (e) {
                  svg = '';
                }
                // Check for error states: specific error text, doubled chars, or too many raw text elements
                const hasErrorText = /mermaid\s+version|syntax error|parse error|error rendering/i.test(svg);
                const hasDoubledChars = /SySynnttaaxx|eerrrroorr|vveerrssiioonn/i.test(svg);
                const textCount = (svg.match(/<text/g) || []).length;
                const bad = hasErrorText || hasDoubledChars || textCount > 15 || !svg;
                el.innerHTML = bad ? buildFallbackSvg(el.id, def) : svg;
              }
            })()""")

            # wait until every mermaid pre has been replaced by an svg (or an error)
            try:
                await page.wait_for_function(
                    """() => {
                      const pres = document.querySelectorAll('pre.mermaid');
                      if (pres.length === 0) return true;
                      return Array.from(pres).every(el =>
                        el.querySelector('svg') || el.querySelector('.merr'));
                    }""",
                    timeout=60000,
                )
            except Exception:
                pass  # pull whatever rendered
            await page.wait_for_timeout(300)

            # Layout safety net (Bug 2): if a heading's container is a fixed-height
            # block (>100px taller than the heading itself) or the heading carries an
            # oversized top margin, collapse it so no dead gap ships in the PDF.
            gap_report = await page.evaluate("""() => {
              const MAX_GAP = 100;
              const PAGE_BREAK_GAP = 600; // anything larger is a real page break
              const fixed = [];
              for (const h of Array.from(document.querySelectorAll('h1,h2,h3,h4'))) {
                const parent = h.parentElement;
                if (!parent || parent.tagName === 'BODY' || parent.tagName === 'HTML') continue;
                if (parent.classList.contains('cover')) continue;
                const ph = parent.getBoundingClientRect().height;
                const hh = h.getBoundingClientRect().height;
                if (ph > hh + MAX_GAP && parent.children.length === 1) {
                  parent.style.height = 'auto';
                  fixed.push(parent.tagName + (parent.className ? '.' + parent.className : ''));
                }
                const mt = parseFloat(getComputedStyle(h).marginTop) || 0;
                if (mt > MAX_GAP) {
                  h.style.marginTop = '6mm';
                  fixed.push(h.tagName + '#margin-top');
                }
                const sib = h.nextElementSibling;
                if (sib) {
                  const gap = sib.getBoundingClientRect().top - h.getBoundingClientRect().bottom;
                  if (gap > MAX_GAP && gap < PAGE_BREAK_GAP) {
                    const mb = parseFloat(getComputedStyle(h).marginBottom) || 0;
                    h.style.marginBottom = Math.max(0, mb - (gap - 12)) + 'px';
                    fixed.push(h.tagName + '#gap:' + Math.round(gap));
                  }
                }
              }
              return { auto_collapsed: fixed };
            }""")
            print(f"GAP_REPORT {theme_key}: {gap_report}")

            await page.pdf(
                path=out_path,
                format="A4",
                print_background=True,
                prefer_css_page_size=True,
                display_header_footer=True,
            )
        finally:
            await browser.close()
    return out_path


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def _run_coro(coro) -> None:
    import asyncio
    import concurrent.futures

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop is not None and loop.is_running():
        # Called from within an existing event loop (e.g. async FastAPI route):
        # run Playwright in a dedicated thread with its own loop.
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            ex.submit(lambda: asyncio.run(coro)).result()
    else:
        asyncio.run(coro)


def _section_pages(pdf_path: str, entries) -> Dict[str, int]:
    """Map sec-N -> printed page number (1-based) via text search in the PDF.

    Search starts after the TOC page so the TOC's own text can't match a
    heading title that also appears as a TOC entry.
    """
    import fitz

    doc = fitz.open(pdf_path)
    pages_text = [re.sub(r"\s+", " ", page.get_text()) for page in doc]
    toc_idx = next(
        (i for i, txt in enumerate(pages_text) if "Table of Contents" in txt), -1
    )
    start = toc_idx + 1
    result: Dict[str, int] = {}
    for sid, title in entries:
        needle = re.sub(r"\s+", " ", title).strip()
        found = next(
            (i for i in range(start, len(pages_text)) if needle and needle in pages_text[i]),
            None,
        )
        if found is None:
            raise ValueError(
                f"Could not locate section {sid!r} ({title!r}) in the rendered PDF"
            )
        result[sid] = found + 1
    doc.close()
    return result


def _add_outline_and_links(pdf_path: str, entries, page_map: Dict[str, int]) -> None:
    """Add PDF bookmarks (outline panel) mirroring the TOC, and guarantee that
    every TOC entry is a real clickable internal link."""
    import fitz

    doc = fitz.open(pdf_path)

    toc = [[1, title, page_map.get(sid, 1)] for sid, title in entries]
    if toc:
        doc.set_toc(toc)

    toc_page_idx = next(
        (i for i, page in enumerate(doc) if "Table of Contents" in page.get_text()), None
    )
    if toc_page_idx is not None:
        page = doc[toc_page_idx]
        # Replace whatever the renderer wrote with explicit GOTO links that every
        # PDF reader understands (page-number destinations, not named dests).
        for link in page.get_links():
            page.delete_link(link)
        for sid, title in entries:
            target = page_map.get(sid)
            if target is None:
                continue
            rects = page.search_for(title)
            if not rects:
                continue
            page.insert_link(
                {
                    "kind": fitz.LINK_GOTO,
                    "from": rects[0],
                    "page": target - 1,
                    "to": fitz.Point(0, 0),
                }
            )
    doc.save(pdf_path, incremental=True, encryption=fitz.PDF_ENCRYPT_KEEP)
    doc.close()


def _verify_toc_pages(pdf_path: str, entries, page_map: Dict[str, int]) -> None:
    """Confirm displayed TOC page numbers still match final pagination."""
    actual = _section_pages(pdf_path, entries)
    mismatches = [
        (sid, page_map.get(sid), actual[sid])
        for sid, _ in entries
        if page_map.get(sid) != actual[sid]
    ]
    if mismatches:
        raise ValueError(f"TOC page numbers are stale: {mismatches}")


def check_code_legibility(theme_key: str = "Modern Tech Blog") -> List[str]:
    """Visual regression check: render a sample code block containing every
    common token type and verify each rendered token color passes WCAG AA
    (4.5:1) against the actual code box background. Returns failing classes."""
    import asyncio
    from playwright.async_api import async_playwright

    sample = """import time
from functools import wraps

# a comment about timing
def timer(func):
    \"\"\"Docstring: return wrapped fn.\"\"\"
    @wraps(func)
    def wrapper(*args, **kwargs):
        start = time.time()  # inline comment
        result = func(*args, **kwargs)
        return result
    return wrapper

NAME = "value" + str(42)  # string, number, operator
flag = True and (3.14 <= 7)
"""
    document = build_document(
        "## Token Check\n\n```python\n" + sample + "\n```\n", theme_key
    )

    failures = []

    async def _run():
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page()
            await page.set_content(document, wait_until="load")
            report = await page.evaluate(
                """() => {
                  const box = document.querySelector('.codehilite');
                  if (!box) return { error: 'no codehilite' };
                  const bg = getComputedStyle(box).backgroundColor;
                  const bad = [];
                  for (const el of box.querySelectorAll('span[class]')) {
                    const color = getComputedStyle(el).color;
                    bad.push({ cls: el.className, color: color, bg: bg });
                  }
                  return { bg: bg, tokens: bad };
                }"""
            )
            await browser.close()
            return report

    try:
        report = asyncio.run(_run())
    except RuntimeError:
        # inside an existing loop
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            report = ex.submit(lambda: asyncio.run(_run())).result()

    def rgb_to_hex(rgb: str) -> str:
        m = re.match(r"rgba?\((\d+),\s*(\d+),\s*(\d+)", rgb)
        if not m:
            return None
        return "#%02x%02x%02x" % tuple(int(x) for x in m.groups())

    bg_hex = rgb_to_hex(report.get("bg", "")) if report.get("bg") else None
    for tok in report.get("tokens", []):
        color_hex = rgb_to_hex(tok["color"])
        if not bg_hex or not color_hex:
            continue
        if _wcag_contrast(color_hex, bg_hex) < 4.5:
            failures.append(
                f"{tok['cls']} ({color_hex}) on {bg_hex}: {_wcag_contrast(color_hex, bg_hex):.2f}"
            )
    return failures


def compile_document_to_pdf(document: str, entries) -> str:
    """Two-pass render a fully-assembled HTML document to PDF with a real TOC.

    `entries` is the ordered [(sec-N, title)] list used for the outline and
    page-number verification.
    """
    assets = os.path.join(os.path.dirname(__file__), "assets")
    pass_a = os.path.join(assets, f"ebook-{uuid.uuid4().hex[:8]}.pdf")
    out_path = os.path.join(assets, f"ebook-{uuid.uuid4().hex[:8]}.pdf")

    # Pass A: render without page numbers to discover final pagination.
    _run_coro(render_pdf("", "Modern Tech Blog", pass_a, page_map=None, document=document))
    page_map = _section_pages(pass_a, entries)

    # Pass B: render with computed page numbers in the TOC.
    _run_coro(render_pdf("", "Modern Tech Blog", out_path, page_map=page_map, document=document))

    try:
        _add_outline_and_links(out_path, entries, page_map)
        _verify_toc_pages(out_path, entries, page_map)
    except (ImportError, AttributeError) as e:  # pymupdf is optional
        print(f"POSTPROCESS_SKIP: {e}")

    if os.path.exists(pass_a):
        os.remove(pass_a)
    return out_path


def count_document_pages(document: str) -> int:
    """Render a single pass and return the number of printed pages."""
    import fitz

    assets = os.path.join(os.path.dirname(__file__), "assets")
    tmp = os.path.join(assets, f"ebook-{uuid.uuid4().hex[:8]}.pdf")
    try:
        _run_coro(render_pdf("", "Modern Tech Blog", tmp, page_map=None, document=document))
        with fitz.open(tmp) as doc:
            return doc.page_count
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def compile_markdown_to_pdf(markdown_text: str, theme: str) -> str:
    theme_key = theme if theme in THEMES else "Modern Tech Blog"
    cleaned = reject_ascii_diagram_blocks(markdown_text)
    cleaned = ensure_diagrams(cleaned)

    entries = _section_entries(
        _add_section_anchors(add_language_labels(render_markdown_to_html(cleaned), cleaned))
    )
    document = build_document(cleaned, theme_key)
    return compile_document_to_pdf(document, entries)