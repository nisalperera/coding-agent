from typing import Annotated

from fastapi import HTTPException, status

from fastapi import APIRouter, Depends
from app.auth.dependencies import current_user

from app.schemas import UserSettingsResponse, UserSettingsUpdateRequest
from app.services.settings_service import reset_integration_settings, update_integration_settings as update_settings

from app.db.models import User

router = APIRouter(
    prefix="/v1",
    tags=["integration-settings"],
)

@router.put(
    "/settings/update",
    response_model=UserSettingsResponse,
    response_model_by_alias=True,
    status_code=status.HTTP_200_OK,
)
async def update_integration_settings(
    payload: UserSettingsUpdateRequest,
    current_user: Annotated[User, Depends(current_user)],
) -> UserSettingsResponse:
    """
    Partially update the authenticated user's GitHub, GitLab, and LLM settings.

    All client IDs, client secrets, and API keys are Fernet-encrypted only
    inside this backend process, immediately before MySQL persistence.
    """

    if not payload.model_fields_set:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one integration settings section is required.",
        )

    if (
        payload.github is None
        and payload.gitlab is None
        and payload.llm is None
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "At least one non-null integration settings section is required."
            ),
        )

    return await update_settings(current_user, payload)


@router.post(
    "/settings/reset",
    response_model=UserSettingsResponse,
    response_model_by_alias=True,
    status_code=status.HTTP_200_OK,
)
async def reset_integration_settings(
    authenticated_user: Annotated[User, Depends(current_user)],
) -> UserSettingsResponse:
    return await reset_integration_settings(authenticated_user)

