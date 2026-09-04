"""
Application entry point.

Run locally with:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload

Zero AWS dependencies: no boto3, no Cognito, no EC2, no DynamoDB. Identity is
Google OAuth + local SQLite sessions. External calls go only to Google
(OAuth), GitHub/GitLab (repo tools), Tavily (web search), and your local/LAN
vLLM server.
"""
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import actions, auth, chat, health, integration
from app.core.config import settings
from app.db.database import assert_database_ready, dispose_database_engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    assert_database_ready()

    app.state.http_client = httpx.AsyncClient(timeout=settings.HTTP_TIMEOUT_S)
    app.state.google_discovery = None

    try:
        yield
    finally:
        await app.state.http_client.aclose()
        dispose_database_engine()


app = FastAPI(title=settings.APP_NAME, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(actions.router)
app.include_router(chat.router)
app.include_router(integration.router)
