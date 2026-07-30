import time

# Deliberately small and in-process. There is no password reset to abuse and
# nothing behind an account worth cracking, so the job here is only to make
# online guessing pointless — not to survive a restart or coordinate across
# machines (leechess runs on one). A dict is the proportionate answer; a Redis
# dependency would not be.
WINDOW_SECONDS = 15 * 60
MAX_FAILURES = 10

_failures: dict[str, list[float]] = {}


class TooManyAttempts(Exception):
    """Raised on the request that would have been one failure too many."""

    def __init__(self, retry_after: int) -> None:
        super().__init__("too many failed sign-in attempts")
        self.retry_after = retry_after


def _recent(key: str, now: float) -> list[float]:
    recent = [at for at in _failures.get(key, []) if now - at < WINDOW_SECONDS]
    if recent:
        _failures[key] = recent
    else:
        _failures.pop(key, None)
    return recent


def check(key: str) -> None:
    now = time.monotonic()
    recent = _recent(key, now)
    if len(recent) >= MAX_FAILURES:
        raise TooManyAttempts(retry_after=int(WINDOW_SECONDS - (now - recent[0])) + 1)


def record_failure(key: str) -> None:
    now = time.monotonic()
    _failures.setdefault(key, []).append(now)
    _recent(key, now)


def clear(key: str) -> None:
    """Called on a successful sign-in: the failures were someone mistyping
    their own password, not an attack."""
    _failures.pop(key, None)


def reset() -> None:
    """Test support — this is module state, so it outlives the app instance and
    would otherwise leak between tests."""
    _failures.clear()
