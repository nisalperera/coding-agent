"""Database engines, sessions, readiness checks, and lifecycle support.

Alembic exclusively owns relational schema creation and upgrades. Web workers
must never create MySQL tables or apply migrations during startup.

MySQL is authoritative for users, sessions, integrations, settings, and
pending actions. MongoDB stores agent conversations and chat messages through
Beanie.
"""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager

from beanie import init_beanie
from pymongo import AsyncMongoClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.db.chat_models import Conversation, Message


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


mongo_client: AsyncMongoClient | None = None


def get_mongo_client() -> AsyncMongoClient:
    """Return the initialized application-wide async MongoDB client."""
    if mongo_client is None:
        raise RuntimeError(
            "MongoDB has not been initialized. "
            "Call initialize_mongodb() during FastAPI lifespan startup."
        )

    return mongo_client


async def initialize_mongodb() -> None:
    """Connect to MongoDB and initialize Beanie document models.

    This function is intentionally called once from FastAPI lifespan startup.
    It does not use SQLAlchemy, Alembic, or relational schema management.

    Beanie may create MongoDB collections and indexes declared in the document
    Settings classes. It will not drop existing indexes because
    allow_index_dropping remains False by default.
    """
    global mongo_client

    if mongo_client is not None:
        return

    client = AsyncMongoClient(
        settings.MONGODB_URI,
        uuidRepresentation="standard",
    )

    try:
        database = client[settings.MONGODB_DATABASE]

        ping_response = await database.command("ping")

        if int(ping_response.get("ok", 0)) != 1:
            raise RuntimeError("MongoDB ping did not return ok=1.")

        await init_beanie(
            database=database,
            document_models=[
                Conversation,
                Message,
            ],
        )

        mongo_client = client
    except Exception:
        await client.close()
        raise


async def dispose_mongodb_client() -> None:
    """Close MongoDB sockets and clear the global client reference."""
    global mongo_client

    client = mongo_client
    mongo_client = None

    if client is not None:
        await client.close()

@contextmanager
def db_session() -> Generator[Session, None, None]:
    """Yield a transactional SQLAlchemy session and guarantee cleanup.

    This stays synchronous because the existing MySQL SQLAlchemy engine and
    SessionLocal are synchronous.
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
    """Verify MySQL connectivity without changing relational schema or data."""
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))


def dispose_database_engine() -> None:
    """Close pooled MySQL database connections during application shutdown."""
    engine.dispose()
