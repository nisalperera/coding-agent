"""Structured JSON logging helper shared across the whole app."""
import json
import logging
import time
import uuid
from typing import Any

logger = logging.getLogger("coding-agent")
logger.setLevel(logging.INFO)

if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)


def log_event(level: int, message: str, **fields: Any) -> None:
    logger.log(
        level,
        json.dumps({
            "timestamp": time.time(),
            "level": logging.getLevelName(level),
            "trace_id": fields.pop("trace_id", str(uuid.uuid4())),
            "message": message,
            **fields,
        }),
    )
