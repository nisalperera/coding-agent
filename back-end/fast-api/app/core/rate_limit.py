"""
In-memory sliding-window rate limiter (OWASP API4:2023). Process-local: move
to SQLite/Redis if you ever run multiple worker processes.
"""
import time
from collections import defaultdict

from app.core.config import settings

_rate_limits: dict[str, list[float]] = defaultdict(list)


def check_rate_limit(user_id: str) -> bool:
    now = time.monotonic()
    timestamps = _rate_limits[user_id]
    _rate_limits[user_id] = [t for t in timestamps if now - t < settings.RATE_LIMIT_WINDOW_S]
    if len(_rate_limits[user_id]) >= settings.RATE_LIMIT_MAX_REQUESTS:
        return False
    _rate_limits[user_id].append(now)
    return True
