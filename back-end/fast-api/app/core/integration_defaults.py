DEFAULT_GITHUB_BASE_URL = "https://github.com"
DEFAULT_GITLAB_BASE_URL = "https://gitlab.com"
DEFAULT_GITHUB_SCOPES = ["read:user", "repo"]
DEFAULT_GITLAB_SCOPES = ["read_user", "api"]
DEFAULT_LLM_TEMPERATURE = 0.2
DEFAULT_LLM_MAX_TOKENS = 4096
DEFAULT_LLM_STREAM_RESPONSES = True

DEFAULT_LLM_PROVIDER_NAME="Custom"
DEFAULT_LLM_ENDPOINT_URL="https://vllm.ganisalchperera.com/v1/chat/completions"
DEFAULT_LLM_MODEL="Qwen2.5-Coder-14b"

UPDATABLE_USER_SETTINGS_FIELDS = frozenset(
    {
        "github_enabled",
        "github_base_url",
        "github_scopes",
        "github_client_id_ciphertext",
        "github_client_secret_ciphertext",
        "gitlab_enabled",
        "gitlab_base_url",
        "gitlab_scopes",
        "gitlab_client_id_ciphertext",
        "gitlab_client_secret_ciphertext",
        "llm_enabled",
        "llm_provider_name",
        "llm_endpoint_url",
        "llm_model",
        "llm_temperature",
        "llm_max_tokens",
        "llm_stream_responses",
        "llm_api_key_ciphertext",
    },
)

ENCRYPTED_SETTINGS_FIELDS = frozenset(
    {
        "llm_api_key_ciphertext",
        "gitlab_client_secret_ciphertext",
        "gitlab_client_id_ciphertext",
        "github_client_secret_ciphertext",
        "github_client_id_ciphertext"

    }
)

SUPPORTED_GITHUB_SCOPES = frozenset(
    {
        "read:user",
        "user:email",
        "repo",
        "public_repo",
        "workflow",
        "read:org",
    },
)

SUPPORTED_GITLAB_SCOPES = frozenset(
    {
        "read_user",
        "read_api",
        "api",
        "read_repository",
        "write_repository",
    },
)

MAX_CREDENTIAL_LENGTH = 8192
MAX_CLIENT_ID_LENGTH = 4096