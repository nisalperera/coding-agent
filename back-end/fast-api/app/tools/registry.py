"""
Generic string-keyed function registry used to dispatch non-streaming
"actions" without a long if/elif chain in the router.
"""
from typing import Any, Callable


class FunctionRegistry:
    def __init__(self) -> None:
        self._registry: dict[str, Callable[..., Any]] = {}

    def register(self, name: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            self._registry[name] = func
            return func
        return decorator

    async def execute(self, name: str, *args: Any, **kwargs: Any) -> Any:
        if name not in self._registry:
            raise ValueError(f"Function '{name}' is not registered.")
        result = self._registry[name](*args, **kwargs)
        if hasattr(result, "__await__"):
            return await result
        return result

    def __contains__(self, name: str) -> bool:
        return name in self._registry
