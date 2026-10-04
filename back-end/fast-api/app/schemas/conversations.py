from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class CreateConversationRequest(BaseModel):
    conversation_id: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9_-]+$",
    )
    title: str | None = Field(default=None, max_length=120)
    client: Literal["web", "cli"] = "web"


class UpdateConversationRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    status: Literal["active", "archived"] | None = None


class ConversationSummaryResponse(BaseModel):
    id: str
    title: str
    client: Literal["web", "cli"]
    status: Literal["active", "archived"]
    created_at: int
    updated_at: int
    last_message_at: int


class MessageContentResponse(BaseModel):
    type: Literal["text", "image", "file"]
    text: str | None = None
    storage_key: str | None = None
    mime_type: str | None = None
    filename: str | None = None
    size_bytes: int | None = None


class MessageResponse(BaseModel):
    id: str
    role: Literal["system", "user", "assistant", "tool"]
    content: list[MessageContentResponse]
    status: Literal["completed", "failed", "cancelled"]
    error: str | None = None
    created_at: int


class ConversationDetailResponse(ConversationSummaryResponse):
    messages: list[MessageResponse]


class ConversationListResponse(BaseModel):
    conversations: list[ConversationSummaryResponse]