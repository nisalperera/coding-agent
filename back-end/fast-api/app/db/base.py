"""SQLAlchemy ORM models for the staged MySQL migration.

These models are additive while the application still uses SQLite repositories.
Alembic owns schema creation and migrations; importing this module performs no DDL.
"""

from __future__ import annotations

import uuid
from typing import ClassVar

from datetime import datetime, timezone

from sqlalchemy.orm import DeclarativeBase

UUID_LENGTH = 36
SESSION_TOKEN_HASH_LENGTH = 64
PROVIDER_LENGTH = 32


def new_uuid() -> str:
    """Return a canonical UUID string suitable for CHAR(36) identifiers."""
    return str(uuid.uuid4())


def current_time_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


class Base(DeclarativeBase):
    """Base metadata for MySQL/InnoDB ORM tables."""

    __table_args__: ClassVar[dict[str, str]] = {
        "mysql_engine": "InnoDB",
        "mysql_charset": "utf8mb4",
        "mysql_collate": "utf8mb4_unicode_ci",
    }

