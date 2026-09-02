"""Pydantic request/response models shared across API routers."""
from typing import Any, Optional

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = ""
    history: list[dict[str, Any]] = Field(default_factory=list)
    conversation_id: Optional[str] = None
    gitlab_token: Optional[str] = None


class ActionRequest(BaseModel):
    action: str
    action_id: Optional[str] = None
    decision: Optional[str] = None
    gitlab_token: Optional[str] = None
    provider: Optional[str] = None
    code: Optional[str] = None
    redirect_uri: Optional[str] = None
    state: Optional[str] = None
