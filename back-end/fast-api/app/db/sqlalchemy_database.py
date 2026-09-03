"""Synchronous SQLAlchemy infrastructure for the MySQL migration.

This module is additive during the staged migration. Existing SQLite repositories
continue to use app.db.database until Task 4 ports them to SQLAlchemy. Alembic,
not application startup, owns schema creation and upgrades.
"""

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings


def _build_connect_args() -> dict[str, int]:
    """Return driver-compatible connection options for the configured database URL."""
    if settings.DATABASE_URL.startswith("mysql+pymysql://"):
        return {"connect_timeout": settings.DATABASE_CONNECT_TIMEOUT_S}
    return {}


engine: Engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=settings.DATABASE_POOL_SIZE,
    max_overflow=settings.DATABASE_MAX_OVERFLOW,
    pool_recycle=settings.DATABASE_POOL_RECYCLE_S,
    connect_args=_build_connect_args(),
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


@contextmanager
def db_session() -> Iterator[Session]:
    """Yield a transactional SQLAlchemy session.

    The caller receives a committed transaction on success. Exceptions trigger a
    rollback, and every session is closed before returning to the caller.
    """
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
    """Raise when the configured database cannot serve a lightweight query."""
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))


def dispose_database_engine() -> None:
    """Dispose pooled database connections during application shutdown."""
    engine.dispose()
