"""Pydantic request/response models shared across API routers."""

from __future__ import annotations

from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

IntegrationProvider = Literal["github", "gitlab"]


class ChatRequest(BaseModel):
    """
    Browser-facing chat request.

    Provider credentials and OAuth callback material are deliberately absent.
    Unknown fields are rejected so legacy clients cannot silently submit tokens,
    authorization codes, state values, client credentials, or PKCE material.
    """

    model_config = ConfigDict(extra="forbid")

    message: str = ""
    history: list[dict[str, Any]] = Field(default_factory=list)
    conversation_id: str | None = None


class ActionRequest(BaseModel):
    """
    Browser-facing authenticated action contract.

    OAuth callbacks and credentials are deliberately excluded. Unknown fields
    are rejected so old browser clients cannot send provider tokens, codes,
    redirect URIs, OAuth state, or client credentials silently.
    """

    model_config = ConfigDict(extra="forbid")

    action: Literal["action_pending", "disconnect_integration"]
    action_id: str | None = None
    decision: Literal["approve", "reject"] | None = None
    provider: IntegrationProvider | None = None

    @model_validator(mode="after")
    def validate_action_payload(self) -> Self:
        if self.action == "action_pending":
            if not self.action_id:
                raise ValueError("action_id is required for action_pending")

            if not self.decision:
                raise ValueError("decision is required for action_pending")

            if self.provider is not None:
                raise ValueError("provider is not allowed for action_pending")

        if self.action == "disconnect_integration":
            if not self.provider:
                raise ValueError(
                    "provider is required for disconnect_integration"
                )

            if self.action_id is not None:
                raise ValueError(
                    "action_id is not allowed for disconnect_integration"
                )

            if self.decision is not None:
                raise ValueError(
                    "decision is not allowed for disconnect_integration"
                )

        return self


class IntegrationStatus(BaseModel):
    """
    Public-safe metadata for one authenticated user's provider integration.

    This model intentionally excludes access tokens, refresh tokens, encrypted
    token fields, scopes, expiry, OAuth state, callback nonces, authorization
    codes, PKCE data, and provider client configuration.
    """

    model_config = ConfigDict(extra="forbid")

    connected: bool
    username: str | None = None
    connected_at: int | None = None


class IntegrationsStatusResponse(BaseModel):
    """
    Stable authenticated integration-status response.

    Both provider keys are always present to keep the frontend independent from
    database row existence and provider connection state.
    """

    model_config = ConfigDict(extra="forbid")

    integrations: dict[IntegrationProvider, IntegrationStatus]