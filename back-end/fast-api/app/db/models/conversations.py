from __future__ import annotations

from typing import Any
from enum import StrEnum

from beanie import Document
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING, IndexModel

from app.db.base import new_uuid, current_time_ms


class ContentType(StrEnum):
    TEXT = "text"
    IMAGE = "image"
    FILE = "file"

class Role(StrEnum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"

class MessageStatus(StrEnum):
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

class ConversationStatus(StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"
    DELETED = "deleted"

class ClientType(StrEnum):
    WEB = "web"
    CLI = "cli"

class ContentPart(BaseModel):
    type: ContentType = ContentType.TEXT
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
    client: ClientType = ClientType.WEB
    status: ConversationStatus = ConversationStatus.ACTIVE

    # Unix epoch milliseconds. None means the conversation is visible and usable.
    deleted_at: int | None = None

    repository: str | None = None
    branch: str | None = None

    created_at: int = Field(default_factory=current_time_ms)
    updated_at: int = Field(default_factory=current_time_ms)
    last_message_at: int = Field(default_factory=current_time_ms)

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

    role: Role
    content: list[ContentPart] = Field(default_factory=list)

    tool_calls: list[ToolCallRecord] = Field(default_factory=list)
    tool_call_id: str | None = None
    tool_name: str | None = None

    sources: list[RagSourceRecord] = Field(default_factory=list)

    run_id: str | None = None
    model: str | None = None
    usage: TokenUsageRecord | None = None
    status: MessageStatus = MessageStatus.COMPLETED
    error: str | None = None

    created_at: int = Field(default_factory=current_time_ms)

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
