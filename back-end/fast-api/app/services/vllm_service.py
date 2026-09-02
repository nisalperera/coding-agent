"""Client for the self-hosted vLLM OpenAI-compatible server (localhost or LAN)."""
import json
from typing import Any, AsyncIterator, Optional

import httpx

from app.core.config import settings
from app.core.streaming import sse


async def is_vllm_ready(client: httpx.AsyncClient) -> bool:
    try:
        response = await client.get(settings.VLLM_HEALTH_ENDPOINT, timeout=5.0)
        return response.status_code == 200
    except httpx.HTTPError:
        return False


async def call_vllm(client: httpx.AsyncClient, messages: list[dict[str, Any]], tools: Optional[list[dict[str, Any]]] = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"model": settings.MODEL_NAME, "messages": messages, "stream": False}
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    response = await client.post(settings.VLLM_ENDPOINT, json=payload)
    response.raise_for_status()
    return response.json()


async def vllm_token_stream(client: httpx.AsyncClient, messages: list[dict[str, Any]]) -> AsyncIterator[bytes]:
    payload = {"model": settings.MODEL_NAME, "messages": messages, "stream": True}
    async with client.stream("POST", settings.VLLM_ENDPOINT, json=payload) as response:
        response.raise_for_status()
        async for line in response.aiter_lines():
            if not line.startswith("data: "):
                continue
            data = line[6:]
            if data == "[DONE]":
                break
            try:
                delta = json.loads(data)["choices"][0]["delta"].get("content", "")
            except (json.JSONDecodeError, KeyError, IndexError, TypeError):
                continue
            if delta:
                yield sse({"token": delta})
    yield b"data: [DONE]\n\n"
