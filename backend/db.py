"""Neon Postgres persistence layer.

Render web services have an ephemeral filesystem: every deploy (and every
free-tier spin-down) wipes `backend/assets`. So the durable state of the app —
the generated book outlines and the compiled PDFs — lives in Neon Postgres
instead of on disk.

Design rules:
- The app must still boot and work with NO database configured. Every helper
  returns `None`/`[]` and logs instead of raising when `DATABASE_URL` is unset
  or Neon is briefly unreachable. Generation never fails because of the DB.
- Connections come from a small pool (Neon closes idle connections, so the pool
  is configured to recycle them rather than hold them forever).
- Schema is created on boot (`init_schema`), so a fresh Neon project needs zero
  manual SQL. `schema.sql` mirrors it for people who prefer the Neon SQL editor.
"""

from __future__ import annotations

import json
import os
import threading
from typing import Any, Dict, List, Optional

_POOL = None
_POOL_LOCK = threading.Lock()
_SCHEMA_READY = False
_LAST_ERROR: Optional[str] = None


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS ebooks (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title          text        NOT NULL,
    subtitle       text,
    template_id    text        NOT NULL,
    target_pages   integer     NOT NULL DEFAULT 10,
    page_count     integer,
    section_count  integer     NOT NULL DEFAULT 0,
    source_content text,
    book           jsonb       NOT NULL,
    book_bn        jsonb,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ebooks_created_at_idx ON ebooks (created_at DESC);

CREATE TABLE IF NOT EXISTS ebook_pdfs (
    ebook_id   uuid PRIMARY KEY REFERENCES ebooks (id) ON DELETE CASCADE,
    pdf        bytea       NOT NULL,
    byte_size  integer     NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS generation_events (
    id          bigserial PRIMARY KEY,
    kind        text        NOT NULL,
    status      text        NOT NULL,
    ebook_id    uuid REFERENCES ebooks (id) ON DELETE SET NULL,
    duration_ms integer,
    detail      text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS generation_events_created_at_idx
    ON generation_events (created_at DESC);
"""


def database_url() -> str:
    """Neon connection string. Render/Neon both call it DATABASE_URL."""
    return (
        os.environ.get("DATABASE_URL")
        or os.environ.get("NEON_DATABASE_URL")
        or os.environ.get("POSTGRES_URL")
        or ""
    ).strip()


def is_configured() -> bool:
    return bool(database_url())


def _normalized_url(url: str) -> str:
    """libpq understands `postgresql://`; some dashboards hand out other
    prefixes. Neon requires TLS, so `sslmode=require` is added when missing —
    except for local databases, which usually have no TLS at all.
    """
    for bad, good in (("postgres://", "postgresql://"), ("postgresql+psycopg://", "postgresql://")):
        if url.startswith(bad):
            url = good + url[len(bad) :]
    is_local = "@localhost" in url or "@127.0.0.1" in url or "@host.docker.internal" in url
    if "sslmode=" not in url and not is_local:
        url += ("&" if "?" in url else "?") + "sslmode=require"
    return url


def _get_pool():
    """Lazily build the connection pool. Returns None when unavailable."""
    global _POOL, _LAST_ERROR
    if _POOL is not None:
        return _POOL
    url = database_url()
    if not url:
        return None
    with _POOL_LOCK:
        if _POOL is not None:
            return _POOL
        try:
            from psycopg_pool import ConnectionPool

            _POOL = ConnectionPool(
                conninfo=_normalized_url(url),
                min_size=0,
                max_size=int(os.environ.get("DB_POOL_MAX", "5")),
                max_idle=60.0,       # Neon drops idle connections; recycle first
                max_lifetime=1800.0,
                timeout=15.0,
                open=True,
                check=None,
            )
        except Exception as e:  # driver missing, bad URL, unreachable host...
            _LAST_ERROR = f"{type(e).__name__}: {e}"
            print(f"DB_POOL_INIT_FAILED {_LAST_ERROR}")
            _POOL = None
    return _POOL


class _NoDb(Exception):
    pass


def _connection():
    pool = _get_pool()
    if pool is None:
        raise _NoDb("no database configured")
    return pool.connection()


def init_schema() -> bool:
    """Create tables if they do not exist. Safe to call on every boot."""
    global _SCHEMA_READY, _LAST_ERROR
    if _SCHEMA_READY:
        return True
    if not is_configured():
        print("DB_DISABLED: DATABASE_URL not set — running without a library")
        return False
    try:
        with _connection() as conn:
            with conn.cursor() as cur:
                cur.execute(SCHEMA_SQL)
                # Add columns introduced after the initial schema (idempotent).
                cur.execute(
                    "ALTER TABLE ebooks ADD COLUMN IF NOT EXISTS book_bn jsonb"
                )
            conn.commit()
        _SCHEMA_READY = True
        _LAST_ERROR = None
        print("DB_READY: Neon schema verified")
        return True
    except Exception as e:
        _LAST_ERROR = f"{type(e).__name__}: {e}"
        print(f"DB_SCHEMA_FAILED {_LAST_ERROR}")
        return False


def health() -> Dict[str, Any]:
    """Never raises — used by /api/health."""
    if not is_configured():
        return {"configured": False, "connected": False, "detail": "DATABASE_URL not set"}
    try:
        with _connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT count(*) FROM ebooks")
                total = cur.fetchone()[0]
        return {"configured": True, "connected": True, "ebooks": int(total)}
    except Exception as e:
        return {
            "configured": True,
            "connected": False,
            "detail": f"{type(e).__name__}: {e}",
        }


# ---------------------------------------------------------------------------
# Writes (fire-and-forget: a DB hiccup must never break a generation)
# ---------------------------------------------------------------------------


def save_ebook(
    book: dict,
    template_id: str,
    target_pages: int,
    page_count: Optional[int],
    source_content: str = "",
    book_bn: Optional[dict] = None,
) -> Optional[str]:
    """Insert a generated book; returns its id (uuid string) or None."""
    if not is_configured():
        return None
    try:
        with _connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO ebooks (title, subtitle, template_id, target_pages,
                                        page_count, section_count, source_content, book, book_bn)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
                    RETURNING id
                    """,
                    (
                        (book.get("title") or "Untitled ebook")[:500],
                        (book.get("subtitle") or "")[:1000],
                        template_id,
                        int(target_pages),
                        page_count,
                        len(book.get("sections") or []),
                        (source_content or "")[:20000],
                        json.dumps(book),
                        json.dumps(book_bn) if book_bn else None,
                    ),
                )
                new_id = cur.fetchone()[0]
            conn.commit()
        return str(new_id)
    except Exception as e:
        print(f"DB_SAVE_EBOOK_FAILED {type(e).__name__}: {e}")
        return None


def store_pdf(ebook_id: str, pdf_bytes: bytes) -> bool:
    """Upsert the compiled PDF so it survives restarts/redeploys."""
    if not is_configured() or not ebook_id or not pdf_bytes:
        return False
    try:
        with _connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO ebook_pdfs (ebook_id, pdf, byte_size)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (ebook_id)
                    DO UPDATE SET pdf = EXCLUDED.pdf,
                                  byte_size = EXCLUDED.byte_size,
                                  created_at = now()
                    """,
                    (ebook_id, pdf_bytes, len(pdf_bytes)),
                )
            conn.commit()
        return True
    except Exception as e:
        print(f"DB_STORE_PDF_FAILED {type(e).__name__}: {e}")
        return False


def log_event(
    kind: str,
    status: str,
    ebook_id: Optional[str] = None,
    duration_ms: Optional[int] = None,
    detail: str = "",
) -> None:
    if not is_configured():
        return
    try:
        with _connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO generation_events (kind, status, ebook_id, duration_ms, detail)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (kind[:60], status[:40], ebook_id, duration_ms, (detail or "")[:2000]),
                )
            conn.commit()
    except Exception as e:
        print(f"DB_LOG_EVENT_FAILED {type(e).__name__}: {e}")


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def list_ebooks(limit: int = 20) -> List[Dict[str, Any]]:
    """Recent library entries (no book JSON, no PDF bytes — keep it light)."""
    if not is_configured():
        return []
    limit = max(1, min(int(limit), 100))
    try:
        with _connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT e.id, e.title, e.subtitle, e.template_id, e.target_pages,
                           e.page_count, e.section_count, e.created_at,
                           (p.ebook_id IS NOT NULL) AS has_pdf, p.byte_size
                    FROM ebooks e
                    LEFT JOIN ebook_pdfs p ON p.ebook_id = e.id
                    ORDER BY e.created_at DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
                rows = cur.fetchall()
        return [
            {
                "id": str(r[0]),
                "title": r[1],
                "subtitle": r[2],
                "template_id": r[3],
                "target_pages": r[4],
                "page_count": r[5],
                "section_count": r[6],
                "created_at": r[7].isoformat() if r[7] else None,
                "has_pdf": bool(r[8]),
                "pdf_bytes": r[9],
            }
            for r in rows
        ]
    except Exception as e:
        print(f"DB_LIST_FAILED {type(e).__name__}: {e}")
        return []


def get_ebook(ebook_id: str) -> Optional[Dict[str, Any]]:
    if not is_configured():
        return None
    try:
        with _connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, title, subtitle, template_id, target_pages,
                           page_count, book, book_bn, created_at
                    FROM ebooks WHERE id = %s
                    """,
                    (ebook_id,),
                )
                row = cur.fetchone()
        if not row:
            return None
        book = row[6]
        if isinstance(book, (str, bytes)):
            book = json.loads(book)
        book_bn = row[7]
        if isinstance(book_bn, (str, bytes)):
            book_bn = json.loads(book_bn)
        return {
            "id": str(row[0]),
            "title": row[1],
            "subtitle": row[2],
            "template_id": row[3],
            "target_pages": row[4],
            "page_count": row[5],
            "book": book,
            "book_bn": book_bn,
            "created_at": row[8].isoformat() if row[8] else None,
        }
    except Exception as e:
        print(f"DB_GET_FAILED {type(e).__name__}: {e}")
        return None


def get_pdf(ebook_id: str) -> Optional[bytes]:
    if not is_configured():
        return None
    try:
        with _connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT pdf FROM ebook_pdfs WHERE ebook_id = %s", (ebook_id,))
                row = cur.fetchone()
        if not row:
            return None
        return bytes(row[0])
    except Exception as e:
        print(f"DB_GET_PDF_FAILED {type(e).__name__}: {e}")
        return None


def update_ebook_book(
    ebook_id: str,
    book: dict,
    page_count: Optional[int] = None,
    section_count: Optional[int] = None,
) -> bool:
    """Persist an edited book (e.g. after a section-level AI edit).

    Only the mutable `book`/`page_count` columns are touched, so the original
    id/template/timestamps are preserved. Returns False (never raises) when the
    database is unavailable or the row is missing.
    """
    if not is_configured() or not ebook_id:
        return False
    try:
        with _connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE ebooks
                       SET book = %s::jsonb,
                           page_count = COALESCE(%s, page_count),
                           section_count = COALESCE(%s, section_count)
                     WHERE id = %s
                    """,
                    (
                        json.dumps(book),
                        int(page_count) if page_count is not None else None,
                        int(section_count) if section_count is not None else None,
                        ebook_id,
                    ),
                )
                updated = cur.rowcount
            conn.commit()
        return bool(updated)
    except Exception as e:
        print(f"DB_UPDATE_EBOOK_FAILED {type(e).__name__}: {e}")
        return False


def delete_ebook(ebook_id: str) -> bool:
    if not is_configured():
        return False
    try:
        with _connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM ebooks WHERE id = %s", (ebook_id,))
                deleted = cur.rowcount
            conn.commit()
        return bool(deleted)
    except Exception as e:
        print(f"DB_DELETE_FAILED {type(e).__name__}: {e}")
        return False
