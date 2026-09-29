"""
Central place that knows how to invoke any tool, including injecting
authenticated-user-scoped GitHub or GitLab credentials for repository tools.

Provider credentials are resolved only from the encrypted, database-backed
integration record owned by the authenticated user. Browser callers, pending
actions, model tool arguments, and public API contracts must not provide,
override, or receive provider tokens, OAuth callback values, client secrets,
refresh tokens, authorization codes, OAuth state, or PKCE material.
"""

from __future__ import annotations

import asyncio
import inspect
from typing import Any

from app.services.github_oauth_service import (
    GitHubOAuthError,
    get_github_access_token,
)
from app.services.gitlab_oauth_service import (
    GitLabOAuthError,
    get_gitlab_access_token,
)
from app.tools.repo_tools import (
    GITHUB_TOOL_NAMES,
    GITLAB_TOOL_NAMES,
    REPO_TOOL_FUNCS,
)
from app.tools.web_search import web_search


class ProviderNotConnectedError(Exception):
    """
    The authenticated user does not have a usable integration for a provider.

    This is deliberately a normalized, public-safe dispatch error. Its
    `provider` field can be returned to an authenticated browser client, while
    the chained exception remains internal and must not be logged verbatim or
    included in model context.
    """

    def __init__(self, provider: str) -> None:
        self.provider = provider
        super().__init__(f"{provider} integration is not connected")


_FORBIDDEN_CREDENTIAL_ARGUMENTS = frozenset(
    {
        "github_token",
        "gitlab_token",
        "access_token",
        "refresh_token",
        "client_secret",
        "code",
        "state",
        "code_verifier",
    }
)

FUNCS: dict[str, Any] = {"web_search": web_search}
FUNCS.update(REPO_TOOL_FUNCS)


def _validate_tool_arguments(args: dict[str, Any]) -> None:
    """
    Reject browser credential and OAuth material at dispatch ingress.

    Public Pydantic models already reject unsupported browser request fields.
    This guard provides defense in depth for stale pending-action records,
    future internal callers, CLI adapters, and tests.
    """
    forbidden_arguments = _FORBIDDEN_CREDENTIAL_ARGUMENTS.intersection(args)
    if forbidden_arguments:
        raise ValueError(
            "Credential and OAuth callback arguments are not accepted by tool dispatch"
        )


async def invoke_function(function: Any, **kwargs: Any) -> Any:
    """Call synchronous tools in a worker thread and await async tools directly."""
    if inspect.iscoroutinefunction(function):
        return await function(**kwargs)

    return await asyncio.to_thread(function, **kwargs)


async def call_repo_tool(name: str, args: dict[str, Any], user_id: str) -> Any:
    """
    Dispatch a repository tool with a backend-owned credential.

    The credential is fetched immediately before tool execution from the
    encrypted integration record associated with `user_id`. Environment token
    fallbacks are intentionally not used for authenticated multi-user actions.
    """
    if name not in FUNCS:
        raise ValueError(f"Unknown tool: {name}")

    if not isinstance(user_id, str) or not user_id:
        raise ValueError("Authenticated user ID is required for repository tools")

    _validate_tool_arguments(args)
    kwargs = dict(args)

    if name in GITHUB_TOOL_NAMES:
        try:
            kwargs["github_token"] = await get_github_access_token(user_id)
        except GitHubOAuthError as exc:
            raise ProviderNotConnectedError("github") from exc

    elif name in GITLAB_TOOL_NAMES:
        try:
            kwargs["gitlab_token"] = await get_gitlab_access_token(user_id)
        except GitLabOAuthError as exc:
            raise ProviderNotConnectedError("gitlab") from exc

    return await invoke_function(FUNCS[name], **kwargs)


async def call_tool(name: str, args: dict[str, Any], user_id: str) -> Any:
    """
    Dispatch any registered tool.

    Repository tools receive user-bound credentials only through
    `call_repo_tool`. Non-provider tools do not receive credentials.
    """
    if name not in FUNCS:
        raise ValueError(f"Unknown tool: {name}")

    if name in GITHUB_TOOL_NAMES or name in GITLAB_TOOL_NAMES:
        return await call_repo_tool(name, args, user_id)

    _validate_tool_arguments(args)
    return await invoke_function(FUNCS[name], **args)