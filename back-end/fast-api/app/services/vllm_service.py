"""Client for the self-hosted vLLM OpenAI-compatible server (localhost or LAN)."""
import time
import json
import logging
from typing import Any, AsyncIterator, Optional

import httpx

from app.core.config import settings
from app.core.streaming import sse
from app.core.logging import log_event


VLLM_HEALTH_TIMEOUT = httpx.Timeout(
    connect=15.0,
    read=10.0,
    write=10.0,
    pool=5.0,
)

async def is_vllm_ready(client: httpx.AsyncClient) -> bool:
    endpoint = settings.VLLM_HEALTH_ENDPOINT

    try:
        response = await client.get(
            endpoint,
            timeout=VLLM_HEALTH_TIMEOUT,
        )

        ready = response.status_code == httpx.codes.OK

        log_event(
            logging.INFO if ready else logging.WARNING,
            message=(
                "vLLM health check completed: "
                f"endpoint={endpoint}, "
                f"status_code={response.status_code}, "
                f"ready={ready}"
            ),
            trace_id="N/A",
        )

        return ready

    except httpx.TimeoutException as exc:
        log_event(
            logging.WARNING,
            message=(
                "vLLM health check timed out: "
                f"endpoint={endpoint}, "
                f"exception_type={type(exc).__name__}, "
                f"error={exc!r}"
            ),
            trace_id="N/A",
        )
        return False

    except httpx.RequestError as exc:
        log_event(
            logging.WARNING,
            message=(
                "vLLM health check request failed: "
                f"endpoint={endpoint}, "
                f"exception_type={type(exc).__name__}, "
                f"error={exc!r}"
            ),
            trace_id="N/A",
        )
        return False


async def call_vllm(client: httpx.AsyncClient, messages: list[dict[str, Any]], tools: Optional[list[dict[str, Any]]] = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"model": settings.MODEL_NAME, "messages": messages, "stream": False}
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    response = await client.post(settings.VLLM_ENDPOINT, json=payload)
    if response.status_code >= 400:
        log_event(
            logging.INFO,
            "vllm_request_rejected",
            **{
                "status_code": response.status_code,
                "response_headers": dict(response.headers),
                "response_body": response.text,
                "request_url": str(response.request.url),
                "request_headers": {
                    key: value
                    for key, value in response.request.headers.items()
                    if key.lower() not in {
                        "authorization",
                        "cookie",
                        "x-api-key",
                        "proxy-authorization",
                    }
                },
            },
        )
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
