from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from beanie import Document
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING, IndexModel

from app.db.models import new_uuid


def utc_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


class ContentPart(BaseModel):
    type: Literal["text", "image", "file"] = "text"
    text: str | None = None

    # S3 key, never embed large or binary content in MongoDB.
    storage_key: str | None = None
    mime_type: str | None = None
    filename: str | None = None
    size_bytes: int | None = None


class ToolCallRecord(BaseModel):
    call_id: str
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class RagSourceRecord(BaseModel):
    source_id: str
    title: str | None = None
    uri: str | None = None
    document_id: str | None = None
    chunk_id: str | None = None
    repository: str | None = None
    commit_sha: str | None = None
    retrieval_score: float | None = None
    rerank_score: float | None = None


class TokenUsageRecord(BaseModel):
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None


class Conversation(Document):
    conversation_id: str = Field(default_factory=new_uuid)
    user_id: str

    title: str | None = None
    client: Literal["web", "cli"] = "web"
    status: Literal["active", "archived"] = "active"

    repository: str | None = None
    branch: str | None = None

    created_at: int = Field(default_factory=utc_ms)
    updated_at: int = Field(default_factory=utc_ms)
    last_message_at: int = Field(default_factory=utc_ms)

    class Settings:
        name = "conversations"
        indexes = [
            IndexModel(
                [
                    ("user_id", ASCENDING),
                    ("status", ASCENDING),
                    ("last_message_at", DESCENDING),
                    ("_id", ASCENDING),
                ],
                name="user_recent_conversations",
            ),
        ]


class Message(Document):
    message_id: str = Field(default_factory=new_uuid)
    conversation_id: str
    trace_id: str | None = None
    user_id: str

    role: Literal["system", "user", "assistant", "tool"]
    content: list[ContentPart] = Field(default_factory=list)

    tool_calls: list[ToolCallRecord] = Field(default_factory=list)
    tool_call_id: str | None = None
    tool_name: str | None = None

    sources: list[RagSourceRecord] = Field(default_factory=list)

    run_id: str | None = None
    model: str | None = None
    usage: TokenUsageRecord | None = None
    status: Literal["completed", "failed", "cancelled"] = "completed"
    error: str | None = None

    created_at: int = Field(default_factory=utc_ms)

    class Settings:
        name = "messages"
        indexes = [
            IndexModel(
                [
                    ("user_id", ASCENDING),
                    ("conversation_id", ASCENDING),
                    ("created_at", ASCENDING),
                    ("_id", ASCENDING),
                ],
                name="user_conversation_messages",
            ),
            IndexModel(
                [("run_id", ASCENDING)],
                name="messages_by_run",
            ),
        ]
