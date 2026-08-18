"""Template system: bundled design systems, not just color swaps.

A template defines a color palette, font pairing, icon/illustration style,
a matching code syntax-highlighting token set (Part 3), and diagram/callout
styling. Templates live as structured JSON in `templates/` so adding a new
one is just a new config file.
"""

import json
import os
import re
from typing import List

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")


# ---------------------------------------------------------------------------
# Token model: every Pygments token type must resolve to an explicit color.
# ---------------------------------------------------------------------------

# token-name (used in template JSON) -> Pygments token object
TOKEN_MAP = {
    "text": "Token.Text",
    "comment": "Token.Comment",
    "preproc": "Token.Comment.Preproc",
    "keyword": "Token.Keyword",
    "keyword_type": "Token.Keyword.Type",
    "operator": "Token.Operator",
    "punctuation": "Token.Punctuation",
    "name": "Token.Name",
    "builtin": "Token.Name.Builtin",
    "function": "Token.Name.Function",
    "class": "Token.Name.Class",
    "namespace": "Token.Name.Namespace",
    "decorator": "Token.Name.Decorator",
    "attribute": "Token.Name.Attribute",
    "tag": "Token.Name.Tag",
    "variable": "Token.Name.Variable",
    "constant": "Token.Name.Constant",
    "number": "Token.Literal.Number",
    "string": "Token.Literal.String",
    "docstring": "Token.Literal.String.Doc",
    "string_escape": "Token.Literal.String.Escape",
    "interpol": "Token.Literal.String.Interpol",
    "error": "Token.Error",
    "heading": "Token.Generic.Heading",
    "deleted": "Token.Generic.Deleted",
    "inserted": "Token.Generic.Inserted",
    "emph": "Token.Generic.Emph",
}

# Fallback defaults (per style family) so every token type always has a color.
DEFAULT_LIGHT_TOKENS = {
    "text": "#1f2430",
    "comment": "#64748b",
    "preproc": "#047857",
    "keyword": "#7c3aed",
    "keyword_type": "#0e7490",
    "operator": "#475569",
    "punctuation": "#475569",
    "name": "#1f2430",
    "builtin": "#b91c1c",
    "function": "#1d4ed8",
    "class": "#0e7490",
    "namespace": "#0e7490",
    "decorator": "#9333ea",
    "attribute": "#1d4ed8",
    "tag": "#b91c1c",
    "variable": "#1d4ed8",
    "constant": "#0e7490",
    "number": "#b45309",
    "string": "#047857",
    "docstring": "#4b5563",
    "string_escape": "#9333ea",
    "interpol": "#9333ea",
    "error": "#b91c1c",
    "heading": "#0e7490",
    "deleted": "#b91c1c",
    "inserted": "#047857",
    "emph": "#b45309",
}

DEFAULT_DARK_TOKENS = {
    "text": "#e2e8f0",
    "comment": "#7f8ea3",
    "preproc": "#a78bfa",
    "keyword": "#ff7edb",
    "keyword_type": "#66d9ef",
    "operator": "#f8f8f2",
    "punctuation": "#f8f8f2",
    "name": "#f8f8f2",
    "builtin": "#66d9ef",
    "function": "#a6e22e",
    "class": "#66d9ef",
    "namespace": "#66d9ef",
    "decorator": "#e6db74",
    "attribute": "#a6e22e",
    "tag": "#f92672",
    "variable": "#f8f8f2",
    "constant": "#ae81ff",
    "number": "#ae81ff",
    "string": "#a6e22e",
    "docstring": "#7f8ea3",
    "string_escape": "#e6db74",
    "interpol": "#e6db74",
    "error": "#ff7edb",
    "heading": "#66d9ef",
    "deleted": "#f92672",
    "inserted": "#a6e22e",
    "emph": "#e6db74",
}

ALL_TOKEN_NAMES = sorted(TOKEN_MAP)


# ---------------------------------------------------------------------------
# Loading / normalization
# ---------------------------------------------------------------------------


def hex_to_6(color: str) -> str:
    """Normalize #rgb -> #rrggbb."""
    color = (color or "").strip()
    if re.fullmatch(r"#[0-9a-fA-F]{3}", color):
        return "#" + "".join(c * 2 for c in color[1:])
    return color.lower()


def _callout_defaults(dark: bool) -> dict:
    if dark:
        return {
            "info": {"bg": "#16233c", "border": "#3b82f6"},
            "tip": {"bg": "#123126", "border": "#10b981"},
            "warn": {"bg": "#33271a", "border": "#f59e0b"},
            "example": {"bg": "#251f3d", "border": "#8b5cf6"},
        }
    return {
        "info": {"bg": "#eef2ff", "border": "#6366f1"},
        "tip": {"bg": "#ecfdf5", "border": "#10b981"},
        "warn": {"bg": "#fffbeb", "border": "#f59e0b"},
        "example": {"bg": "#f5f3ff", "border": "#8b5cf6"},
    }


def normalize_template(raw: dict) -> dict:
    """Fill in defaults so every field the renderer needs is present."""
    dark = bool(raw.get("dark", False))
    code_style = raw.get("code", {}).get("style", "dark" if dark else "light")
    default_tokens = DEFAULT_DARK_TOKENS if code_style == "dark" else DEFAULT_LIGHT_TOKENS
    tokens = dict(default_tokens)
    tokens.update(raw.get("code", {}).get("tokens", {}) or {})

    pal = raw.get("palette", {})
    callouts = dict(_callout_defaults(dark))
    callouts.update(pal.get("callout", {}) or {})

    return {
        "id": raw["id"],
        "label": raw["label"],
        "dark": dark,
        "description": raw.get("description", ""),
        "fonts": {
            "heading": raw.get("fonts", {}).get("heading", "sans-serif"),
            "body": raw.get("fonts", {}).get("body", "sans-serif"),
            "mono": raw.get("fonts", {}).get(
                "mono", '"SF Mono", "Fira Code", Menlo, Consolas, monospace'
            ),
        },
        "palette": {
            "page_bg": hex_to_6(pal.get("page_bg", "#0b1120" if dark else "#ffffff")),
            "text": hex_to_6(pal.get("text", "#cbd5e1" if dark else "#1f2430")),
            "heading": hex_to_6(pal.get("heading", "#f1f5f9" if dark else "#111827")),
            "accent": hex_to_6(pal.get("accent", "#38bdf8" if dark else "#4f46e5")),
            "accent_soft": hex_to_6(pal.get("accent_soft", "#16233c" if dark else "#eef2ff")),
            "muted": hex_to_6(pal.get("muted", "#7f8ea3" if dark else "#6b7280")),
            "block_bg": hex_to_6(pal.get("block_bg", "#111a2c" if dark else "#f8fafc")),
            "code_bg": hex_to_6(pal.get("code_bg", "#0f172a" if dark else "#f6f7fb")),
            "code_text": hex_to_6(pal.get("code_text", "#f8f8f2" if dark else "#1f2430")),
            "code_line": hex_to_6(pal.get("code_line", "#1e293b" if dark else "#e5e7eb")),
            "title_page_bg": hex_to_6(pal.get("title_page_bg", pal.get("page_bg", "#ffffff"))),
        },
        "callouts": callouts,
        "radius": raw.get("radius", "8px"),
        "icon_style": raw.get("icon_style", "line"),
        "diagram": {
            "box_fill": hex_to_6(raw.get("diagram", {}).get("box_fill", "#ffffff" if not dark else "#111a2c")),
            "box_stroke": hex_to_6(raw.get("diagram", {}).get("box_stroke", "#4f46e5" if not dark else "#38bdf8")),
            "edge": hex_to_6(raw.get("diagram", {}).get("edge", "#4f46e5" if not dark else "#38bdf8")),
            "text": hex_to_6(raw.get("diagram", {}).get("text", "#1f2430" if not dark else "#e2e8f0")),
            "sub_bg": hex_to_6(raw.get("diagram", {}).get("sub_bg", "#eef2ff" if not dark else "#16233c")),
        },
        "code": {"style": code_style, "tokens": tokens},
    }


def load_template(template_id: str) -> dict:
    """Load + normalize a template by id. Raises ValueError if unknown."""
    path = os.path.join(TEMPLATES_DIR, f"{template_id}.json")
    if not os.path.exists(path):
        raise ValueError(f"Unknown template: {template_id}")
    with open(path, "r", encoding="utf-8") as f:
        return normalize_template(json.load(f))


def list_templates() -> list:
    """Summary payload for the template-picker step (Part 1)."""
    out = []
    for name in sorted(os.listdir(TEMPLATES_DIR)):
        if not name.endswith(".json"):
            continue
        tid = name[:-5]
        try:
            t = load_template(tid)
        except Exception:
            continue
        pal = t["palette"]
        out.append(
            {
                "id": t["id"],
                "label": t["label"],
                "dark": t["dark"],
                "description": t["description"],
                "fonts": t["fonts"],
                "icon_style": t["icon_style"],
                "code_style": t["code"]["style"],
                "palette": {
                    "page_bg": pal["page_bg"],
                    "accent": pal["accent"],
                    "heading": pal["heading"],
                    "text": pal["text"],
                    "code_bg": pal["code_bg"],
                    "accent_soft": pal.get("accent_soft"),
                    "muted": pal.get("muted"),
                    "block_bg": pal.get("block_bg"),
                    "code_text": pal.get("code_text"),
                    "code_line": pal.get("code_line"),
                    "title_page_bg": pal.get("title_page_bg"),
                },
            }
        )
    return out


# ---------------------------------------------------------------------------
# Pygments style + contrast verification (Part 3)
# ---------------------------------------------------------------------------


def template_pygments_style(template: dict):
    from pipeline import _make_style

    from pygments.token import Token

    def _resolve(name):
        return getattr(Token, name.split(".")[1]) if name.startswith("Token.") else Token.Text

    styles = {_resolve(tname): hex_to_6(color) for tname, color in template["code"]["tokens"].items()}
    # full pygments coverage so no token falls back to an invisible default
    for tname in TOKEN_MAP.values():
        styles.setdefault(_resolve(tname), styles.get(Token.Text))
    styles[Token.Text] = template["code"]["tokens"].get("text", "#e2e8f0")
    return _make_style(styles, {})


def template_pygments_css(template: dict) -> str:
    from pygments.formatters import HtmlFormatter

    return HtmlFormatter(style=template_pygments_style(template)).get_style_defs(".codehilite")


def verify_template_code_contrast(template: dict) -> List[str]:
    """Return token colors that fail WCAG AA (4.5:1) against the code box."""
    from pipeline import _wcag_contrast

    bg = template["palette"]["code_bg"]
    failures = []
    for name in ALL_TOKEN_NAMES:
        color = hex_to_6(template["code"]["tokens"].get(name, ""))
        if color and _wcag_contrast(color, bg) < 4.5:
            failures.append(f"{name} ({color})")
    return failures


def verify_template_text_contrast(template: dict) -> List[str]:
    """Return human-readable failures for every text/background pairing the
    stylesheet creates (body, headings, muted, accent-as-text, table headers,
    callouts, blockquotes, diagrams). Enforces WCAG AA (4.5:1)."""
    from pipeline import _wcag_contrast, _header_colors, _ensure_contrast

    p = template["palette"]
    d = template["diagram"]
    failures = []

    def check(fg, bg, label):
        if _wcag_contrast(fg, bg) < 4.5:
            failures.append(f"{label}: {fg} on {bg}")

    check(p["text"], p["page_bg"], "body text")
    check(p["heading"], p["page_bg"], "headings")
    check(p["muted"], p["page_bg"], "muted text")
    check(p["muted"], p["block_bg"], "muted in blockquote")
    check(p["text"], p["block_bg"], "even table rows / code chips")
    check(p["heading"], p["block_bg"], "inline code chips")
    check(_ensure_contrast(p["accent"], p["page_bg"]), p["page_bg"], "accent-as-text")

    th_bg, th_fg = _header_colors(p["accent"])
    check(th_fg, th_bg, "table header")

    for kind, spec in template["callouts"].items():
        check(p["text"], spec.get("bg", p["accent_soft"]), f"callout {kind} text")

    check(p["heading"], p["accent_soft"], "takeaway heading")
    check(d["text"], d["box_fill"], "diagram text on box")
    check(d["text"], d["sub_bg"], "diagram text on sub-box")
    return failures


# ---------------------------------------------------------------------------
# Template CSS (reuses the shared stylesheet builder in pipeline.py)
# ---------------------------------------------------------------------------


def template_css_vars(template: dict) -> dict:
    pal = template["palette"]
    return {
        "label": template["label"],
        "page_bg": pal["page_bg"],
        "text": pal["text"],
        "heading": pal["heading"],
        "accent": pal["accent"],
        "accent_soft": pal["accent_soft"],
        "muted": pal["muted"],
        "block_bg": pal["block_bg"],
        "code_bg": pal["code_bg"],
        "code_text": pal["code_text"],
        "code_line": pal["code_line"],
        "title_page_bg": pal["title_page_bg"],
        "font": template["fonts"]["body"],
        "heading_font": template["fonts"]["heading"],
        "mono": template["fonts"]["mono"],
        "radius": template["radius"],
        "callouts": template["callouts"],
        "diagram": template["diagram"],
    }


def build_template_css(template: dict, bengali: bool = False) -> str:
    from pipeline import css_from_vars

    return css_from_vars(template_css_vars(template), bengali=bengali)
