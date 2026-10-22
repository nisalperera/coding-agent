"""Destructive fixtures are allowed only inside a marked disposable sandbox."""
from __future__ import annotations
import time
from collections.abc import Iterator
import pytest
from tests_support.environment import configure_environment
from tests_support.sandbox import assert_relational_sandbox, assert_mongo_sandbox

# Refuse unsafe or missing targets before importing app/database modules.
TARGETS = configure_environment()

from pymongo import MongoClient
from sqlalchemy import delete
from sqlalchemy.orm import Session
from app.db.base import Base
from app.db.database import SessionLocal
from app.db.models import common, projects

def clean_relational():
    with SessionLocal() as session:
        assert_relational_sandbox(session, TARGETS)
        # Children first, including project revisions, projects, settings,
        # sessions and integrations, then users. Marker is in d0_safety.
        for table in reversed(Base.metadata.sorted_tables):
            session.execute(delete(table))
        session.commit()

def clean_mongo():
    with MongoClient(TARGETS.mongodb_uri, serverSelectionTimeoutMS=3000) as client:
        assert_mongo_sandbox(client, TARGETS)
        database = client["coding_agent_test"]
        database["messages"].delete_many({})
        database["conversations"].delete_many({})

@pytest.fixture(autouse=True)
def clean_database() -> Iterator[None]:
    clean_relational()
    clean_mongo()
    try:
        yield
    finally:
        clean_mongo()
        clean_relational()

@pytest.fixture
def db(clean_database) -> Iterator[Session]:
    session = SessionLocal()
    try:
        assert_relational_sandbox(session, TARGETS)
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

@pytest.fixture
def now() -> int:
    return int(time.time())

@pytest.fixture
def google_claims() -> dict[str, object]:
    return {
        "sub": "google-subject-123", "email": "engineer@example.com",
        "email_verified": True, "name": "Test Engineer",
        "picture": "https://example.test/avatar.png",
    }
