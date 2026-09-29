"""Pydantic request/response models shared across API routers."""

from __future__ import annotations

from typing import Any, Literal, Self, Annotated

from pydantic import (
    BaseModel, 
    ConfigDict, 
    EmailStr, 
    BaseModel,
    ConfigDict,
    SecretStr,
    Field, 
    model_validator,
    field_validator,
)

from app.core.integration_defaults import (
    SUPPORTED_GITHUB_SCOPES,
    SUPPORTED_GITLAB_SCOPES,
    MAX_CLIENT_ID_LENGTH,
    MAX_CREDENTIAL_LENGTH,
)

IntegrationProvider = Literal["github", "gitlab"]
OAuthScopeList = Annotated[
    list[str],
    Field(
        default_factory=list,
        description="OAuth scopes configured for the provider.",
        max_length=32,
    ),
]

def to_camel_case(value: str) -> str:
    first, *rest = value.split("_")

    return first + "".join(part.capitalize() for part in rest)


class ChatRequest(BaseModel):
    """
    Browser-facing chat request.

    Provider credentials and OAuth callback material are deliberately absent.
    Unknown fields are rejected so legacy clients cannot silently submit tokens,
    authorization codes, state values, client credentials, or PKCE material.
    """

    model_config = ConfigDict(extra="forbid")

    message: str = ""
    history: list[dict[str, Any]] = Field(default_factory=list)
    conversation_id: str | None = None
    attachments: list[dict[str, Any]] = Field(default_factory=list)


class ActionRequest(BaseModel):
    """
    Browser-facing authenticated action contract.

    OAuth callbacks and credentials are deliberately excluded. Unknown fields
    are rejected so old browser clients cannot send provider tokens, codes,
    redirect URIs, OAuth state, or client credentials silently.
    """

    model_config = ConfigDict(extra="forbid")

    action: Literal["action_pending", "disconnect_integration"]
    action_id: str | None = None
    decision: Literal["approve", "reject"] | None = None
    provider: IntegrationProvider | None = None

    @model_validator(mode="after")
    def validate_action_payload(self) -> Self:
        if self.action == "action_pending":
            if not self.action_id:
                raise ValueError("action_id is required for action_pending")

            if not self.decision:
                raise ValueError("decision is required for action_pending")

            if self.provider is not None:
                raise ValueError("provider is not allowed for action_pending")

        if self.action == "disconnect_integration":
            if not self.provider:
                raise ValueError(
                    "provider is required for disconnect_integration"
                )

            if self.action_id is not None:
                raise ValueError(
                    "action_id is not allowed for disconnect_integration"
                )

            if self.decision is not None:
                raise ValueError(
                    "decision is not allowed for disconnect_integration"
                )

        return self


class IntegrationStatus(BaseModel):
    """
    Public-safe metadata for one authenticated user's provider integration.

    This model intentionally excludes access tokens, refresh tokens, encrypted
    token fields, scopes, expiry, OAuth state, callback nonces, authorization
    codes, PKCE data, and provider client configuration.
    """

    model_config = ConfigDict(extra="forbid")

    connected: bool
    username: str | None = None
    connected_at: int | None = None


class IntegrationsStatusResponse(BaseModel):
    """
    Stable authenticated integration-status response.

    Both provider keys are always present to keep the frontend independent from
    database row existence and provider connection state.
    """

    model_config = ConfigDict(extra="forbid")

    integrations: dict[IntegrationProvider, IntegrationStatus]


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    username: str | None
    name: str | None
    email: EmailStr
    email_verified: bool
    picture: str | None
    auth_provider: str


class GitHubIntegrationSettingsResponse(BaseModel):
    model_config = ConfigDict(
            extra="forbid",
            populate_by_name=True,
        )

    enabled: bool = False

    base_url: str = Field(
        default="https://github.com",
        description="GitHub.com or the configured GitHub Enterprise Server base URL.",
        serialization_alias="baseUrl",
    )

    scopes: OAuthScopeList

    client_id_configured: bool = Field(
        default=False,
        description=(
            "True when an encrypted GitHub OAuth client ID exists. "
            "The client ID is never returned."
        ),
        serialization_alias="clientIdConfigured",
    )

    client_secret_configured: bool = Field(
        default=False,
        description=(
            "True when an encrypted GitHub OAuth client secret exists. "
            "The secret is never returned."
        ),
        serialization_alias="clientSecretConfigured",
    )


class GitLabIntegrationSettingsResponse(BaseModel):
    model_config = ConfigDict(
            extra="forbid",
            populate_by_name=True,
        )

    enabled: bool = False

    base_url: str = Field(
        default="https://gitlab.com",
        description="GitLab.com or the configured self-managed GitLab base URL.",
        serialization_alias="baseUrl",
    )

    scopes: OAuthScopeList

    client_id_configured: bool = Field(
        default=False,
        description=(
            "True when an encrypted GitLab OAuth application ID exists. "
            "The application ID is never returned."
        ),
        serialization_alias="clientIdConfigured",
    )

    client_secret_configured: bool = Field(
        default=False,
        description=(
            "True when an encrypted GitLab OAuth secret exists. "
            "The secret is never returned."
        ),
        serialization_alias="clientSecretConfigured",
    )


class LlmIntegrationSettingsResponse(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )

    enabled: bool = False

    provider_name: str = Field(
        default="",
        description="Configured LLM provider name, such as Ollama, vLLM, or OpenAI.",
        serialization_alias="providerName",
        max_length=100,
    )

    endpoint_url: str = Field(
        default="",
        description="Configured LLM API endpoint URL.",
        serialization_alias="endpointUrl",
        max_length=2048,
    )

    model: str = Field(
        default="",
        description="Configured provider model identifier or deployment name.",
        max_length=255,
    )

    temperature: float = Field(
        default=0.2,
        ge=0,
        le=2,
        description="Configured generation temperature.",
    )

    max_tokens: int = Field(
        default=4096,
        ge=1,
        le=131072,
        description="Maximum generated output tokens.",
        serialization_alias="maxTokens",
    )

    stream_responses: bool = Field(
        default=True,
        description="Whether LLM responses should be streamed to the client.",
        serialization_alias="streamResponses",
    )

    api_key_configured: bool = Field(
        default=False,
        description=(
            "True when an encrypted LLM API key exists. "
            "The API key is never returned."
        ),
        serialization_alias="apiKeyConfigured",
    )


class UserSettingsResponse(BaseModel):
    """
    Redacted integration settings response.

    This response intentionally excludes every encrypted value and all
    plaintext credentials. It must never expose client IDs, client secrets,
    API keys, OAuth access tokens, refresh tokens, or ciphertext.
    """

    model_config = ConfigDict(
        from_attributes=True, 
        extra="forbid"
    )

    github: GitHubIntegrationSettingsResponse = Field(
        default_factory=GitHubIntegrationSettingsResponse,
    )

    gitlab: GitLabIntegrationSettingsResponse = Field(
        default_factory=GitLabIntegrationSettingsResponse,
    )

    llm: LlmIntegrationSettingsResponse = Field(
        default_factory=LlmIntegrationSettingsResponse,
    )


class ApiModel(BaseModel):
    """
    Base schema for integration-settings API payloads.

    Accepts both snake_case and camelCase request field names.
    JSON responses use camelCase when FastAPI uses
    response_model_by_alias=True.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
        alias_generator=to_camel_case,
        serialize_by_alias=True
    )


class GitHubIntegrationSettingsUpdate(ApiModel):
    enabled: bool | None = None

    base_url: str | None = Field(
        default=None,
        min_length=1,
        max_length=2048,
    )

    scopes: list[str] | None = Field(
        default=None,
        max_length=32,
    )

    client_id: SecretStr | None = Field(
        default=None,
        min_length=1,
        max_length=MAX_CLIENT_ID_LENGTH,
    )

    client_secret: SecretStr | None = Field(
        default=None,
        min_length=1,
        max_length=MAX_CREDENTIAL_LENGTH,
    )

    clear_client_id: bool | None = Field(
        default=None,
        description=(
            "Clear the stored GitHub OAuth client ID ciphertext. "
            "Cannot be used with clientId in the same request."
        ),
    )

    clear_client_secret: bool | None = Field(
        default=None,
        description=(
            "Clear the stored GitHub OAuth client-secret ciphertext. "
            "Cannot be used with clientSecret in the same request."
        ),
    )

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str | None) -> str | None:
        if value is None:
            return None

        normalized_value = value.strip().rstrip("/")

        if not normalized_value:
            raise ValueError("GitHub base URL cannot be empty.")

        if not normalized_value.startswith(("http://", "https://")):
            raise ValueError(
                "GitHub base URL must start with http:// or https://."
            )

        return normalized_value

    @field_validator("scopes")
    @classmethod
    def validate_scopes(
        cls,
        value: list[str] | None,
    ) -> list[str] | None:
        if value is None:
            return None

        normalized_scopes = list(
            dict.fromkeys(
                scope.strip()
                for scope in value
                if scope and scope.strip()
            )
        )

        invalid_scopes = (
            set(normalized_scopes) - SUPPORTED_GITHUB_SCOPES
        )

        if invalid_scopes:
            raise ValueError(
                "Unsupported GitHub OAuth scopes: "
                + ", ".join(sorted(invalid_scopes))
            )

        return normalized_scopes

    @field_validator("client_id", "client_secret")
    @classmethod
    def normalize_credential(
        cls,
        value: str | None,
    ) -> str | None:
        if value is None:
            return None

        normalized_value = value.strip()

        if not normalized_value:
            raise ValueError("Credential values cannot be empty.")

        return normalized_value


class GitLabIntegrationSettingsUpdate(ApiModel):
    enabled: bool | None = None

    base_url: str | None = Field(
        default=None,
        min_length=1,
        max_length=2048,
    )

    scopes: list[str] | None = Field(
        default=None,
        max_length=32,
    )

    client_id: SecretStr | None = Field(
        default=None,
        min_length=1,
        max_length=MAX_CLIENT_ID_LENGTH,
    )

    client_secret: SecretStr | None = Field(
        default=None,
        min_length=1,
        max_length=MAX_CREDENTIAL_LENGTH,
    )

    clear_client_id: bool | None = Field(
        default=None,
        description=(
            "Clear the stored GitLab OAuth application-ID ciphertext. "
            "Cannot be used with clientId in the same request."
        ),
    )

    clear_client_secret: bool | None = Field(
        default=None,
        description=(
            "Clear the stored GitLab OAuth secret ciphertext. "
            "Cannot be used with clientSecret in the same request."
        ),
    )

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str | None) -> str | None:
        if value is None:
            return None

        normalized_value = value.strip().rstrip("/")

        if not normalized_value:
            raise ValueError("GitLab base URL cannot be empty.")

        if not normalized_value.startswith(("http://", "https://")):
            raise ValueError(
                "GitLab base URL must start with http:// or https://."
            )

        return normalized_value

    @field_validator("scopes")
    @classmethod
    def validate_scopes(
        cls,
        value: list[str] | None,
    ) -> list[str] | None:
        if value is None:
            return None

        normalized_scopes = list(
            dict.fromkeys(
                scope.strip()
                for scope in value
                if scope and scope.strip()
            )
        )

        invalid_scopes = (
            set(normalized_scopes) - SUPPORTED_GITLAB_SCOPES
        )

        if invalid_scopes:
            raise ValueError(
                "Unsupported GitLab OAuth scopes: "
                + ", ".join(sorted(invalid_scopes))
            )

        return normalized_scopes

    @field_validator("client_id", "client_secret")
    @classmethod
    def normalize_credential(
        cls,
        value: str | None,
    ) -> str | None:
        if value is None:
            return None

        normalized_value = value.strip()

        if not normalized_value:
            raise ValueError("Credential values cannot be empty.")

        return normalized_value


class LlmIntegrationSettingsUpdate(ApiModel):
    enabled: bool | None = None

    provider_name: str | None = Field(
        default=None,
        min_length=1,
        max_length=100,
    )

    endpoint_url: str | None = Field(
        default=None,
        min_length=1,
        max_length=2048,
    )

    model: str | None = Field(
        default=None,
        min_length=1,
        max_length=255,
    )

    temperature: float | None = Field(
        default=None,
        ge=0,
        le=2,
    )

    max_tokens: int | None = Field(
        default=None,
        ge=1,
        le=131072,
    )

    stream_responses: bool | None = None

    api_key: SecretStr | None = Field(
        default=None,
        min_length=1,
        max_length=MAX_CREDENTIAL_LENGTH,
    )

    clear_api_key: bool | None = Field(
        default=None,
        description=(
            "Clear the stored LLM API-key ciphertext. "
            "Cannot be used with apiKey in the same request."
        ),
    )

    @field_validator(
        "provider_name",
        "endpoint_url",
        "model",
        "api_key",
    )
    @classmethod
    def normalize_text_value(
        cls,
        value: str | None,
    ) -> str | None:
        if value is None:
            return None

        normalized_value = value.strip()

        if not normalized_value:
            raise ValueError("Text settings cannot be empty.")

        return normalized_value

    @field_validator("endpoint_url")
    @classmethod
    def validate_endpoint_url(
        cls,
        value: str | None,
    ) -> str | None:
        if value is None:
            return None

        if not value.startswith(("http://", "https://")):
            raise ValueError(
                "LLM endpoint URL must start with http:// or https://."
            )

        return value.rstrip("/")


class UserSettingsUpdateRequest(ApiModel):
    """
    Partial update request.

    Omitted provider blocks and omitted fields are preserved. Credential values
    are plaintext only during request processing and are converted to Fernet
    ciphertext before MySQL persistence.
    """

    github: GitHubIntegrationSettingsUpdate | None = None
    gitlab: GitLabIntegrationSettingsUpdate | None = None
    llm: LlmIntegrationSettingsUpdate | None = None


class UserWithUserSettingsResponse(BaseModel):
    """_summary_

    Args:
        user (UserResponse): The user's information.
        settings (UserSettingsResponse): The user's settings.
    """
    model_config = ConfigDict(from_attributes=True)

    user: UserResponse
    settings: UserSettingsResponse