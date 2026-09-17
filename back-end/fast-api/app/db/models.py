"""SQLAlchemy ORM models for the staged MySQL migration.

These models are additive while the application still uses SQLite repositories.
Alembic owns schema creation and migrations; importing this module performs no DDL.
"""

from __future__ import annotations

import uuid
from typing import Any, ClassVar, Callable

from datetime import datetime
from dataclasses import dataclass, replace
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, Float, Index, func
from sqlalchemy.dialects.mysql import BIGINT
from sqlalchemy.dialects.mysql import JSON as MySQLJSON
from sqlalchemy.ext.mutable import MutableList
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, composite

from app.schemas import (
    UserSettingsUpdateRequest,
    GitHubIntegrationSettingsUpdate,
    GitLabIntegrationSettingsUpdate,
    LlmIntegrationSettingsUpdate,
)

from app.core.integration_defaults import (
    DEFAULT_GITHUB_BASE_URL,
    DEFAULT_GITLAB_BASE_URL,
    DEFAULT_GITHUB_SCOPES,
    DEFAULT_GITLAB_SCOPES,
    DEFAULT_LLM_TEMPERATURE,
    DEFAULT_LLM_MAX_TOKENS,
    DEFAULT_LLM_STREAM_RESPONSES,
    DEFAULT_LLM_PROVIDER_NAME,
    DEFAULT_LLM_ENDPOINT_URL,
    DEFAULT_LLM_MODEL,
)

UUID_LENGTH = 36
SESSION_TOKEN_HASH_LENGTH = 64
PROVIDER_LENGTH = 32


def new_uuid() -> str:
    """Return a canonical UUID string suitable for CHAR(36) identifiers."""
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    """Base metadata for MySQL/InnoDB ORM tables."""

    __table_args__: ClassVar[dict[str, str]] = {
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

    # Generated from the email local part during registration.
    # Users do not submit this field in the frontend.
    username: Mapped[str | None] = mapped_column(
        String(64),
        unique=True,
        index=True,
        nullable=True,
    )

    # Stores an Argon2id hash only. Never store a plaintext password.
    password_hash: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
    )

    email: Mapped[str] = mapped_column(
        String(320),
        nullable=False,
        unique=True,
        index=True,
    )
    email_verified: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )
    name: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    picture: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # Nullable for users registered through email and password.
    google_sub: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        unique=True,
        index=True,
    )

    auth_provider: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="google",
    )

    created_at: Mapped[int] = mapped_column(BIGINT, nullable=False)
    updated_at: Mapped[int] = mapped_column(BIGINT, nullable=False)

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

    settings: Mapped["UserSettings | None"] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
        uselist=False,
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
    expires_at: Mapped[BIGINT] = mapped_column(BIGINT, nullable=False)
    created_at: Mapped[BIGINT] = mapped_column(BIGINT, nullable=False)


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
    expires_at: Mapped[BIGINT] = mapped_column(BIGINT, nullable=False)
    created_at: Mapped[BIGINT] = mapped_column(BIGINT, nullable=False)
    last_seen_at: Mapped[BIGINT] = mapped_column(BIGINT, nullable=False)

    user: Mapped[User] = relationship(back_populates="sessions")


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
    refresh_token_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_expires_at: Mapped[BIGINT | None] = mapped_column(BIGINT, nullable=True)
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    scopes: Mapped[str | None] = mapped_column(Text, nullable=True)
    connected_at: Mapped[BIGINT] = mapped_column(BIGINT, nullable=False)
    updated_at: Mapped[BIGINT] = mapped_column(BIGINT, nullable=False)

    user: Mapped[User] = relationship(back_populates="integrations")


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
    created_at: Mapped[BIGINT] = mapped_column(BIGINT, nullable=False)
    expires_at: Mapped[BIGINT] = mapped_column(BIGINT, nullable=False)

    user: Mapped[User] = relationship(back_populates="pending_actions")


class IntegrationOAuthState(Base):
    """Short-lived OAuth and optional PKCE state for provider connections."""

    __tablename__ = "integration_oauth_states"
    __table_args__ = (
        Index("idx_integration_oauth_states_user_id", "user_id"),
        Index("idx_integration_oauth_states_expires_at", "expires_at"),
        Index("idx_integration_oauth_states_user_provider", "user_id", "provider"),
        Base.__table_args__,
    )

    state: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(UUID_LENGTH),
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    )
    provider: Mapped[str] = mapped_column(String(PROVIDER_LENGTH), nullable=False)
    cookie_nonce: Mapped[str] = mapped_column(String(128), nullable=False)
    code_verifier: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[BIGINT] = mapped_column(BIGINT, nullable=False)
    created_at: Mapped[BIGINT] = mapped_column(BIGINT, nullable=False)

    user: Mapped[User] = relationship(back_populates="integration_oauth_states")


@dataclass
class GitHubIntegrationSettings:
    """
    In-memory composite representation of GitHub integration settings.

    The credential values are Fernet ciphertext only. They are intentionally
    not exposed through API response schemas or GET route mappers.
    """

    enabled: bool
    base_url: str
    scopes: list[str]
    client_id_ciphertext: str | None
    client_secret_ciphertext: str | None

    def __composite_values__(self) -> tuple[Any, ...]:
        return (
            self.enabled,
            self.base_url,
            self.scopes,
            self.client_id_ciphertext,
            self.client_secret_ciphertext,
        )

    @property
    def client_id_configured(self) -> bool:
        return bool(self.client_id_ciphertext)

    @property
    def client_secret_configured(self) -> bool:
        return bool(self.client_secret_ciphertext)


@dataclass
class GitLabIntegrationSettings:
    """
    In-memory composite representation of GitLab integration settings.

    The credential values are Fernet ciphertext only. They are intentionally
    not exposed through API response schemas or GET route mappers.
    """

    enabled: bool
    base_url: str
    scopes: list[str]
    client_id_ciphertext: str | None
    client_secret_ciphertext: str | None

    def __composite_values__(self) -> tuple[Any, ...]:
        return (
            self.enabled,
            self.base_url,
            self.scopes,
            self.client_id_ciphertext,
            self.client_secret_ciphertext,
        )

    @property
    def client_id_configured(self) -> bool:
        return bool(self.client_id_ciphertext)

    @property
    def client_secret_configured(self) -> bool:
        return bool(self.client_secret_ciphertext)


@dataclass
class LlmIntegrationSettings:
    """
    In-memory composite representation of LLM endpoint settings.

    api_key_ciphertext is Fernet ciphertext only. It must never be decrypted
    by GET routes or returned in a response model.
    """

    enabled: bool
    provider_name: str
    endpoint_url: str
    model: str
    temperature: float
    max_tokens: int
    stream_responses: bool
    api_key_ciphertext: str | None

    def __composite_values__(self) -> tuple[Any, ...]:
        return (
            self.enabled,
            self.provider_name,
            self.endpoint_url,
            self.model,
            self.temperature,
            self.max_tokens,
            self.stream_responses,
            self.api_key_ciphertext,
        )

    @property
    def api_key_configured(self) -> bool:
        return bool(self.api_key_ciphertext)


class UserSettings(Base):
    """
    Per-user integration configuration.

    This model groups database columns into GitHub, GitLab, and LLM composite
    settings objects. MySQL remains normalized, with separate columns for each
    provider's configuration.

    Sensitive values are Fernet ciphertext only:
    - GitHub OAuth client ID and client secret
    - GitLab OAuth application ID and OAuth secret
    - LLM provider API key

    Never serialize ciphertext columns or decrypt them in GET routes.
    """

    __tablename__ = "user_settings"

    id: Mapped[str] = mapped_column(
        String(UUID_LENGTH),
        primary_key=True,
        default=new_uuid
    )

    user_id: Mapped[str] = mapped_column(
        String(UUID_LENGTH),
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    github_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )

    github_base_url: Mapped[str] = mapped_column(
        String(2048),
        nullable=False,
        default=DEFAULT_GITHUB_BASE_URL,
        server_default=DEFAULT_GITHUB_BASE_URL,
    )

    github_scopes: Mapped[list[str]] = mapped_column(
        MutableList.as_mutable(MySQLJSON),
        nullable=False,
        default=lambda: list(DEFAULT_GITHUB_SCOPES),
    )

    github_client_id_ciphertext: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    github_client_secret_ciphertext: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    github: Mapped[GitHubIntegrationSettings] = composite(
        GitHubIntegrationSettings,
        "github_enabled",
        "github_base_url",
        "github_scopes",
        "github_client_id_ciphertext",
        "github_client_secret_ciphertext",
    )

    gitlab_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )

    gitlab_base_url: Mapped[str] = mapped_column(
        String(2048),
        nullable=False,
        default=DEFAULT_GITLAB_BASE_URL,
        server_default=DEFAULT_GITLAB_BASE_URL,
    )

    gitlab_scopes: Mapped[list[str]] = mapped_column(
        MutableList.as_mutable(MySQLJSON),
        nullable=False,
        default=lambda: list(DEFAULT_GITLAB_SCOPES),
    )

    gitlab_client_id_ciphertext: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    gitlab_client_secret_ciphertext: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    gitlab: Mapped[GitLabIntegrationSettings] = composite(
        GitLabIntegrationSettings,
        "gitlab_enabled",
        "gitlab_base_url",
        "gitlab_scopes",
        "gitlab_client_id_ciphertext",
        "gitlab_client_secret_ciphertext",
    )

    llm_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )

    llm_provider_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        default=DEFAULT_LLM_PROVIDER_NAME,
        server_default=DEFAULT_LLM_PROVIDER_NAME,
    )

    llm_endpoint_url: Mapped[str] = mapped_column(
        String(2048),
        nullable=False,
        default=DEFAULT_LLM_ENDPOINT_URL,
        server_default=DEFAULT_LLM_ENDPOINT_URL,
    )

    llm_model: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        default=DEFAULT_LLM_MODEL,
        server_default=DEFAULT_LLM_MODEL,
    )

    llm_temperature: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=DEFAULT_LLM_TEMPERATURE,
        server_default=str(DEFAULT_LLM_TEMPERATURE),
    )

    llm_max_tokens: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=DEFAULT_LLM_MAX_TOKENS,
        server_default=str(DEFAULT_LLM_MAX_TOKENS),
    )

    llm_stream_responses: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=DEFAULT_LLM_STREAM_RESPONSES,
        server_default="1",
    )

    llm_api_key_ciphertext: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    llm: Mapped[LlmIntegrationSettings] = composite(
        LlmIntegrationSettings,
        "llm_enabled",
        "llm_provider_name",
        "llm_endpoint_url",
        "llm_model",
        "llm_temperature",
        "llm_max_tokens",
        "llm_stream_responses",
        "llm_api_key_ciphertext",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    user: Mapped["User"] = relationship(
        "User",
        back_populates="settings",
    )

    @property
    def github_client_id_configured(self) -> bool:
        return self.github.client_id_configured

    @property
    def github_client_secret_configured(self) -> bool:
        return self.github.client_secret_configured

    @property
    def gitlab_client_id_configured(self) -> bool:
        return self.gitlab.client_id_configured

    @property
    def gitlab_client_secret_configured(self) -> bool:
        return self.gitlab.client_secret_configured

    @property
    def llm_api_key_configured(self) -> bool:
        return self.llm.api_key_configured

    def to_dict(self) -> dict[str, Any]:
        """Return a safe API representation without encrypted secrets."""

        return {
            "id": self.id,
            "userId": self.user_id,

            "github": {
                "enabled": self.github_enabled,
                "baseUrl": self.github_base_url,
                "scopes": list(self.github_scopes),
                "clientIdConfigured": self.github_client_id_configured,
                "clientSecretConfigured": self.github_client_secret_configured,
            },

            "gitlab": {
                "enabled": self.gitlab_enabled,
                "baseUrl": self.gitlab_base_url,
                "scopes": list(self.gitlab_scopes),
                "clientIdConfigured": self.gitlab_client_id_configured,
                "clientSecretConfigured": self.gitlab_client_secret_configured,
            },

            "llm": {
                "enabled": self.llm_enabled,
                "providerName": self.llm_provider_name,
                "endpointUrl": self.llm_endpoint_url,
                "model": self.llm_model,
                "temperature": self.llm_temperature,
                "maxTokens": self.llm_max_tokens,
                "streamResponses": self.llm_stream_responses,
                "apiKeyConfigured": self.llm_api_key_configured,
            },

            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "lastSeenAt": self.last_seen_at,
        }

    def apply_github_gitlab_updates(
        self,
        gh_gl_update: (
            GitHubIntegrationSettingsUpdate
            | GitLabIntegrationSettingsUpdate
        ),
        encrypt: Callable[[str], str],
    ) -> None:
        changes = gh_gl_update.model_dump(
            exclude_unset=True,
            by_alias=False,
            exclude={
                "client_id",
                "client_secret",
                "clear_client_id",
                "clear_client_secret",
            },
        )

        if gh_gl_update.client_id is not None:
            changes["client_id_ciphertext"] = encrypt(
                gh_gl_update.client_id.get_secret_value()
            )

        if gh_gl_update.client_secret is not None:
            changes["client_secret_ciphertext"] = encrypt(
                gh_gl_update.client_secret.get_secret_value()
            )

        if gh_gl_update.clear_client_id:
            changes["client_id_ciphertext"] = None

        if gh_gl_update.clear_client_secret:
            changes["client_secret_ciphertext"] = None

        if not changes:
            return

        if isinstance(gh_gl_update, GitHubIntegrationSettingsUpdate):
            self.github = replace(self.github, **changes)
            return

        if isinstance(gh_gl_update, GitLabIntegrationSettingsUpdate):
            self.gitlab = replace(self.gitlab, **changes)
            return

        raise TypeError(
            f"Unsupported integration settings update: "
            f"{type(gh_gl_update).__name__}"
        )

    def apply_llm_updates(
        self,
        llm_update: LlmIntegrationSettingsUpdate,
        encrypt: Callable[[str], str],
    ) -> None:
        changes = llm_update.model_dump(
            exclude_unset=True,
            by_alias=False,
            exclude={
                "api_key",
                "clear_api_key",
            },
        )

        if llm_update.api_key is not None:
            changes["api_key_ciphertext"] = encrypt(
                llm_update.api_key.get_secret_value()
            )

        if llm_update.clear_api_key:
            changes["api_key_ciphertext"] = None

        if changes:
            self.llm = replace(self.llm, **changes)

    def apply_settings_payload(self, payload: UserSettingsUpdateRequest, encrypt: Callable[[str], str]) -> None:
        """Apply non-secret, non-ciphertext settings from an API payload."""

        github = payload.github
        if github is not None:
            self.apply_github_gitlab_updates(github, encrypt)

        gitlab = payload.gitlab
        if gitlab is not None:
            self.apply_github_gitlab_updates(gitlab, encrypt)

        llm = payload.llm
        if llm is not None:
            self.apply_llm_updates(llm, encrypt)

