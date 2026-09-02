"""
Central place that knows how to invoke any tool (web_search or a repo tool),
including injecting the correct GitHub/GitLab credentials.
"""
import asyncio
import inspect
from typing import Any, Optional

from app.services.github_oauth_service import get_user_integration
from app.tools.repo_tools import GITHUB_TOOL_NAMES, GITLAB_TOOL_NAMES, REPO_TOOL_FUNCS
from app.tools.web_search import web_search

FUNCS: dict[str, Any] = {"web_search": web_search}
FUNCS.update(REPO_TOOL_FUNCS)


def get_user_github_token(user_id: str) -> Optional[str]:
    integration = get_user_integration(user_id, "github")
    return integration.get("access_token") if integration else None


async def invoke_function(function: Any, **kwargs: Any) -> Any:
    if inspect.iscoroutinefunction(function):
        return await function(**kwargs)
    return await asyncio.to_thread(function, **kwargs)


async def call_repo_tool(name: str, args: dict[str, Any], user_id: str, gitlab_token: Optional[str] = None) -> Any:
    if name not in FUNCS:
        raise ValueError(f"Unknown tool: {name}")

    kwargs = dict(args)
    if name in GITHUB_TOOL_NAMES:
        token = await asyncio.to_thread(get_user_github_token, user_id)
        if token:
            kwargs["github_token"] = token
    elif name in GITLAB_TOOL_NAMES and gitlab_token:
        kwargs["gitlab_token"] = gitlab_token

    return await invoke_function(FUNCS[name], **kwargs)


async def call_tool(name: str, args: dict[str, Any], user_id: str, gitlab_token: Optional[str] = None) -> Any:
    if name in GITHUB_TOOL_NAMES or name in GITLAB_TOOL_NAMES:
        return await call_repo_tool(name, args, user_id, gitlab_token=gitlab_token)
    return await invoke_function(FUNCS[name], **args)
