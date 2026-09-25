
from typing import Optional
from datetime import datetime, timezone

from sqlalchemy import select
from fastapi import HTTPException, status

from app.core.crypto import encrypt_secret
from app.db.models import UserSettings
from app.schemas import UserSettingsUpdateRequest
from app.db.database import db_session
from app.core.integration_defaults import (
    DEFAULT_GITHUB_BASE_URL,
    DEFAULT_GITHUB_SCOPES,
    DEFAULT_GITLAB_BASE_URL,
    DEFAULT_GITLAB_SCOPES,
    DEFAULT_LLM_ENDPOINT_URL,
    DEFAULT_LLM_MAX_TOKENS,
    DEFAULT_LLM_MODEL,
    DEFAULT_LLM_PROVIDER_NAME,
    DEFAULT_LLM_STREAM_RESPONSES,
    DEFAULT_LLM_TEMPERATURE,
)


def _check_empty_settings(settings: UserSettings):
    if settings is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Settings not found",
        )


def create_user_settings(user_id: str) -> UserSettings:
    """
    Create a UserSettings record with defaults for user_id.

    If a settings record already exists, return it instead.
    """
    with db_session() as session:
        existing_settings = session.scalar(
            select(UserSettings).where(UserSettings.user_id == user_id)
        )
        if existing_settings is not None:
            return existing_settings

        new_settings = UserSettings(
            user_id=user_id,
            github_enabled=False,
            github_base_url=DEFAULT_GITHUB_BASE_URL,
            github_scopes=list(DEFAULT_GITHUB_SCOPES),
            gitlab_enabled=False,
            gitlab_base_url=DEFAULT_GITLAB_BASE_URL,
            gitlab_scopes=list(DEFAULT_GITLAB_SCOPES),
            llm_enabled=False,
            llm_provider_name=DEFAULT_LLM_PROVIDER_NAME,
            llm_endpoint_url=DEFAULT_LLM_ENDPOINT_URL,
            llm_model=DEFAULT_LLM_MODEL,
            llm_temperature=DEFAULT_LLM_TEMPERATURE,
            llm_max_tokens=DEFAULT_LLM_MAX_TOKENS,
            llm_stream_responses=DEFAULT_LLM_STREAM_RESPONSES,
        )

        session.add(new_settings)
        session.flush()
        session.refresh(new_settings)

        return new_settings


def get_user_settings(user_id: str) -> Optional[UserSettings]:

    with db_session() as session:
        settings_record = session.scalar(
            select(UserSettings)
            .where(UserSettings.user_id == user_id)
            .with_for_update()
        )
        _check_empty_settings(settings_record)

        settings_record.last_seen_at = datetime.now(timezone.utc)
        session.commit()
        session.refresh(settings_record)

        return settings_record


def reset_user_settings(user_id: str) -> Optional[UserSettings]:
    """
    Reset a user's integration configuration to safe application defaults.

    The settings record is retained. All encrypted credential ciphertext is
    cleared without being decrypted, and all integration metadata is restored
    to default values.

    Returns the updated record if both the user and settings record exist.
    Returns None when either does not exist.
    """

    with db_session() as session:
        settings_record = session.scalar(
            select(UserSettings)
            .where(UserSettings.user_id == user_id)
            .with_for_update()
        )

        _check_empty_settings(settings_record)

        settings_record.github_enabled = False
        settings_record.github_base_url = DEFAULT_GITHUB_BASE_URL
        settings_record.github_scopes = list(DEFAULT_GITHUB_SCOPES)
        settings_record.github_client_id_ciphertext = None
        settings_record.github_client_secret_ciphertext = None

        settings_record.gitlab_enabled = False
        settings_record.gitlab_base_url = DEFAULT_GITLAB_BASE_URL
        settings_record.gitlab_scopes = list(DEFAULT_GITLAB_SCOPES)
        settings_record.gitlab_client_id_ciphertext = None
        settings_record.gitlab_client_secret_ciphertext = None

        settings_record.llm_enabled = False
        settings_record.llm_provider_name = DEFAULT_LLM_PROVIDER_NAME
        settings_record.llm_endpoint_url = DEFAULT_LLM_ENDPOINT_URL
        settings_record.llm_model = DEFAULT_LLM_MODEL
        settings_record.llm_api_key_ciphertext = None
        settings_record.llm_temperature = DEFAULT_LLM_TEMPERATURE
        settings_record.llm_max_tokens = DEFAULT_LLM_MAX_TOKENS
        settings_record.llm_stream_responses = DEFAULT_LLM_STREAM_RESPONSES

        session.flush()

        return settings_record


def update_user_settings(
    user_id: str,
    payload: UserSettingsUpdateRequest,
) -> UserSettings | None:
    with db_session() as session:
        settings_record = session.scalar(
            select(UserSettings)
            .where(UserSettings.user_id == user_id)
            .with_for_update()
        )

        _check_empty_settings(settings_record)

        settings_record.apply_settings_payload(payload, encrypt_secret)

        session.flush()
        session.refresh(settings_record)

        return settings_record

