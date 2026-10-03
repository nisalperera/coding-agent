from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.auth.dependencies import current_user
from app.schemas.conversations import (
    ConversationDetailResponse,
    ConversationListResponse,
    ConversationSummaryResponse,
    CreateConversationRequest,
    UpdateConversationRequest,
)
from app.services.conversation_service import (
    create_conversation,
    get_conversation_detail,
    list_conversations,
    update_conversation,
    delete_conversation as remove_conversation,
)

router = APIRouter(prefix="/v1/conversations", tags=["conversations"])


@router.get("", response_model=ConversationListResponse)
async def get_conversations(
    limit: int = Query(default=100, ge=1, le=100),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    return {
        "conversations": await list_conversations(
            user_id=user["user_id"],
            limit=limit,
        ),
    }


@router.post(
    "",
    response_model=ConversationSummaryResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_conversation(
    body: CreateConversationRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    conversation = await create_conversation(
        user_id=user["user_id"],
        conversation_id=body.conversation_id,
        title=body.title,
        client=body.client,
    )

    return {
        "id": conversation.conversation_id,
        "title": conversation.title or "New conversation",
        "client": conversation.client,
        "status": conversation.status,
        "created_at": conversation.created_at,
        "updated_at": conversation.updated_at,
        "last_message_at": conversation.last_message_at,
    }


@router.get(
    "/{conversation_id}",
    response_model=ConversationDetailResponse,
)
async def get_conversation_by_id(
    conversation_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    conversation = await get_conversation_detail(
        user_id=user["user_id"],
        conversation_id=conversation_id,
    )

    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return conversation


@router.patch(
    "/{conversation_id}",
    response_model=ConversationSummaryResponse,
)
async def patch_conversation(
    conversation_id: str,
    body: UpdateConversationRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    conversation = await update_conversation(
        user_id=user["user_id"],
        conversation_id=conversation_id,
        title=body.title,
        status=body.status,
    )

    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return {
        "id": conversation.conversation_id,
        "title": conversation.title or "New conversation",
        "client": conversation.client,
        "status": conversation.status,
        "created_at": conversation.created_at,
        "updated_at": conversation.updated_at,
        "last_message_at": conversation.last_message_at,
    }


@router.delete(
    "/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_conversation_by_id(
    conversation_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> Response:
    """Permanently delete one authenticated user's conversation."""
    deleted = await remove_conversation(
        user_id=user["user_id"],
        conversation_id=conversation_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    return Response(status_code=status.HTTP_204_NO_CONTENT)