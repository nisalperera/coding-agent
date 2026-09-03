"""SQLAlchemy ORM models for the staged MySQL migration.

These models are additive while the application still uses SQLite repositories.
Alembic owns schema creation and migrations; importing this module performs no DDL.
"""

from __future__ import annotations

import uuid
from typing import Any, Optional

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.mysql import JSON as MySQLJSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


UUID_LENGTH = 36
SESSION_TOKEN_HASH_LENGTH = 64
PROVIDER_LENGTH = 32


def new_uuid() -> str:
    """Return a canonical UUID string suitable for CHAR(36) identifiers."""
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    """Base metadata for MySQL/InnoDB ORM tables."""

    __table_args__ = {
        "mysql_engine": "InnoDB",
        "mysql_charset": "utf8mb4",
        "mysql_collate": "utf8mb4_unicode_ci",
    }


class User(Base):
    __tablename__ = "users"

    user_id: Mapped[str] = mapped_column(
        String(UUID_LENGTH),
        primary_key=True,
        default=new_uuid,
    )
    google_sub: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    picture: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[int] = mapped_column(Integer, nullable=False)

    sessions: Mapped[list["SessionRecord"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    integrations: Mapped[list["UserIntegration"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    pending_actions: Mapped[list["PendingAction"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    integration_oauth_states: Mapped[list["IntegrationOAuthState"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class OAuthState(Base):
    __tablename__ = "oauth_states"
    __table_args__ = (
        Index("idx_oauth_states_expires_at", "expires_at"),
        Base.__table_args__,
    )

    state: Mapped[str] = mapped_column(String(255), primary_key=True)
    code_verifier: Mapped[str] = mapped_column(String(255), nullable=False)
    cookie_nonce: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)


class SessionRecord(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        Index("idx_sessions_user_id", "user_id"),
        Index("idx_sessions_expires_at", "expires_at"),
        Base.__table_args__,
    )

    token_hash: Mapped[str] = mapped_column(
        String(SESSION_TOKEN_HASH_LENGTH),
        primary_key=True,
    )
    user_id: Mapped[str] = mapped_column(
        String(UUID_LENGTH),
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    )
    expires_at: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)
    last_seen_at: Mapped[int] = mapped_column(Integer, nullable=False)

    user: Mapped["User"] = relationship(back_populates="sessions")


class UserIntegration(Base):
    __tablename__ = "user_integrations"
    __table_args__ = Base.__table_args__

    user_id: Mapped[str] = mapped_column(
        String(UUID_LENGTH),
        ForeignKey("users.user_id", ondelete="CASCADE"),
        primary_key=True,
    )
    provider: Mapped[str] = mapped_column(String(PROVIDER_LENGTH), primary_key=True)
    access_token_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token_ciphertext: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    token_expires_at: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    username: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    connected_at: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[int] = mapped_column(Integer, nullable=False)

    user: Mapped["User"] = relationship(back_populates="integrations")


class PendingAction(Base):
    __tablename__ = "pending_actions"
    __table_args__ = (
        Index("idx_pending_actions_user_id", "user_id"),
        Index("idx_pending_actions_expires_at", "expires_at"),
        Base.__table_args__,
    )

    action_id: Mapped[str] = mapped_column(
        String(UUID_LENGTH),
        primary_key=True,
        default=new_uuid,
    )
    user_id: Mapped[str] = mapped_column(
        String(UUID_LENGTH),
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    )
    tool_name: Mapped[str] = mapped_column(String(255), nullable=False)
    args: Mapped[dict[str, Any]] = mapped_column("args_json", MySQLJSON, nullable=False)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)
    expires_at: Mapped[int] = mapped_column(Integer, nullable=False)

    user: Mapped["User"] = relationship(back_populates="pending_actions")


class IntegrationOAuthState(Base):
    """Short-lived OAuth/PKCE state for a user connecting a provider account."""

    __tablename__ = "integration_oauth_states"
    __table_args__ = (
        Index("idx_integration_oauth_states_user_id", "user_id"),
        Index("idx_integration_oauth_states_expires_at", "expires_at"),
        Base.__table_args__,
    )

    state: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(UUID_LENGTH),
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    )
    provider: Mapped[str] = mapped_column(String(PROVIDER_LENGTH), nullable=False)
    code_verifier: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)

    user: Mapped["User"] = relationship(back_populates="integration_oauth_states")
