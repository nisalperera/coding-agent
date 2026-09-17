from __future__ import annotations

from fastapi import HTTPException, status

from app.db.settings_repository import (
    get_user_settings as fetch_user_settings,
    reset_user_settings,
    update_user_settings
)

from app.db.models import (
    UserSettings,
    User
)
from app.schemas import (
    UserSettingsResponse,
    GitHubIntegrationSettingsResponse,
    GitLabIntegrationSettingsResponse,
    LlmIntegrationSettingsResponse,
    UserSettingsUpdateRequest,
)


def get_or_create_locked_settings(
    user_id: str,
) -> UserSettings:
    """
    Load the user's settings record under a row lock.

    A safe-default row is created only after the authenticated user is
    confirmed to exist in the same transaction.
    """

    settings_record = fetch_user_settings(user_id)
    if settings_record is not None:
        return settings_record

    settings_record = reset_user_settings(user_id)

    return settings_record


def build_user_settings_response(
    settings_record: UserSettings,
) -> UserSettingsResponse:
    """
    Construct a strict allowlist response.

    This function never reads a plaintext credential because none exists in
    the ORM model. It does not decrypt Fernet ciphertext. It only checks
    whether ciphertext exists.
    """

    if settings_record is None: return

    return UserSettingsResponse(
        github=GitHubIntegrationSettingsResponse(
            enabled=settings_record.github.enabled,
            base_url=settings_record.github.base_url,
            scopes=list(settings_record.github.scopes or []),
            client_id_configured=(
                settings_record.github.client_id_configured
            ),
            client_secret_configured=(
                settings_record.github.client_secret_configured
            ),
        ),
        gitlab=GitLabIntegrationSettingsResponse(
            enabled=settings_record.gitlab.enabled,
            base_url=settings_record.gitlab.base_url,
            scopes=list(settings_record.gitlab.scopes or []),
            client_id_configured=(
                settings_record.gitlab.client_id_configured
            ),
            client_secret_configured=(
                settings_record.gitlab.client_secret_configured
            ),
        ),
        llm=LlmIntegrationSettingsResponse(
            enabled=settings_record.llm.enabled,
            provider_name=settings_record.llm.provider_name,
            endpoint_url=settings_record.llm.endpoint_url,
            model=settings_record.llm.model,
            temperature=settings_record.llm.temperature,
            max_tokens=settings_record.llm.max_tokens,
            stream_responses=settings_record.llm.stream_responses,
            api_key_configured=settings_record.llm.api_key_configured,
        ),
    )


async def update_integration_settings(current_user: User, payload: UserSettingsUpdateRequest) -> UserSettingsResponse:
    if isinstance(current_user, dict):
        current_user = User(**current_user)

    if current_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authenticated user no longer exists.",
        )

    settings_record = update_user_settings(current_user.user_id, payload)

    return build_user_settings_response(settings_record)


async def reset_integration_settings(authenticated_user: User) -> UserSettingsResponse:
    if authenticated_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authenticated user no longer exists.",
        )

    settings_record = get_or_create_locked_settings(
        user_id=authenticated_user.user_id,
    )

    settings_record = reset_user_settings(authenticated_user.user_id)

    return build_user_settings_response(settings_record)

async def get_user_settings(authenticated_user: User) -> UserSettingsResponse:
    settings_record = fetch_user_settings(authenticated_user.user_id)
    return build_user_settings_response(settings_record)