"""Fail-closed target and ownership checks; no application imports."""
from dataclasses import dataclass, field
import hmac
import re
from urllib.parse import urlsplit

DATABASE = "coding_agent_test"
ROLE = "coding_agent_test"

class SafetyError(RuntimeError):
    pass

@dataclass(frozen=True)
class Targets:
    database_url: str = field(repr=False)
    mongodb_uri: str = field(repr=False)
    token: str = field(repr=False)

def validate_postgres_url(value):
    try:
        url = urlsplit(value)
        valid = (url.scheme == "postgresql+psycopg" and url.hostname == "postgres-test"
                 and url.port == 5432 and url.username == ROLE and bool(url.password)
                 and url.path == "/" + DATABASE and not url.query and not url.fragment)
    except (ValueError, TypeError, AttributeError):
        valid = False
    if not valid:
        raise SafetyError("Refusing SQL target: only the dedicated postgres-test service, test role and test database are accepted")

def validate_mongo_uri(value):
    try:
        url = urlsplit(value)
        valid = (url.scheme == "mongodb" and url.hostname == "mongo-test" and url.port == 27017
                 and url.path in ("", "/") and url.username is None and url.password is None
                 and not url.query and not url.fragment and "," not in url.netloc)
    except (ValueError, TypeError, AttributeError):
        valid = False
    if not valid:
        raise SafetyError("Refusing Mongo target: only the dedicated mongo-test service is accepted")

def validate_environment(env, *, require_token=True):
    if env.get("D0_TEST_SANDBOX") != "1":
        raise SafetyError("Use the dedicated Docker/CI sandbox; direct application-database tests are disabled")
    if env.get("PYTEST_XDIST_WORKER"):
        raise SafetyError("This cleanup strategy supports serial tests only")
    sql = env.get("TEST_DATABASE_URL", "")
    mongo = env.get("TEST_MONGODB_URI", "")
    validate_postgres_url(sql)
    validate_mongo_uri(mongo)
    if env.get("TEST_MONGODB_DATABASE") != DATABASE:
        raise SafetyError("Refusing Mongo database: dedicated test name required")
    token = env.get("TEST_SANDBOX_TOKEN", "")
    if require_token and not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", token):
        raise SafetyError("Sandbox ownership token is missing; use the guarded test runner")
    return Targets(sql, mongo, token)

def verify_identity(database, role):
    if database != DATABASE or role != ROLE:
        raise SafetyError("Connected SQL database or role does not match the disposable target")

def verify_marker(stored, expected):
    if (not isinstance(stored, str) or not isinstance(expected, str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", stored)
                or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", expected)
                or not hmac.compare_digest(stored, expected)):
        raise SafetyError("Sandbox marker missing or belongs to a different test run")

def assert_relational_sandbox(session, targets):
    from sqlalchemy import text
    validate_postgres_url(session.get_bind().url.render_as_string(hide_password=False))
    database, role = session.execute(text("SELECT current_database(), current_user")).one()
    verify_identity(database, role)
    marker = session.execute(text("SELECT token FROM d0_safety.marker WHERE id=1")).scalar_one_or_none()
    verify_marker(marker, targets.token)

def assert_mongo_sandbox(client, targets):
    validate_mongo_uri(targets.mongodb_uri)
    if client.address != ("mongo-test", 27017):
        raise SafetyError("Connected Mongo server is not the disposable service")
    row = client[DATABASE]["_d0_test_sandbox"].find_one({"_id": "r0"})
    verify_marker(row.get("token") if row else None, targets.token)

def prepare_relational_sandbox(engine, targets):
    from sqlalchemy import text
    validate_postgres_url(engine.url.render_as_string(hide_password=False))
    with engine.begin() as connection:
        database, role = connection.execute(text("SELECT current_database(), current_user")).one()
        verify_identity(database, role)
        exists = connection.execute(text("SELECT to_regclass('d0_safety.marker')")).scalar()
        if exists:
            marker = connection.execute(text("SELECT token FROM d0_safety.marker WHERE id=1")).scalar_one_or_none()
            verify_marker(marker, targets.token)
            return
        count = connection.execute(text("SELECT count(*) FROM pg_tables WHERE schemaname='public'")).scalar_one()
        if count:
            raise SafetyError("Refusing to adopt an existing SQL schema without this run's marker")
        connection.execute(text("CREATE SCHEMA IF NOT EXISTS d0_safety"))
        connection.execute(text("CREATE TABLE d0_safety.marker (id integer PRIMARY KEY CHECK (id=1), token text NOT NULL)"))
        connection.execute(text("INSERT INTO d0_safety.marker (id, token) VALUES (1, :token)"), {"token": targets.token})

def prepare_mongo_sandbox(client, targets):
    validate_mongo_uri(targets.mongodb_uri)
    if client.address != ("mongo-test", 27017):
        raise SafetyError("Connected Mongo server is not the disposable service")
    database = client[DATABASE]
    row = database["_d0_test_sandbox"].find_one({"_id": "r0"})
    if row:
        verify_marker(row.get("token"), targets.token)
        return
    if database.list_collection_names():
        raise SafetyError("Refusing to adopt an existing Mongo database without this run's marker")
    database["_d0_test_sandbox"].insert_one({"_id": "r0", "token": targets.token})
