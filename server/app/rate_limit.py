"""One sliding-window counter, shared by everything in here that has to say no.

There were three of these before — the failed-sign-in counter, the
friend-game create limit, and nothing at all in front of registration — and
each was a bare module-level dict that only ever *grew*. A dict keyed on
something a stranger chooses (a username that does not exist, an address they
are dialling from) is a memory leak with extra steps: entries were dropped
only when that same key was touched again, so traffic that never repeats
itself never collected anything. On a 512mb machine that is the whole attack.

So: still in-process and still deliberately crude — leechess runs one machine
and one worker, and a Redis dependency would be a bigger change than the
problem justifies — but bounded on both axes. Old windows are swept on every
touch, and the key count has a ceiling with the least-recently-used key
evicted past it. Evicting means an attacker filling the table pushes their own
earlier keys out, not that the limiter fails open for everyone else.
"""

import time
from collections import OrderedDict

# Enough for the traffic one small machine sees, small enough that a full
# table is a rounding error against the VM's memory.
DEFAULT_MAX_KEYS = 4096


class SlidingWindow:
    """Counts timestamped events per key over a rolling window.

    Deliberately not a decorator or a middleware: the callers want different
    things from it. The sign-in limiter counts only *failures* and clears the
    count on success; the create limiter counts every call. Both are that,
    plus a policy the caller owns.
    """

    def __init__(
        self,
        *,
        window_seconds: float,
        max_events: int,
        max_keys: int = DEFAULT_MAX_KEYS,
    ) -> None:
        self.window_seconds = window_seconds
        self.max_events = max_events
        self.max_keys = max_keys
        # Ordered by least-recently-touched, which is what makes eviction cheap.
        self._events: OrderedDict[str, list[float]] = OrderedDict()

    # monotonic, not wall clock: a clock stepped backwards by ntp would
    # otherwise leave every recorded event in the future and the limit stuck on.
    def _now(self) -> float:
        return time.monotonic()

    def _recent(self, key: str, now: float) -> list[float]:
        recent = [at for at in self._events.get(key, ()) if now - at < self.window_seconds]
        if recent:
            self._events[key] = recent
            self._events.move_to_end(key)
        else:
            self._events.pop(key, None)
        return recent

    def _evict(self) -> None:
        """Drop expired keys first, and only then the oldest surviving ones.

        Sweeping the whole table on every call would be quadratic under the
        traffic this exists to survive, so it runs only when the table is
        actually full — which is the moment it matters.
        """
        if len(self._events) <= self.max_keys:
            return
        now = self._now()
        for key in [k for k, ats in self._events.items() if now - ats[-1] >= self.window_seconds]:
            del self._events[key]
        while len(self._events) > self.max_keys:
            self._events.popitem(last=False)

    def count(self, key: str) -> int:
        """Events recorded against `key` inside the window."""
        return len(self._recent(key, self._now()))

    def exceeded(self, key: str) -> bool:
        return self.count(key) >= self.max_events

    def retry_after(self, key: str) -> int:
        """Seconds until `key` is under the limit again — at least 1, so a
        Retry-After never tells a caller to come back immediately."""
        now = self._now()
        recent = self._recent(key, now)
        if not recent:
            return 1
        return max(1, int(self.window_seconds - (now - recent[0])) + 1)

    def record(self, key: str) -> None:
        self._events.setdefault(key, []).append(self._now())
        self._events.move_to_end(key)
        self._evict()

    def clear(self, key: str) -> None:
        self._events.pop(key, None)

    def reset(self) -> None:
        """Test support — these live at module scope, so they outlive the app
        instance and would otherwise leak between tests."""
        self._events.clear()

    def __len__(self) -> int:
        return len(self._events)


def client_key(request) -> str:
    """Who to hold a limit against.

    `request.client.host` is only the caller if uvicorn was told to trust the
    proxy in front of it — see the `--forwarded-allow-ips` flag in the
    Dockerfile. Without it every request behind Fly's proxy arrives wearing the
    proxy's address, which collapses every caller into one bucket and turns a
    per-caller limit into a global one. That was a real bug, not a hypothetical.
    """
    client = getattr(request, "client", None)
    return client.host if client and client.host else "unknown"
