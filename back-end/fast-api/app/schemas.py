"""Pydantic request/response models shared across API routers."""

from __future__ import annotations

from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ChatRequest(BaseModel):
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
    provider: Literal["github", "gitlab"] | None = None

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
                raise ValueError("provider is required for disconnect_integration")

            if self.action_id is not None:
                raise ValueError("action_id is not allowed for disconnect_integration")

            if self.decision is not None:
                raise ValueError("decision is not allowed for disconnect_integration")

        return self
