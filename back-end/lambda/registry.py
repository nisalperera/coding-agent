class FunctionRegistry:
    def __init__(self):
        # The underlying dictionary storing the function references
        self._registry = {}

    def register(self, name: str):
        """A decorator factory to map a string key to a function."""
        def decorator(func):
            self._registry[name] = func
            return func  # Return intact to allow normal usage
        return decorator

    def execute(self, name: str, *args, **kwargs):
        """Looks up and executes the function dynamically."""
        if name not in self._registry:
            raise ValueError(f"Function '{name}' is not registered.")
        return self._registry[name](*args, **kwargs)