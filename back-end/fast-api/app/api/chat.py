"""
Streaming chat endpoint: waits for the local vLLM backend to be ready, runs
one tool-calling round (routing risky tools through the pending-action
approval flow), then streams the final answer token-by-token.

Wire format on the same stream:
  1. NDJSON lines for backend-readiness/progress/error/confirmation events.
  2. SSE frames ("data: {...}\n\n") for model tokens once generation starts,
     terminated by "data: [DONE]\n\n".

Change from the previous version: `body.gitlab_token` is no longer read or
passed to call_tool(). GitLab credentials are now resolved server-side from
the encrypted integration store, the same way GitHub credentials already
are (see app/tools/dispatch.py). If your ChatRequest schema still declares a
`gitlab_token` field, it is safe to remove it once no caller supplies it.
"""
import json
import logging
import uuid
from typing import Any, AsyncIterator

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.auth.dependencies import current_user
from app.core.logging import log_event
from app.core.rate_limit import check_rate_limit
from app.core.streaming import json_line, sse
from app.schemas import ChatRequest
from app.services.backend_readiness_service import ensure_backend_ready
from app.services.pending_actions_service import create_pending_action_record
from app.services.vllm_service import call_vllm, vllm_token_stream
from app.tools.dispatch import FUNCS, call_tool
from app.tools.repo_tools import REPO_RISKY_TOOLS, REPO_TOOL_DEFINITIONS
from app.tools.web_search import WEB_SEARCH_TOOL_DEFINITION


router = APIRouter(prefix="/v1/chat", tags=["chat"])

TOOLS = [WEB_SEARCH_TOOL_DEFINITION] + REPO_TOOL_DEFINITIONS
RISKY_TOOLS = {"write_file", "run_shell"} | REPO_RISKY_TOOLS


def owns_conversation(user_id: str, conversation_id: str) -> bool:
    return True


@router.post("/completions")
async def chat_completions(body: ChatRequest, request: Request, user: dict[str, Any] = Depends(current_user)) -> StreamingResponse:
    trace_id = str(uuid.uuid4())
    user_id = user["user_id"]

    if not check_rate_limit(user_id):
        log_event(logging.WARNING, "rate_limit_exceeded", user_id=user_id, trace_id=trace_id)
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    if body.conversation_id and not owns_conversation(user_id, body.conversation_id):
        raise HTTPException(status_code=403, detail="Forbidden")

    async def event_stream() -> AsyncIterator[bytes]:
        client: httpx.AsyncClient = request.app.state.http_client
        ready = False

        async for event in ensure_backend_ready(client, trace_id):
            yield json_line(event)
            if event["type"] == "error":
                return
            if event["type"] == "progress" and event["phase"] == "ready":
                ready = True

        if not ready:
            return

        messages = list(body.history) + [{"role": "user", "content": body.message}]

        try:
            first_result = await call_vllm(client, messages, tools=TOOLS)
            assistant_message = first_result["choices"][0]["message"]
        except (httpx.HTTPError, KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
            log_event(logging.ERROR, "vllm_tool_planning_failed", error=str(exc), trace_id=trace_id)
            yield json_line({"type": "error", "message": "Model request failed. Please retry."})
            return

        tool_calls = assistant_message.get("tool_calls") or []
        if tool_calls:
            messages.append(assistant_message)

            for tool_call in tool_calls:
                function = tool_call.get("function", {})
                name = function.get("name")
                try:
                    args = json.loads(function.get("arguments", "{}"))
                except json.JSONDecodeError:
                    yield json_line({"type": "error", "message": "The model produced invalid tool arguments."})
                    return

                if not name or name not in FUNCS:
                    yield json_line({"type": "error", "message": f"Unknown tool requested: {name}"})
                    return

                if name in RISKY_TOOLS:
                    action_id = await create_pending_action_record(user_id, name, args, trace_id)
                    yield json_line({"type": "confirmation_required", "action_id": action_id, "tool_name": name, "args": args})
                    return

                try:
                    tool_result = await call_tool(name, args, user_id)
                except Exception as exc:
                    log_event(logging.ERROR, "tool_execution_failed", tool=name, error=str(exc), trace_id=trace_id)
                    tool_result = f"Tool execution failed: {exc}"

                messages.append({"role": "tool", "tool_call_id": tool_call.get("id"), "content": str(tool_result)})

        log_event(logging.INFO, "chat_completion_started", user_id=user_id, trace_id=trace_id)
        yield json_line({"type": "answer_start"})

        try:
            async for token_event in vllm_token_stream(client, messages):
                yield token_event
        except httpx.HTTPError as exc:
            log_event(logging.ERROR, "vllm_stream_failed", error=str(exc), trace_id=trace_id)
            yield sse({"type": "error", "message": "The model stream failed. Please retry."})
            yield b"data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )