"""API key rotation manager for Gemini API."""

import os
import time
from threading import Lock
from typing import List


class APIKeyManager:
    """Rotates through multiple API keys, pausing exhausted ones."""

    def __init__(self, keys: List[str], cooldown_seconds: int = 60):
        self._keys = keys
        self._current_index = 0
        self._cooldown_seconds = cooldown_seconds
        # track when each key was last marked exhausted
        self._exhausted_until: dict[int, float] = {}
        self._lock = Lock()

    def get_key(self) -> str:
        """Return the next available key. Raises if all exhausted."""
        with self._lock:
            now = time.time()
            # try each key starting from current index
            for _ in range(len(self._keys)):
                idx = self._current_index
                expires = self._exhausted_until.get(idx, 0)
                if now >= expires:
                    # key is available
                    self._current_index = (idx + 1) % len(self._keys)
                    return self._keys[idx]
                self._current_index = (self._current_index + 1) % len(self._keys)

            # all keys exhausted — find the one that recovers soonest
            earliest = min(self._exhausted_until.values())
            wait = earliest - now
            if wait > 0:
                raise RateLimitError(
                    "We're experiencing high demand. Please try again shortly."
                )
            # should not reach here
            return self._keys[0]

    def mark_exhausted(self, key: str) -> None:
        """Mark a key as rate-limited."""
        with self._lock:
            try:
                idx = self._keys.index(key)
            except ValueError:
                return
            self._exhausted_until[idx] = time.time() + self._cooldown_seconds

    def status(self) -> List[dict]:
        """Return status of each key."""
        now = time.time()
        result = []
        for i, key in enumerate(self._keys):
            expires = self._exhausted_until.get(i, 0)
            result.append(
                {
                    "key_preview": f"...{key[-8:]}",
                    "available": now >= expires,
                    "recovers_in": max(0, int(expires - now)),
                }
            )
        return result


class RateLimitError(Exception):
    pass


def create_key_manager() -> APIKeyManager:
    """Create a key manager from GEMINI_API_KEYS env var."""
    raw = os.environ.get("GEMINI_API_KEYS", "")
    keys = [k.strip() for k in raw.split(",") if k.strip()]
    if not keys:
        # fallback to single key
        single = os.environ.get("GEMINI_API_KEY", "")
        if single:
            keys = [single]
    return APIKeyManager(keys, cooldown_seconds=60)
