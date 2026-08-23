"""Business branding: validation + sanitization.

Branding is OPTIONAL metadata attached to an ebook (`book["branding"]`). It is
application-controlled data — NEVER AI-generated content — so every value that
reaches this module is strictly validated and normalized before it can touch
HTML, CSS, or a PDF footer:

- text fields: control characters stripped, whitespace collapsed, hard length caps
- colors: only #rgb / #rrggbb hex values are accepted (no arbitrary CSS)
- logo: only well-formed PNG/JPEG/WebP data URLs under a size cap (magic-byte
  checked, not trusting the declared MIME)
- URLs are never rendered as links; website/contact are display text only
- unknown fields are dropped, so future client bugs cannot smuggle payloads

Books without branding keep working exactly as before: `sanitize_branding`
returns None for missing/empty/disabled branding.
"""

from __future__ import annotations

import base64
import re
from typing import Any, Dict, Optional

# Hard caps. Generous enough for real company names, tight enough that no
# single field can blow up a cover layout or footer line.
_TEXT_LIMITS = {
    "company_name": 80,
    "tagline": 100,
    "website": 120,
    "contact_text": 200,
    "copyright_text": 120,
    "footer_text": 120,
    "about_description": 800,
}

_BOOL_FIELDS = ("enabled", "about_enabled")

_HEX_COLOR_RE = re.compile(r"^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$")

_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

MAX_LOGO_DECODED_BYTES = 2 * 1024 * 1024  # 2 MB decoded cap for logos


def _clean_text(value: Any, limit: int) -> str:
    """Normalize a user-supplied text field to a safe single-line-ish string."""
    if not isinstance(value, str):
        return ""
    text = _CONTROL_CHARS_RE.sub(" ", value)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def _clean_color(value: Any) -> Optional[str]:
    """Return a normalized lowercase #rrggbb string, or None when invalid."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not _HEX_COLOR_RE.match(value):
        return None
    if len(value) == 4:  # #rgb -> #rrggbb
        return "#" + "".join(ch * 2 for ch in value[1:]).lower()
    return value.lower()


def is_valid_logo_data_url(value: Any) -> bool:
    """True only for small PNG/JPEG/WebP data URLs whose decoded bytes carry the
    right magic signature. Never trusts the declared MIME type."""
    if not isinstance(value, str):
        return False
    if len(value) > MAX_LOGO_DECODED_BYTES * 2:  # base64 inflates by ~4/3
        return False
    m = re.match(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$", value)
    if not m:
        return False
    try:
        decoded = base64.b64decode(m.group(2), validate=True)
    except Exception:
        return False
    if not decoded or len(decoded) > MAX_LOGO_DECODED_BYTES:
        return False
    if decoded[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    if decoded[:3] == b"\xff\xd8\xff":  # JPEG
        return True
    if decoded[:4] == b"RIFF" and decoded[8:12] == b"WEBP":
        return True
    return False


def sanitize_branding(raw: Any) -> Optional[Dict[str, Any]]:
    """Validate + normalize a branding payload from any source.

    Returns a canonical dict, or None when branding is absent/empty/disabled.
    Never raises: bad values are dropped field-by-field so one malformed input
    cannot take down generation or rendering.
    """
    if not isinstance(raw, dict):
        return None

    cleaned: Dict[str, Any] = {
        "enabled": raw.get("enabled") is True,
        "about_enabled": raw.get("about_enabled") is True,
        "logo_data": "",
    }
    for field, limit in _TEXT_LIMITS.items():
        cleaned[field] = _clean_text(raw.get(field), limit)
    if is_valid_logo_data_url(raw.get("logo_data")):
        cleaned["logo_data"] = raw["logo_data"].strip()
    cleaned["primary_color"] = _clean_color(raw.get("primary_color"))
    cleaned["secondary_color"] = _clean_color(raw.get("secondary_color"))

    # Branding with nothing to show is not branding: treat as disabled so the
    # renderer takes the untouched path.
    has_identity = bool(cleaned["company_name"] or cleaned["logo_data"])
    if not cleaned["enabled"] or not has_identity:
        return None
    return cleaned


def brand_has_identity(branding: Optional[Dict[str, Any]]) -> bool:
    """A usable company identity exists (name and/or logo)."""
    return bool(branding and (branding.get("company_name") or branding.get("logo_data")))


def build_footer_line(branding: Dict[str, Any]) -> str:
    """The subtle per-page footer text, e.g. 'ACME Ltd | www.acme.com'.

    Falls back to footer_text, then copyright_text, then just the company name.
    Plain text only — callers must HTML-escape before embedding in markup.
    """
    custom = branding.get("footer_text")
    if custom:
        return custom
    parts = []
    if branding.get("company_name"):
        parts.append(branding["company_name"])
    if branding.get("website"):
        parts.append(branding["website"])
    if parts:
        return " | ".join(parts)
    return branding.get("copyright_text", "")
