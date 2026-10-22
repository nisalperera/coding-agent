import os
from functools import lru_cache
from typing import Any
from fastapi import Depends, HTTPException
from app.auth.dependencies import current_user
from app.core.project_policy import parse_operator_ids

@lru_cache(maxsize=1)
def operator_user_ids() -> frozenset[str]:
    # current_user imports deployment configuration and loads .env first.
    return parse_operator_ids(os.environ.get("OPERATOR_USER_IDS", ""))

async def current_operator(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if user["user_id"] not in operator_user_ids():
        raise HTTPException(status_code=403, detail="Operator access required")
    return user
