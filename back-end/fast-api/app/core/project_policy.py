import re
from uuid import UUID

def parse_revision(value: str) -> int:
    match = re.fullmatch(r'"([1-9][0-9]{0,18})"', value)
    if match is None or int(match.group(1)) >= (1 << 63) - 1:
        raise ValueError('If-Match requires one strong quoted positive revision, for example "1"')
    return int(match.group(1))

def parse_operator_ids(value: str) -> frozenset[str]:
    result = set()
    for item in value.split(","):
        item = item.strip()
        if item:
            try:
                canonical = str(UUID(item))
            except ValueError as exc:
                raise ValueError("OPERATOR_USER_IDS requires canonical user UUIDs") from exc
            if item != canonical:
                raise ValueError("OPERATOR_USER_IDS requires canonical lowercase user UUIDs")
            result.add(item)
    return frozenset(result)

def write_origin_allowed(origin: str | None, authorization: str | None, allowed: list[str]) -> bool:
    if authorization and authorization.lower().startswith("bearer ") and authorization.split(" ", 1)[1].strip():
        return True
    return origin is not None and origin in allowed
