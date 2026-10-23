"""Self-hosted application entry point. Alembic migrations run separately."""
from contextlib import asynccontextmanager
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import actions, auth, chat, health, integration, projects, settings as app_settings, conversations
from app.auth.operator_access import operator_user_ids
from app.auth.session_cookie import session_cookie_options
from app.core.config import settings
from app.db.database import assert_database_ready, dispose_database_engine, dispose_mongodb_client, initialize_mongodb

@asynccontextmanager
async def lifespan(app: FastAPI):
    session_cookie_options()  # Fail closed before database startup on invalid cookie policy.
    operator_user_ids()
    assert_database_ready()
    await initialize_mongodb()
    app.state.http_client = httpx.AsyncClient(timeout=settings.HTTP_TIMEOUT_S)
    app.state.google_discovery = None
    try:
        yield
    finally:
        await app.state.http_client.aclose()
        await dispose_mongodb_client()
        dispose_database_engine()

app = FastAPI(title=settings.APP_NAME, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.CORS_ALLOW_ORIGINS,
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"], expose_headers=["ETag"])
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(actions.router)
app.include_router(chat.router)
app.include_router(integration.router)
app.include_router(integration.integration_status_router)
app.include_router(app_settings.router)
app.include_router(conversations.router)
app.include_router(projects.router)
