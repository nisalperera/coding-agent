"""
Local replacement for the old EC2-start-and-wait logic. There is no cloud
instance to start locally: vLLM is either already running or it is not.
This only polls vLLM's /health endpoint until it responds, respecting the
same STARTUP_BUDGET_S. Optional autostart hook included.
"""
import asyncio
import logging
import os
import shlex
import subprocess
import time
from typing import Any, AsyncIterator, Optional

import httpx

from app.core.config import settings
from app.core.logging import log_event
from app.services.vllm_service import is_vllm_ready

VLLM_AUTOSTART_CMD: Optional[str] = os.environ.get("VLLM_AUTOSTART_CMD")
_autostart_attempted = False


def _try_autostart_local_vllm(trace_id: str) -> None:
    global _autostart_attempted
    if not VLLM_AUTOSTART_CMD or _autostart_attempted:
        return
    _autostart_attempted = True
    try:
        subprocess.Popen(
            shlex.split(VLLM_AUTOSTART_CMD),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        log_event(logging.INFO, "vllm_autostart_launched", trace_id=trace_id)
    except Exception as exc:
        log_event(logging.ERROR, "vllm_autostart_failed", error=str(exc), trace_id=trace_id)


async def ensure_backend_ready(client: httpx.AsyncClient, trace_id: str) -> AsyncIterator[dict[str, Any]]:
    start_time = time.monotonic()
    deadline = start_time + settings.STARTUP_BUDGET_S

    if await is_vllm_ready(client):
        yield {"type": "progress", "phase": "ready", "percent": 100, "elapsed_seconds": 0.0, "message": "Backend ready."}
        log_event(logging.INFO, "vllm_already_ready", trace_id=trace_id)
        return

    log_event(logging.INFO, "vllm_not_ready_waiting", trace_id=trace_id)
    yield {
        "type": "progress", "phase": "loading_model", "percent": 0, "elapsed_seconds": 0.0,
        "message": "Waiting for local model server to become ready...",
    }
    _try_autostart_local_vllm(trace_id)

    while not await is_vllm_ready(client):
        elapsed = time.monotonic() - start_time
        if time.monotonic() >= deadline:
            log_event(logging.ERROR, "vllm_ready_timeout", trace_id=trace_id)
            yield {
                "type": "error",
                "message": f"Model is still loading. Please try again in {settings.RETRY_AFTER_S // 60} minutes.",
                "retry_after_seconds": settings.RETRY_AFTER_S,
            }
            return

        yield {
            "type": "progress", "phase": "loading_model",
            "percent": min(99, int((elapsed / settings.STARTUP_BUDGET_S) * 100)),
            "elapsed_seconds": round(elapsed, 1), "message": "Loading model...",
        }
        await asyncio.sleep(settings.POLL_INTERVAL_S)

    elapsed = time.monotonic() - start_time
    log_event(logging.INFO, "vllm_ready", elapsed=round(elapsed, 1), trace_id=trace_id)
    yield {"type": "progress", "phase": "ready", "percent": 100, "elapsed_seconds": round(elapsed, 1), "message": "Backend ready."}
