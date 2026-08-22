"""Lightweight JWT auth — users table, bcrypt passwords, token lifecycle.

No external service dependency.  Secrets are derived from JWT_SECRET env var
(auto-generated on first boot when unset).
"""

from __future__ import annotations

import os
import secrets
import time
from typing import Optional

import bcrypt
import jwt

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_SECRET = os.environ.get("JWT_SECRET", "").strip()
if not _SECRET:
    _SECRET = secrets.token_hex(32)
    print(f"AUTH_WARN: JWT_SECRET not set — generated ephemeral key (tokens won't survive restart).")

_ALGORITHM = "HS256"
_TOKEN_TTL = 7 * 24 * 3600  # 7 days


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except Exception:
        return False


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def create_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "iat": int(time.time()),
        "exp": int(time.time()) + _TOKEN_TTL,
    }
    return jwt.encode(payload, _SECRET, algorithm=_ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    """Return payload dict or None if invalid/expired."""
    try:
        return jwt.decode(token, _SECRET, algorithms=[_ALGORITHM])
    except Exception:
        return None
