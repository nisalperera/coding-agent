from __future__ import annotations

import asyncio

from typing import Any

from beanie.operators import Set

from app.db.base import current_time_ms
from app.db.models.conversations import (
    ContentPart, 
    Conversation, 
    Message, 
    ConversationStatus, 
    MessageStatus, 
    ClientType,
    ContentType,
    Role,
)

from app.db.conversation.conversations_repository import is_owned, get_conversations_by_user


async def owns_conversation(user_id: str, conversation_id: str) -> bool:
    """Placeholder for authenticated user-scoped conversation ownership."""
    return await asyncio.to_thread(is_owned, user_id, conversation_id)


async def get_conversations(user_id: str):
    """Placeholder for retrieving conversations owned by a user."""
    return await asyncio.to_thread(get_conversations_by_user, user_id)


def _conversation_summary(conversation: Conversation) -> dict[str, Any]:
    return {
        "id": conversation.conversation_id,
        "title": conversation.title or "New conversation",
        "client": conversation.client,
        "status": conversation.status,
        "created_at": conversation.created_at,
        "updated_at": conversation.updated_at,
        "last_message_at": conversation.last_message_at,
    }


def _message_response(message: Message) -> dict[str, Any]:
    return {
        "id": message.message_id,
        "role": message.role,
        "content": [part.model_dump() for part in message.content],
        "status": message.status,
        "error": message.error,
        "created_at": message.created_at,
    }


async def create_conversation(
    *,
    user_id: str,
    conversation_id: str,
    title: str | None,
    client: str,
) -> Conversation:
    existing = await Conversation.find_one(
        Conversation.user_id == user_id,
        Conversation.conversation_id == conversation_id,
    )

    if existing:
        return existing

    conversation = Conversation(
        conversation_id=conversation_id,
        user_id=user_id,
        title=title or "New conversation",
        client=ClientType(client),
    )

    await conversation.insert()
    return conversation


async def get_conversation(
    *,
    user_id: str,
    conversation_id: str,
    include_deleted: bool = False,
) -> Conversation | None:
    return await Conversation.find_one(
        Conversation.user_id == user_id,
        Conversation.conversation_id == conversation_id,
        Conversation.status != ConversationStatus.DELETED or include_deleted,
    )


async def list_conversations(
    *,
    user_id: str,
    limit: int = 100,
) -> list[dict[str, Any]]:
    conversations = await (
        Conversation.find(
            Conversation.user_id == user_id,
            Conversation.status == ConversationStatus.ACTIVE,
        )
        .sort("-last_message_at", "-created_at")
        .limit(limit)
        .to_list()
    )

    return [_conversation_summary(conversation) for conversation in conversations]


async def get_conversation_detail(
    *,
    user_id: str,
    conversation_id: str,
) -> dict[str, Any] | None:
    
    conversation = await get_conversation(
        user_id=user_id,
        conversation_id=conversation_id,
    )

    if not conversation:
        return None

    messages = await (
        Message.find(
            Message.user_id == user_id,
            Message.conversation_id == conversation_id,
        )
        .sort("+created_at", "+_id")
        .to_list()
    )

    return {
        **_conversation_summary(conversation),
        "messages": [_message_response(message) for message in messages],
    }


async def update_conversation(
    *,
    user_id: str,
    conversation_id: str,
    title: str | None = None,
    status: str | None = None,
) -> Conversation | None:
    conversation = await get_conversation(
        user_id=user_id,
        conversation_id=conversation_id,
    )

    if not conversation:
        return None

    if title is not None:
        conversation.title = title

    if status is not None:
        conversation.status = ConversationStatus(status)

    conversation.updated_at = current_time_ms()
    await conversation.save()
    return conversation


async def append_message(
    *,
    user_id: str,
    conversation_id: str,
    role: str,
    text: str | None = None,
    content: list[ContentPart] | None = None,
    trace_id: str | None = None,
    status: str = "completed",
    error: str | None = None,
) -> Message:
    message = Message(
        user_id=user_id,
        conversation_id=conversation_id,
        role=Role(role),
        content=content
        if content is not None
        else [ContentPart(type=ContentType.TEXT, text=text or "")],
        trace_id=trace_id,
        status=MessageStatus(status),
        error=error,
    )

    await message.insert()

    now = current_time_ms()

    await Conversation.find_one(
        Conversation.user_id == user_id,
        Conversation.conversation_id == conversation_id,
        Conversation.status != ConversationStatus.DELETED,
    ).update(
        Set(
            {
                Conversation.updated_at: now,
                Conversation.last_message_at: now,
            }
        )
    )

    return message


async def set_first_prompt_title(
    *,
    user_id: str,
    conversation_id: str,
    prompt: str,
) -> None:
    normalized = " ".join(prompt.split()).strip()

    if not normalized:
        return

    conversation = await get_conversation(
        user_id=user_id,
        conversation_id=conversation_id,
    )

    if not conversation or conversation.title not in (None, "", "New conversation"):
        return

    title = (
        normalized
        if len(normalized) <= 56
        else f"{normalized[:55].rstrip()}…"
    )

    conversation.title = title
    conversation.updated_at = current_time_ms()
    await conversation.save()


async def delete_conversation(
    *,
    user_id: str,
    conversation_id: str,
) -> bool:
    """Soft-delete one conversation owned by the authenticated user.

    The Conversation and all Message records remain in MongoDB. The sidebar
    and normal chat APIs exclude conversations marked as deleted.
    """
    conversation = await Conversation.find_one(
        Conversation.user_id == user_id,
        Conversation.conversation_id == conversation_id,
        Conversation.status != ConversationStatus.DELETED,
    )

    if conversation is None:
        return False

    deleted_at = current_time_ms()

    conversation.status = ConversationStatus.DELETED
    conversation.deleted_at = deleted_at
    conversation.updated_at = deleted_at

    await conversation.save()

    return True