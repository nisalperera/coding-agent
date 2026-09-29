"""NDJSON / SSE frame helpers used by the streaming chat endpoint."""
import json
from typing import Any


def json_line(payload: dict[str, Any]) -> bytes:
    return (json.dumps(payload, separators=(",", ":")) + "\n").encode("utf-8")


def sse(payload: dict[str, Any]) -> bytes:
    return ("data: " + json.dumps(payload, separators=(",", ":")) + "\n\n").encode("utf-8")
