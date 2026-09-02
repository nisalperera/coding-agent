"""Web search tool backed by the Tavily API."""
import json

import httpx

from app.core.config import settings


async def web_search(query: str) -> str:
    async with httpx.AsyncClient(timeout=settings.HTTP_TIMEOUT_S) as client:
        response = await client.get("https://api.tavily.com/search", params={"q": query, "api_key": settings.TAVILY_API_KEY})
        response.raise_for_status()
    results = response.json().get("results", [])[:3]
    return json.dumps([
        {"title": r.get("title", ""), "url": r.get("url", ""), "snippet": r.get("content", "")[:200]}
        for r in results
    ])


WEB_SEARCH_TOOL_DEFINITION = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "Search the web for current information",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
    },
}
