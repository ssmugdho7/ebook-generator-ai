"""Markdown -> HTML -> PDF pipeline.

Decouples content parsing, diagram rendering, and final layout:

  raw markdown
      -> python-markdown (real parser) -> HTML
      -> mermaid blocks rendered to SVG images via Playwright + mermaid.js
      -> Chromium print-to-PDF respecting CSS page-break rules

All themes, typography, syntax highlighting, and pagination are controlled in CSS.
"""

import base64
import os
import re
import tempfile
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
# Runtime environment (local machine vs. container on Render)
# ---------------------------------------------------------------------------

# Chromium flags that make the headless browser survive inside a small
# container: no sandbox (no user namespaces available), /tmp instead of the tiny
# default /dev/shm, and no GPU probing.
CHROMIUM_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-extensions",
    "--no-first-run",
    "--no-zygote",
    "--font-render-hinting=none",
    "--allow-file-access-from-files",
]

_cached_browser = None
_cached_playwright = None


def pdf_workdir() -> str:
    """Directory for intermediate/output PDFs.

    Defaults to the system temp dir so nothing is ever written into the app
    directory (Render's filesystem is ephemeral and should stay read-mostly);
    override with PDF_OUTPUT_DIR if you mount a Render disk.
    """
    path = os.environ.get("PDF_OUTPUT_DIR") or os.path.join(
        tempfile.gettempdir(), "ebook-writer"
    )
    os.makedirs(path, exist_ok=True)
    return path


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
    """Generate a styled mermaid flowchart from a heading when none exists."""
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
    parts = [
        "flowchart LR",
        "    A[\"" + nodes[0] + "\"]:::input --> B[\"" + (nodes[1] if len(nodes) > 1 else "Explore") + "\"]:::process",
    ]
    if len(nodes) > 2:
        parts.append(f"    B --> C[\"{nodes[2]}\"]:::storage")
        if len(nodes) > 3:
            parts.append(f"    C --> D[\"{nodes[3]}\"]:::output")
            last = "D"
        else:
            last = "C"
    else:
        last = "B"
    parts.append(f"    {last} --> E[\"Key Takeaways\"]:::takeaway")
    parts.append("    classDef input fill:#dbeafe,stroke:#2563eb,color:#1e3a5f")
    parts.append("    classDef process fill:#d1fae5,stroke:#059669,color:#064e3b")
    parts.append("    classDef storage fill:#ede9fe,stroke:#7c3aed,color:#3b0764")
    parts.append("    classDef output fill:#fef3c7,stroke:#d97706,color:#78350f")
    parts.append("    classDef takeaway fill:#ecfdf5,stroke:#10b981,color:#064e3b,stroke-width:3px")
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


_CLASSDEF_COLOR_RE = re.compile(
    r"(classDef\s+\w+\s+[^{]*?fill:\s*)(#[0-9a-fA-F]{3,6})([^,}]*)"
    r"(,\s*color:\s*#[0-9a-fA-F]{3,6})?"
)


def fix_mermaid_text_contrast(source: str) -> str:
    """Rewrite every `classDef ... fill:...,color:...` so the label color is
    guaranteed to contrast with the box fill (WCAG AA, 4.5:1).

    Also handles `style ... fill:...,color:...` lines. This is the systemic
    guard that catches LLM-generated diagram colors that would otherwise be
    invisible (e.g. dark text on a dark fill). It only rewrites the text color
    (never the fill/stroke), choosing black or white — whichever contrasts
    better — so the diagram's meaning is preserved.
    """
    from templates import hex_to_6

    lines = source.split("\n")
    for i, ln in enumerate(lines):
        stripped = ln.strip()
        if not (stripped.startswith("classDef") or stripped.startswith("style")):
            continue
        fill_m = re.search(r"fill:\s*(#[0-9a-fA-F]{3,6})", ln)
        if not fill_m:
            continue
        fill = hex_to_6(fill_m.group(1))
        best = _pick_best_text_color(fill)
        if re.search(r"color:\s*#[0-9a-fA-F]{3,6}", ln):
            ln = re.sub(r"color:\s*#[0-9a-fA-F]{3,6}", f"color:{best}", ln)
        else:
            # no explicit color: mermaid uses the theme default, which may be
            # invisible on this fill — pin an explicit contrast-safe one.
            ln = ln.rstrip().rstrip(",") + f",color:{best}"
        lines[i] = ln
    return "\n".join(lines)


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
        definition = fix_mermaid_text_contrast(definition)
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


def _darken_to_contrast(color: str, bg: str, target: float = 4.5) -> str:
    """Blend `color` toward black until it passes WCAG AA against `bg`."""
    if _wcag_contrast(color, bg) >= target:
        return color
    r, g, b = int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16)
    for step in range(1, 100):
        k = step / 100.0
        c = "#%02x%02x%02x" % (
            max(0, int(r * (1 - k))),
            max(0, int(g * (1 - k))),
            max(0, int(b * (1 - k))),
        )
        if _wcag_contrast(c, bg) >= target:
            return c
    return "#000000"


def _lighten_to_contrast(color: str, bg: str, target: float = 4.5) -> str:
    """Blend `color` toward white until it passes WCAG AA against `bg`."""
    if _wcag_contrast(color, bg) >= target:
        return color
    r, g, b = int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16)
    for step in range(1, 100):
        k = step / 100.0
        c = "#%02x%02x%02x" % (
            min(255, int(r + (255 - r) * k)),
            min(255, int(g + (255 - g) * k)),
            min(255, int(b + (255 - b) * k)),
        )
        if _wcag_contrast(c, bg) >= target:
            return c
    return "#ffffff"


def _ensure_contrast(color: str, bg: str, target: float = 4.5) -> str:
    """Return a text color that passes WCAG AA against `bg`, preserving hue.

    If the color is already readable it is returned unchanged; otherwise it is
    darkened on light backgrounds and lightened on dark backgrounds.
    """
    if _wcag_contrast(color, bg) >= target:
        return color
    from templates import hex_to_6

    color = hex_to_6(color)
    bg = hex_to_6(bg)
    lum_c = _lum_chan(color)
    lum_b = _lum_chan(bg)
    if lum_c <= lum_b:
        return _darken_to_contrast(color, bg, target)
    return _lighten_to_contrast(color, bg, target)


def _lum_chan(hexc: str) -> float:
    """Relative luminance of a #rrggbb color (for direction picking)."""
    r, g, b = int(hexc[1:3], 16), int(hexc[3:5], 16), int(hexc[5:7], 16)

    def _ch(c: float) -> float:
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * _ch(r) + 0.7152 * _ch(g) + 0.0722 * _ch(b)


def _header_colors(accent: str, target: float = 4.5) -> tuple:
    """Pick (bg, fg) for a solid header so the label passes WCAG AA."""
    if _wcag_contrast("#ffffff", accent) >= target:
        return accent, "#ffffff"
    if _wcag_contrast("#1f2430", accent) >= target:
        return accent, "#1f2430"
    bg = _darken_to_contrast(accent, "#ffffff", target)
    if _wcag_contrast("#ffffff", bg) >= target:
        return bg, "#ffffff"
    return accent, "#1f2430"


def _pick_best_text_color(bg: str) -> str:
    """Return the text color (black or white) with the best contrast on `bg`.

    This is the auto-adjust fallback for dynamically generated elements
    (diagram boxes, connector labels) whose colors aren't known up front:
    whichever of white / dark passes WCAG AA (or is closest to passing) wins.
    """
    c_white = _wcag_contrast("#ffffff", bg)
    c_dark = _wcag_contrast("#1f2430", bg)
    if c_white >= 4.5:
        return "#ffffff"
    if c_dark >= 4.5:
        return "#1f2430"
    return "#ffffff" if c_white >= c_dark else "#1f2430"


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


def verify_theme_text_contrast(theme_key: str) -> List[str]:
    """Return text/background pairings that fail WCAG AA (4.5:1)."""
    t = THEMES[theme_key]
    failures = []

    def check(fg, bg, label):
        if _wcag_contrast(fg, bg) < 4.5:
            failures.append(f"{label}: {fg} on {bg}")

    check(t["text"], t["page_bg"], "body text")
    check(t["heading"], t["page_bg"], "headings")
    check(t["muted"], t["page_bg"], "muted text")
    check(t["muted"], t["block_bg"], "muted in blockquote")
    check(t["heading"], t["block_bg"], "inline code chips")
    check(_ensure_contrast(t["accent"], t["page_bg"]), t["page_bg"], "accent-as-text")
    th_bg, th_fg = _header_colors(t["accent"])
    check(th_fg, th_bg, "table header")
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
        "accent": "#5f5ee8",
        "muted": "#5f6c7d",
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


def mermaid_theme_vars(template: dict) -> dict:
    """Build mermaid `themeVariables` from a template's palette so diagrams
    inherit the active design instead of shipping hardcoded colors.

    Every text color is contrast-guarded against its fill (4.5:1); if a fill
    can't carry a colored text safely, black or white is chosen automatically.
    """
    dia = template.get("diagram", {})
    pal = template.get("palette", {})
    box_fill = dia.get("box_fill", "#ffffff")
    box_stroke = dia.get("box_stroke", pal.get("accent", "#4f46e5"))
    sub_bg = dia.get("sub_bg", pal.get("accent_soft", "#eef2ff"))
    text = dia.get("text", pal.get("text", "#1f2430"))
    edge = dia.get("edge", box_stroke)

    # node + actor text must read on their fill
    node_text = _ensure_contrast(text, box_fill)
    sub_text = _ensure_contrast(text, sub_bg)
    return {
        "fontFamily": "Inter, system-ui, sans-serif",
        "fontSize": "14px",
        "primaryColor": box_fill,
        "primaryTextColor": node_text,
        "primaryBorderColor": box_stroke,
        "lineColor": edge,
        "edgeLabelBackground": "#ffffff",
        "edgeLabelForeground": _pick_best_text_color("#ffffff"),
        "secondaryColor": sub_bg,
        "secondaryTextColor": sub_text,
        "tertiaryColor": sub_bg,
        "tertiaryTextColor": sub_text,
        "noteBkgColor": sub_bg,
        "noteTextColor": sub_text,
        "noteBorderColor": box_stroke,
        "actorBkg": box_fill,
        "actorBorder": box_stroke,
        "actorTextColor": node_text,
        "signalColor": edge,
        "signalTextColor": _pick_best_text_color("#ffffff"),
    }


def mermaid_fallback_colors(template: dict) -> list:
    """A palette of (fill, stroke, text) used by the box-and-arrow fallback
    diagram. Every entry's text is contrast-guarded against its fill."""
    pal = template.get("palette", {})
    dia = template.get("diagram", {})
    accent = pal.get("accent", "#4f46e5")
    box_stroke = dia.get("box_stroke", accent)
    edge = dia.get("edge", box_stroke)
    box_fill = dia.get("box_fill", "#ffffff")
    base_fills = [
        box_fill,
        dia.get("sub_bg", pal.get("accent_soft", "#eef2ff")),
        pal.get("block_bg", "#f8fafc"),
        pal.get("accent_soft", "#eef2ff"),
        pal.get("code_bg", "#f6f7fb"),
    ]
    colors = []
    for fill in base_fills:
        colors.append(
            {
                "fill": fill,
                "stroke": box_stroke if fill != box_fill else accent,
                "text": _pick_best_text_color(fill),
            }
        )
    return colors


# ---------------------------------------------------------------------------
# Bengali font embedding (so Bangla ebooks render glyphs in the PDF/preview)
# ---------------------------------------------------------------------------

def _bengali_font_path() -> str:
    """Location of the bundled Noto Sans Bengali font. Override with
    BENGALI_FONT_PATH (e.g. in the Docker image)."""
    return os.environ.get(
        "BENGALI_FONT_PATH",
        os.path.join(os.path.dirname(__file__), "assets", "fonts", "NotoSansBengali-Regular.ttf"),
    )


def bengali_font_face() -> str:
    """Return an @font-face rule embedding Noto Sans Bengali as a data URI.

    Returns "" when the font file is missing, so non-Bengali builds are
    unaffected and the feature degrades gracefully.
    """
    path = _bengali_font_path()
    if not os.path.exists(path):
        return ""
    try:
        with open(path, "rb") as f:
            data = base64.b64encode(f.read()).decode("ascii")
    except Exception:
        return ""
    return (
        "@font-face {\n"
        "  font-family: 'Noto Sans Bengali';\n"
        "  font-style: normal;\n"
        "  font-weight: 400;\n"
        "  font-display: swap;\n"
        f"  src: url(data:font/ttf;base64,{data}) format('truetype');\n"
        "}\n"
    )


def css_from_vars(v: dict, bengali: bool = False) -> str:
    """Build the shared stylesheet from a vars dict.

    `v` needs: page_bg, text, heading, accent, accent_soft, muted, block_bg,
    code_bg, code_text, code_line, title_page_bg, font, heading_font, mono,
    radius, callouts, diagram. Templates produce these via templates.template_css_vars.
    When `bengali` is True, Noto Sans Bengali is embedded so Bangla glyphs render.
    """
    accent = v.get("accent")
    accent_soft = v.get("accent_soft", v.get("block_bg"))
    radius = v.get("radius", "3mm")
    callouts = v.get("callouts", {})
    dia = v.get("diagram", {})

    # ---- WCAG AA text guards: no text may sit on a background it can't pass
    page_bg = v.get("page_bg", "#fff")
    block_bg = v.get("block_bg", "#fafafa")
    accent_text = _ensure_contrast(accent or "#000", page_bg)  # h3, links, TOC nums
    muted = v.get("muted", "#666")
    muted = _ensure_contrast(muted, page_bg)
    muted = _ensure_contrast(muted, block_bg)  # blockquote sits on block_bg
    th_bg, th_fg = _header_colors(accent or "#000")
    err_color = _ensure_contrast("#b00020", page_bg)

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
h3 { font-size: 12pt; margin: 5mm 0 2mm; color: ACCENT_TEXT; }

p { margin: 0 0 2.5mm; text-align: justify; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
li { margin-bottom: 1mm; orphans: 2; widows: 2; }
blockquote { margin: 3mm 0; padding: 2.5mm 4mm; border-left: 3px solid ACCENT;
             background: BLOCK_BG; color: MUTED; font-style: italic; }
strong { color: HEADING; }
a { color: ACCENT_TEXT; text-decoration: none; }
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
code { font-family: MONO; font-size: 8.8pt; background: BLOCK_BG; color: HEADING;
       padding: 0 1.5mm; border-radius: 1.5mm; }
.codehilite code { background: transparent; padding: 0; color: inherit; }

/* language label stays glued to code */
figure.codeblock { margin: 3mm 0; break-inside: avoid; page-break-inside: avoid; }
figure.codeblock figcaption { font-family: sans-serif; font-size: 7pt; color: MUTED;
    text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 1mm; }
figure.codeblock .codehilite { margin: 0; }

/* ---------- tables ---------- */
table { width: 100%; border-collapse: collapse; margin: 3mm 0; font-size: 9pt;
        break-inside: avoid; page-break-inside: avoid; }
th { background: TH_BG; color: TH_FG; text-align: left; padding: 2mm 2.5mm; }
td { border-bottom: 0.4pt solid CODE_LINE; padding: 2mm 2.5mm; }
tr:nth-child(even) td { background: BLOCK_BG; }

/* ---------- mermaid diagrams: real SVG images ---------- */
.mermaid { text-align: center; margin: 4mm 0; break-inside: avoid;
           page-break-inside: avoid; background: transparent; }
.mermaid svg { display: block; margin: 0 auto; max-width: 100%; height: auto;
               filter: drop-shadow(0 1px 2px rgba(0,0,0,0.06)); }
.mermaid .node rect, .mermaid .node polygon, .mermaid .node circle {
  stroke-width: 2px; }
.mermaid .edgePath .path { stroke: #64748b; stroke-width: 2px; }
.mermaid .edgeLabel { font-size: 12px; background: #fff; color: #1e293b; padding: 2px 6px;
                       border-radius: 4px; }
.mermaid .cluster rect { stroke-width: 2px; rx: 8; ry: 8; }
.merr { color: ERR_COLOR; font-size: 9pt; }

/* ---------- AI-generated images ---------- */
.ebook-image { text-align: center; margin: 5mm 0; break-inside: avoid;
               page-break-inside: avoid; }
.ebook-image img { display: block; margin: 0 auto; max-width: 100%; height: auto;
                   border-radius: RADIUS; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
.ebook-image figcaption { margin-top: 2mm; font-size: 8.5pt; color: MUTED;
                           font-style: italic; }
.ebook-image-placeholder { display: flex; flex-direction: column; align-items: center;
                           justify-content: center; padding: 8mm 4mm; margin: 0 auto;
                           background: BLOCK_BG; border: 2px dashed CODE_LINE;
                           border-radius: RADIUS; max-width: 80%; }
.ebook-image-icon { font-size: 24pt; margin-bottom: 2mm; opacity: 0.6; }
.ebook-image-text { font-size: 8pt; color: MUTED; text-align: center; }

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
.toc li::before { content: counter(toc) ".  "; color: ACCENT_TEXT; font-weight: bold; }
.toc li a { color: ACCENT; text-decoration: underline; text-underline-offset: 2pt; }
.toc li a:hover { color: ACCENT; opacity: 0.8; }
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

    css = body.replace("PAGE_BG", v.get("page_bg", "#fff"))
    css = css.replace("ACCENT_TEXT", accent_text).replace("CODE_TEXT", v.get("code_text", "#111"))
    css = css.replace("ACCENT_SOFT", accent_soft).replace("ACCENT", accent or "#000")
    css = css.replace("TEXT", v.get("text", "#000"))
    css = css.replace("HEADING", v.get("heading", "#000"))
    css = css.replace("MUTED", muted)
    css = css.replace("CODE_BG", v.get("code_bg", "#f5f5f5")).replace("CODE_LINE", v.get("code_line", "#ddd"))
    css = css.replace("BLOCK_BG", v.get("block_bg", "#fafafa"))
    css = css.replace("FONT", v.get("font", "sans-serif"))
    css = css.replace("MONO", v.get("mono", "monospace"))
    css = css.replace("RADIUS", radius)
    css = css.replace("TH_BG", th_bg).replace("TH_FG", th_fg).replace("ERR_COLOR", err_color)
    css = css.replace("CC_BORDER", accent or "#000").replace("CC_BG", accent_soft)
    cover_css = cover.replace("TITLE_BG", v.get("title_page_bg", v.get("page_bg", "#fff")))
    header_css = header.replace("MUTED", muted).replace("ACCENT", accent or "#000")

    bengali_font = bengali_font_face() if bengali else ""
    if bengali:
        # Append a Bengali-capable family so Bangla glyphs render in PDFs.
        css = css.replace(
            "font-family: FONT;",
            "font-family: FONT, 'Noto Sans Bengali', sans-serif;",
            1,
        )
        # Also widen headings/mono fallbacks for any stray Bengali.
        css = css.replace(
            "font-family: HEADING_FONT;",
            "font-family: HEADING_FONT, 'Noto Sans Bengali', serif;",
            1,
        )
    return (
        header_css
        + cover_css
        + "\n"
        + bengali_font
        + "\n"
        + css
        + "\n"
        + callout_css
        + diagram_css
    )


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
    <p class="cover-sub">A story you can finish in one sitting &middot; {html_lib.escape(t['label'])}</p>
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
    template: dict = None,
    browser=None,
    header_html: str = None,
    footer_html: str = None,
) -> str:
    """Render the final styled PDF. Returns output path.

    If `document` is given (a fully-assembled HTML string from
    book.render_book_document), it is used directly instead of building the
    document from markdown+theme. When `template` is provided, mermaid
    diagrams are themed from that template's palette (colors, fonts) instead
    of a hardcoded default.

    `header_html`/`footer_html` are Chromium print header/footer templates.
    Explicit templates are always passed: without them Chromium injects its
    ugly defaults (date, document title, "about:blank") into every margin.
    The default footer is a bare centered page number — matching what the CSS
    @bottom-center rule always intended.

    If `browser` is given, it is reused instead of launching a new Chromium
    instance. The caller remains responsible for closing it.
    """
    document = document or build_document(markdown_text, theme_key, page_map)
    template = template or {}

    from playwright.async_api import async_playwright

    with open(MERMAID_SRC, "r", encoding="utf-8") as f:
        mermaid_js = f.read()

    import json as _json

    tmvars = mermaid_theme_vars(template)
    fallback_colors = mermaid_fallback_colors(template)
    tmvars_json = _json.dumps(tmvars)
    colors_json = _json.dumps(fallback_colors)

    owns_browser = browser is None
    if browser is None:
        p = await async_playwright().__aenter__()
        browser = await p.chromium.launch(args=CHROMIUM_ARGS)
    try:
        page = await browser.new_page()
        await page.set_content(document, wait_until="load")
        # inject mermaid and render diagrams into real SVG
        await page.add_script_tag(content=mermaid_js)
        js = r"""(async () => {
          if (!window.mermaid) return;
           mermaid.initialize({ startOnLoad: false, theme: 'base',
                                securityLevel: 'loose',
                                flowchart: { htmlLabels: true, useMaxWidth: false, curve: 'cardinal', padding: 15 },
                                themeVariables: __TMRVARS__ });
          const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;')
                             .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
          const buildFallbackSvg = (id, src) => {
            const labels = [];
            const re = /[A-Za-z0-9_-]+[\[({]([^\])\}]*)[\])\}]/g;
            let m;
            while ((m = re.exec(src))) {
              let l = (m[1] || '').replace(/<br\s*\/?>/gi, ' ')
                                  .replace(/<[^>]*>/g, ' ')
                                  .replace(/[{}[\]()"|`<>]/g, ' ')
                                  .replace(/\s+/g, ' ').trim().slice(0, 120);
              if (l && !labels.includes(l)) labels.push(l);
            }
            while (labels.length < 2) {
              labels.push(['Core Concept', 'Implementation', 'Key Takeaways'][labels.length]);
            }
            labels.length = Math.min(labels.length, 5);
            const colors = __COLORS__;
            // measure real text width so boxes auto-size instead of clipping
            const measure = document.createElement('canvas').getContext('2d');
            measure.font = '600 13px Inter, system-ui, sans-serif';
            const wordWidth = (word) => measure.measureText(word).width;
            const hardBreak = (word, maxW) => {
              const res = []; let cur = '';
              for (const ch of word) {
                if (cur && wordWidth(cur + ch) > maxW) { res.push(cur); cur = ch; }
                else cur += ch;
              }
              if (cur) res.push(cur);
              return res.length ? res : [word];
            };
            const wrap = (text, maxW) => {
              const lines = []; let cur = '';
              for (const w of text.split(' ')) {
                if (wordWidth(w) > maxW) {
                  if (cur) lines.push(cur);
                  cur = '';
                  const pieces = hardBreak(w, maxW);
                  for (const p of pieces) {
                    if (cur) { lines.push(cur); }
                    cur = p;
                  }
                  continue;
                }
                const t = cur ? cur + ' ' + w : w;
                if (cur && wordWidth(t) > maxW) { lines.push(cur); cur = w; }
                else cur = t;
              }
              if (cur) lines.push(cur);
              return lines.length ? lines : [''];
            };
            const maxW = 200, minW = 150, gap = 48, lineH = 18;
            const padX = 24, padY = 20, topPad = 18, botPad = 18;
            const rows = labels.map((lab) => {
              const lines = wrap(lab, maxW - 24);
              const widest = lines.reduce((a, ln) => Math.max(a, wordWidth(ln)), 0);
              const w = Math.min(maxW, Math.max(minW, widest + 24));
              const h = lines.length * lineH + topPad + botPad;
              return { lines, w, h };
            });
            const totalW = rows.reduce((a, r) => a + r.w, 0) + (rows.length - 1) * gap + padX * 2;
            const H = rows.reduce((a, r) => Math.max(a, r.h), 0) + padY * 2;
            const mid = H / 2, aid = 'a' + id.replace(/[^a-zA-Z0-9]/g, '');
            let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + totalW + '" height="' + H +
                      '" viewBox="0 0 ' + totalW + ' ' + H + '" font-family="Inter, system-ui, sans-serif">';
            svg += '<defs><marker id="' + aid + '" markerWidth="12" markerHeight="12" refX="10" refY="4" ' +
                   'orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,8 L10,4 z" fill="#64748b"/></marker></defs>';
            let x = padX;
            rows.forEach((r, i) => {
              const c = colors[i % colors.length];
              const y = mid - r.h / 2;
              svg += '<rect x="' + x + '" y="' + y + '" width="' + r.w + '" height="' + r.h +
                     '" rx="10" fill="' + c.fill + '" stroke="' + c.stroke + '" stroke-width="2"/>';
              r.lines.forEach((ln, j) => {
                svg += '<text x="' + (x + r.w / 2) + '" y="' + (y + topPad + lineH * (j + 0.5)) +
                       '" text-anchor="middle" dominant-baseline="middle" font-size="13" font-weight="600" fill="' +
                       c.text + '">' + esc(ln) + '</text>';
              });
              if (i > 0) {
                svg += '<line x1="' + (x - gap + 4) + '" y1="' + mid + '" x2="' + (x - 4) + '" y2="' + mid +
                       '" stroke="#94a3b8" stroke-width="2" marker-end="url(#' + aid + ')"/>';
              }
              x += r.w + gap;
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
            // Check for error patterns - be specific to avoid false positives
            const hasSyntaxError = /syntax\s+error/i.test(svg);
            const hasMermaidVersion = /mermaid\s+version/i.test(svg);
            const hasParseError = /parse\s+error/i.test(svg);
            const hasRenderError = /error\s+rendering/i.test(svg);
            // Check doubled chars only in visible text (strip all tags + attrs to avoid CSS/filter hex color false positives)
            const svgVisibleText = svg.replace(/<[^>]*>/g, '').replace(/#[0-9a-fA-F]{4,}/gi, '').replace(/hsl\([^)]*\)/gi, '');
            const hasDoubledChars = /(\w)\1{3,}/.test(svgVisibleText);
            const textCount = (svg.match(/<text/g) || []).length;
            const rectCount = (svg.match(/<rect/g) || []).length;
            // Error if: specific error text, doubled chars in text, or no shapes at all
            const bad = hasSyntaxError || hasMermaidVersion || hasParseError || hasRenderError || hasDoubledChars || !svg || (rectCount === 0 && textCount > 5);
            el.innerHTML = bad ? buildFallbackSvg(el.id, def) : svg;
            // mermaid.render leaves its temp container div (id 'svg-<el.id>')
            // in the body holding the error graphic; remove it so a "Syntax
            // error in text" block never leaks into the rendered page.
            const mermaidTemp = document.getElementById('svg-' + el.id);
            if (mermaidTemp && !mermaidTemp.contains(el)) mermaidTemp.remove();
          }
          // Fix mermaid viewBox clipping: expand viewBox to cover all content
          for (const el of Array.from(document.querySelectorAll('pre.mermaid svg'))) {
            try {
              const bbox = el.getBBox();
              const vb = el.getAttribute('viewBox');
              if (!vb) continue;
              const parts = vb.split(/[\s,]+/).map(Number);
              const vx = parts[0], vy = parts[1], vw = parts[2], vh = parts[3];
              let newVx = Math.min(vx, bbox.x - 5);
              let newVy = Math.min(vy, bbox.y - 5);
              let newVw = Math.max(vw, bbox.x + bbox.width + 10 - newVx);
              let newVh = Math.max(vh, bbox.y + bbox.height + 10 - newVy);
              if (newVx < vx || newVy < vy || newVw > vw || newVh > vh) {
                el.setAttribute('viewBox', newVx + ' ' + newVy + ' ' + newVw + ' ' + newVh);
              }
            } catch(e) {}
          }
          // ---- Overflow safety net: any label wider than its box gets
          // wrapped at the box width so text is never clipped, regardless of
          // how long a generated label is. Runs on every diagram type
          // (flowcharts, comparison boxes, decision trees, clusters, edges).
          for (const svg of Array.from(document.querySelectorAll('pre.mermaid svg'))) {
            for (const node of Array.from(svg.querySelectorAll('g.node, g.edgeLabel, g.cluster, g.actor'))) {
              try {
                const fo = node.querySelector('foreignObject');
                if (!fo) continue;
                const label = fo.querySelector('div') || fo;
                const shape = node.querySelector('rect, polygon');
                const boxW = shape ? shape.getBBox().width
                                   : (parseFloat(fo.getAttribute('width')) || 0);
                if (!boxW || label.scrollWidth <= label.clientWidth + 2) continue;
                label.style.whiteSpace = 'normal';
                label.style.wordWrap = 'break-word';
                label.style.overflowWrap = 'break-word';
                label.style.maxWidth = Math.max(40, boxW - 6) + 'px';
              } catch(e) {}
            }
          }
          // Walk every text node inside a mermaid SVG and, if its color does
          // not contrast with its background, force a readable color.
          for (const svg of Array.from(document.querySelectorAll('pre.mermaid svg'))) {
            // node boxes: find shapes carrying an explicit fill and the text they contain
            const shapes = svg.querySelectorAll('g.node rect, g.node polygon, g.node circle, g>rect, g>circle');
            for (const shape of shapes) {
              const fill = toHex(shape.getAttribute('fill') || shape.style.fill);
              if (!fill) continue;
              const g = shape.closest('g');
              if (!g) continue;
              const texts = Array.from(g.querySelectorAll('text'));
              for (const t of texts) {
                const col = toHex(t.getAttribute('fill') || t.style.fill);
                if (!col || contrastRatio(col, fill) >= 4.5) continue;
                t.setAttribute('fill', bestText(fill));
              }
            }
            // edge labels sit on a white pill; force dark text if invisible
            for (const lab of Array.from(svg.querySelectorAll('.edgeLabel, g.edgeLabel'))) {
              lab.style.color = '#1e293b';
              const texts = Array.from(lab.querySelectorAll('text'));
              for (const t of texts) t.setAttribute('fill', '#1e293b');
            }
          }
        })()"""
        js = js.replace("__TMRVARS__", tmvars_json).replace("__COLORS__", colors_json)
        await page.evaluate(js)

        # wait until every mermaid pre has been replaced by an svg (or an error)
        try:
            await page.wait_for_function(
                """() => {
                  const pres = document.querySelectorAll('pre.mermaid');
                  if (pres.length === 0) return true;
                  return Array.from(pres).every(el => {
                    // Check if replaced with SVG or has error class
                    if (el.querySelector('svg')) return true;
                    if (el.classList.contains('merr')) return true;
                    // Check if contains error text
                    const text = el.textContent || '';
                    if (/syntax|error|version|parse/i.test(text)) return true;
                    return false;
                  });
                }""",
                timeout=15000,
            )
        except Exception:
            pass  # pull whatever rendered
        await page.wait_for_timeout(200)

        # Make sure every embedded image has finished loading before we
        # snapshot the page to PDF. `data:` URLs decode synchronously, but
        # Chromium still needs a tick to paint them into the layout.
        try:
            await page.wait_for_function(
                """() => Array.from(document.images).every(img => img.complete)""",
                timeout=10000,
            )
        except Exception:
            pass

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
            header_template=header_html or "<span></span>",
            footer_template=footer_html
            or '<div style="width:100%;text-align:center;font-size:9px;color:#94a3b8;">'
            '<span class="pageNumber"></span></div>',
        )
    finally:
        if owns_browser:
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

    def _strip_md(s: str) -> str:
        """Strip markdown inline formatting for PDF text matching."""
        s = re.sub(r"`([^`]+)`", r"\1", s)
        s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
        s = re.sub(r"\*([^*]+)\*", r"\1", s)
        s = html_lib.unescape(s)
        return re.sub(r"\s+", " ", s).strip()

    doc = fitz.open(pdf_path)
    pages_text = [re.sub(r"\s+", " ", page.get_text()) for page in doc]
    pages_text = [re.sub(r"\s+", " ", page.get_text()) for page in doc]
    toc_idx = next(
        (i for i, txt in enumerate(pages_text) if "Table of Contents" in txt), -1
    )
    start = toc_idx + 1
    result: Dict[str, int] = {}
    last = start  # fallback page if a title can't be located (e.g. non-Latin text)
    for sid, title in entries:
        needle = _strip_md(title)
        found = next(
            (i for i in range(start, len(pages_text)) if needle and needle in pages_text[i]),
            None,
        )
        if found is None:
            # Don't abort the whole PDF over a missing TOC page number — just
            # inherit the previous section's page so the outline still builds.
            print(f"SECTION_LOOKUP_MISS: {sid} ({title!r})")
            found = last
        last = found
        result[sid] = found + 1
    doc.close()
    return result


def _add_outline_and_links(pdf_path: str, entries, page_map: Dict[str, int]) -> None:
    """Add PDF bookmarks (outline panel) mirroring the TOC, and guarantee that
    every TOC entry is a real clickable internal link."""
    import fitz

    def _strip_md(s: str) -> str:
        """Strip markdown inline formatting for PDF text matching."""
        s = re.sub(r"`([^`]+)`", r"\1", s)
        s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
        s = re.sub(r"\*([^*]+)\*", r"\1", s)
        s = html_lib.unescape(s)
        return re.sub(r"\s+", " ", s).strip()

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
            rects = page.search_for(_strip_md(title))
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
    """Confirm displayed TOC page numbers still match final pagination.

    In single-pass mode `page_map` may be empty, in which case there are no
    page numbers to verify and we skip the check entirely.
    """
    if not page_map:
        return
    actual = _section_pages(pdf_path, entries)
    mismatches = [
        (sid, page_map.get(sid), actual[sid])
        for sid, _ in entries
        if page_map.get(sid) not in (None, actual[sid])
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
            browser = await p.chromium.launch(args=CHROMIUM_ARGS)
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


def compile_document_to_pdf(
    document: str,
    entries,
    template: dict = None,
    header_html: str = None,
    footer_html: str = None,
) -> str:
    """Render a fully-assembled HTML document to PDF with working TOC links.

    Renders the PDF once, then discovers the actual page numbers for each
    section by searching the rendered text, and finally adds PDF bookmarks
    plus clickable TOC links that point to the correct pages.

    `header_html`/`footer_html` are Chromium print header/footer templates
    (see render_pdf). When `strip_first_page_footer_needle` matches, the brand
    footer is removed from page 1 only — used when a full-bleed custom cover
    image would otherwise have footer text stamped over it.
    """
    workdir = pdf_workdir()
    out_path = os.path.join(workdir, f"ebook-{uuid.uuid4().hex[:8]}.pdf")

    _run_coro(
        render_pdf(
            "",
            "Modern Tech Blog",
            out_path,
            page_map=None,
            document=document,
            template=template,
            header_html=header_html,
            footer_html=footer_html,
        )
    )

    # Discover actual section page numbers from the rendered PDF text.
    page_map: Dict[str, int] = {}
    try:
        page_map = _section_pages(out_path, entries)
    except Exception as e:
        print(f"PAGE_MAP_FAIL: {e}")

    try:
        _add_outline_and_links(out_path, entries, page_map)
        _verify_toc_pages(out_path, entries, page_map)
    except (ImportError, AttributeError) as e:  # pymupdf is optional
        print(f"POSTPROCESS_SKIP: {e}")

    return out_path


def strip_footer_from_first_page(pdf_path: str, needle: str = None) -> None:
    """Remove footer text from page 1 only, in place.

    Chromium print headers/footers repeat on EVERY page — including a full-bleed
    cover-image page where stamped text looks broken. Page 1 is always the
    cover, so this redacts the footer band (bottom ~10mm): the brand line when
    `needle` matches it, plus any leftover footer fragments like the page
    number. Images are untouched (PDF_REDACT_IMAGE_NONE), so the cover photo
    keeps every pixel. Best effort: failures are logged, never fatal.
    """
    try:
        import fitz

        mm = 72 / 25.4
        with fitz.open(pdf_path) as doc:
            if doc.page_count < 2:
                return
            page = doc[0]
            w, h = page.rect.width, page.rect.height
            band = fitz.Rect(0, h - 12 * mm, w, h - 1 * mm)

            rects = []
            if needle:
                rects = [
                    r for r in page.search_for(needle) if r.intersects(band)
                ]
            if not rects:
                # Whole-band fallback: redact every text fragment in the strip.
                rects = [
                    fitz.Rect(x0, y0, x1, y1)
                    for x0, y0, x1, y1, *_ in page.get_text("words")
                    if fitz.Rect(x0, y0, x1, y1).intersects(band)
                ]
            if not rects:
                return
            for r in rects:
                page.add_redact_annot(fitz.Rect(r.x0 - 4, r.y0 - 2, r.x1 + 4, r.y1 + 2))
            page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)
            doc.saveIncr()
    except Exception as e:
        print(f"FOOTER_STRIP_SKIP: {e}")


def count_document_pages(document: str, template: dict = None) -> int:
    """Render a single pass and return the number of printed pages."""
    import fitz

    tmp = os.path.join(pdf_workdir(), f"ebook-{uuid.uuid4().hex[:8]}.pdf")
    try:
        _run_coro(render_pdf("", "Modern Tech Blog", tmp, page_map=None, document=document, template=template))
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