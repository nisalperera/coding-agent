"""SQLAlchemy declarative metadata for the FastAPI persistence migration.

Models are introduced incrementally. Alembic owns schema creation and upgrades,
and the existing SQLite repositories remain active until their Task 4 port.
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class for FastAPI persistence models."""

