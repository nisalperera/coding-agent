"""
SQLite persistence layer replacing AWS Cognito, DynamoDB, and EC2 state:
users, oauth_states, sessions, user_integrations, pending_actions.

SQLite is appropriate for a single local process. Move to Postgres/MySQL
before running multiple concurrent worker processes against this data.
"""
import sqlite3
from contextlib import contextmanager
from typing import Iterator

from app.core.config import settings


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(str(settings.SQLITE_DB_PATH), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


@contextmanager
def db_connection() -> Iterator[sqlite3.Connection]:
    connection = _connect()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialise_database() -> None:
    settings.SQLITE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with db_connection() as connection:
        connection.executescript(
            """
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                google_sub TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL,
                email_verified INTEGER NOT NULL DEFAULT 0,
                name TEXT,
                picture TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS oauth_states (
                state TEXT PRIMARY KEY,
                code_verifier TEXT NOT NULL,
                cookie_nonce TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                last_seen_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS user_integrations (
                user_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                access_token TEXT NOT NULL,
                username TEXT,
                connected_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, provider),
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS pending_actions (
                action_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                args_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
            CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);
            CREATE INDEX IF NOT EXISTS idx_pending_actions_user_id ON pending_actions(user_id);
            CREATE INDEX IF NOT EXISTS idx_pending_actions_expires_at ON pending_actions(expires_at);
            """
        )
        _migrate_oauth_states_cookie_nonce(connection)


def _migrate_oauth_states_cookie_nonce(connection: sqlite3.Connection) -> None:
    columns = {row["name"] for row in connection.execute("PRAGMA table_info(oauth_states)").fetchall()}
    if "cookie_nonce" not in columns:
        connection.execute("ALTER TABLE oauth_states ADD COLUMN cookie_nonce TEXT")
        connection.execute("DELETE FROM oauth_states")
