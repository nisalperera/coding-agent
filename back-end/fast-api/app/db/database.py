"""SQLAlchemy database engine, sessions, and readiness support.

Alembic exclusively owns schema creation and upgrades. Web workers must never
create tables or apply migrations during startup.
"""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings


def _database_connect_args() -> dict[str, int]:
    """Return PyMySQL-compatible connection arguments."""
    return {
        "connect_timeout": settings.DATABASE_CONNECT_TIMEOUT_S,
    }


engine: Engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=settings.DATABASE_POOL_SIZE,
    max_overflow=settings.DATABASE_MAX_OVERFLOW,
    pool_recycle=settings.DATABASE_POOL_RECYCLE_S,
    connect_args=_database_connect_args(),
)


SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


@contextmanager
def db_session() -> Generator[Session, None, None]:
    """Yield a transactional session and guarantee lifecycle cleanup."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def assert_database_ready() -> None:
    """Verify database connectivity without changing schema or data."""
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))


def dispose_database_engine() -> None:
    """Close pooled database connections during application shutdown."""
    engine.dispose()
