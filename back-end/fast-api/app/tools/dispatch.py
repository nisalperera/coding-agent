"""
Central place that knows how to invoke any tool (web_search or a repo tool),
including injecting the correct GitHub/GitLab credentials.

Both providers now follow the same path: the dispatcher fetches a decrypted
token from the encrypted, database-backed integration store immediately
before the call. Neither provider accepts a client-supplied token anymore
(the previous `gitlab_token` request-body passthrough has been removed).
"""
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
from app.tools.repo_tools import GITHUB_TOOL_NAMES, GITLAB_TOOL_NAMES, REPO_TOOL_FUNCS
from app.tools.web_search import web_search


FUNCS: dict[str, Any] = {"web_search": web_search}
FUNCS.update(REPO_TOOL_FUNCS)


async def invoke_function(function: Any, **kwargs: Any) -> Any:
    if inspect.iscoroutinefunction(function):
        return await function(**kwargs)
    return await asyncio.to_thread(function, **kwargs)


async def call_repo_tool(name: str, args: dict[str, Any], user_id: str) -> Any:
    if name not in FUNCS:
        raise ValueError(f"Unknown tool: {name}")

    kwargs = dict(args)

    if name in GITHUB_TOOL_NAMES:
        try:
            kwargs["github_token"] = await get_github_access_token(user_id)
        except GitHubOAuthError:
            return {
                "error": "github_integration_required",
                "message": "Connect your GitHub account before using GitHub repository tools.",
            }

    elif name in GITLAB_TOOL_NAMES:
        try:
            kwargs["gitlab_token"] = await get_gitlab_access_token(user_id)
        except GitLabOAuthError:
            return {
                "error": "gitlab_integration_required",
                "message": "Connect your GitLab account before using GitLab repository tools.",
            }

    return await invoke_function(FUNCS[name], **kwargs)


async def call_tool(name: str, args: dict[str, Any], user_id: str) -> Any:
    if name in GITHUB_TOOL_NAMES or name in GITLAB_TOOL_NAMES:
        return await call_repo_tool(name, args, user_id)
    return await invoke_function(FUNCS[name], **args)