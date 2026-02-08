# Python async / asyncio

## Common pitfalls

- Forgetting to `await` coroutines: you get a coroutine object, not the result.
- Mixing sync and async: avoid blocking calls inside async def; use `run_in_executor` if needed.
- Not closing the event loop or not using `async with` for resources.

## Fixing async bugs

1. Ensure all async functions are defined with `async def` and called with `await`.
2. Use `asyncio.run()` at the top level to start the event loop.
3. Prefer `async with` for aiohttp, aiofiles, and other async context managers.

## Testing async code

- Use `pytest-asyncio` and mark tests with `@pytest.mark.asyncio`.
- Or use `asyncio.run()` inside a sync test to run a single coroutine.
