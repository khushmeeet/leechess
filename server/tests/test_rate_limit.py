"""The shared sliding-window counter.

Its whole reason for existing over the three bare dicts it replaced is that it
is bounded, so that is most of what is tested here: the counting is simple, the
not-growing-forever is the part that was wrong.
"""

import pytest

from app import rate_limit
from app.rate_limit import SlidingWindow, client_key

pytestmark = pytest.mark.unit


def test_it_counts_within_the_window():
    window = SlidingWindow(window_seconds=60, max_events=3)

    for _ in range(3):
        assert not window.exceeded("a")
        window.record("a")

    assert window.exceeded("a")


def test_keys_do_not_see_each_others_events():
    window = SlidingWindow(window_seconds=60, max_events=1)
    window.record("a")

    assert window.exceeded("a")
    assert not window.exceeded("b")


def test_events_leave_the_window(monkeypatch):
    window = SlidingWindow(window_seconds=60, max_events=1)
    window.record("a")
    assert window.exceeded("a")

    real = rate_limit.time.monotonic
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: real() + 61)

    assert not window.exceeded("a")


def test_clear_forgets_one_key():
    window = SlidingWindow(window_seconds=60, max_events=1)
    window.record("a")
    window.record("b")

    window.clear("a")

    assert not window.exceeded("a")
    assert window.exceeded("b")


def test_the_table_has_a_ceiling():
    """The failure this exists for: keyed on something a stranger chooses — a
    username that does not exist, an address they are dialling from — a dict
    that only drops a key when that key comes back never collects anything from
    traffic that never repeats itself."""
    window = SlidingWindow(window_seconds=600, max_events=10, max_keys=16)

    for n in range(5_000):
        window.record(f"key-{n}")

    assert len(window) <= 16


def test_eviction_drops_the_oldest_first():
    """So an attacker filling the table pushes their own earlier keys out
    rather than making room by forgetting somebody else's live count."""
    window = SlidingWindow(window_seconds=600, max_events=1, max_keys=4)
    window.record("first")
    for n in range(20):
        window.record(f"later-{n}")

    assert not window.exceeded("first")
    assert window.exceeded("later-19")


def test_expired_keys_are_swept_before_live_ones_are_evicted(monkeypatch):
    window = SlidingWindow(window_seconds=60, max_events=1, max_keys=4)
    for n in range(4):
        window.record(f"old-{n}")

    real = rate_limit.time.monotonic
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: real() + 61)
    window.record("fresh")

    assert len(window) == 1
    assert window.exceeded("fresh")


def test_retry_after_is_never_zero():
    window = SlidingWindow(window_seconds=60, max_events=1)
    window.record("a")

    assert window.retry_after("a") >= 1
    assert window.retry_after("never-seen") >= 1


class _Request:
    def __init__(self, client):
        self.client = client


class _Client:
    def __init__(self, host):
        self.host = host


def test_client_key_reads_the_peer_address():
    assert client_key(_Request(_Client("203.0.113.7"))) == "203.0.113.7"


def test_client_key_survives_a_request_with_no_client():
    """ASGI does not promise one, and a limiter that raises is a limiter that
    fails open."""
    assert client_key(_Request(None)) == "unknown"
    assert client_key(_Request(_Client(""))) == "unknown"
