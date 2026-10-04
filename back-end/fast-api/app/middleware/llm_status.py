from __future__ import annotations

import httpx
import functools

from typing import Callable
from wsgiref import headers

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import PlainTextResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import Settings, _validate_http_url, local_env


class LLMStatusMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        llm_status_func: Callable | None = None,
        settings: Settings=Settings(),
    ) -> None:
        self.app = app
        self.settings = settings
        self.settings.FRONTEND_ORIGIN = _validate_http_url(
            "FRONTEND_ORIGIN",
            settings.FRONTEND_ORIGIN,
            allow_local_http=local_env,
        )

        self.settings.CORS_ALLOW_ORIGINS = [
            _validate_http_url(
                "CORS_ALLOW_ORIGINS",
                origin.strip(),
                allow_local_http=local_env,
            )
            for origin in settings.CORS_ALLOW_ORIGINS_RAW.split(",")
            if origin.strip()
        ]

        self.settings.validate()
        self.settings.require_database_configuration()
        self.settings.require_integration_encryption()

        self.check_llm_status = llm_status_func or self._default_check_llm_status

    async def _default_check_llm_status(self) -> None:
        """Check if the vLLM server is reachable and ready."""
        llm_health_url = self.settings.VLLM_HEALTH_ENDPOINT
        try:
            response = httpx.get(llm_health_url, timeout=5)
            response.raise_for_status()

            self.settings.VLLM_READY = response.status_code == 200
        except Exception as e:
            raise RuntimeError(f"vLLM server is not reachable at {llm_health_url.replace('/healthz', '')}: {e}")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        await self.check_llm_status()