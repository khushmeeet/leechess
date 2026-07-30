"""The failed-sign-in limiter.

There is no password reset to abuse and nothing behind an account worth
cracking, so this exists only to make online guessing pointless. It is
in-process module state — which is also why conftest resets it around every
test.
"""

import pytest

from app.auth import throttle

pytestmark = pytest.mark.unit

CREDENTIALS = {"username": "alice", "password": "correct-horse"}
WRONG = {"username": "alice", "password": "wrong"}


def _fail_repeatedly(client, times, credentials=WRONG):
    return [client.post("/auth/login", json=credentials) for _ in range(times)]


def test_repeated_failures_are_eventually_refused(anon_client):
    anon_client.post("/auth/register", json=CREDENTIALS)
    anon_client.post("/auth/logout")

    responses = _fail_repeatedly(anon_client, throttle.MAX_FAILURES + 1)

    assert [r.status_code for r in responses[:-1]] == [400] * throttle.MAX_FAILURES
    assert responses[-1].status_code == 429
    assert responses[-1].json()["detail"] == "TOO_MANY_ATTEMPTS"
    assert int(responses[-1].headers["Retry-After"]) > 0


def test_the_right_password_is_refused_too_once_locked_out(anon_client):
    """Otherwise the limit is trivially sidestepped by the attacker who just
    guessed correctly."""
    anon_client.post("/auth/register", json=CREDENTIALS)
    anon_client.post("/auth/logout")
    _fail_repeatedly(anon_client, throttle.MAX_FAILURES)

    assert anon_client.post("/auth/login", json=CREDENTIALS).status_code == 429


def test_a_successful_sign_in_clears_the_count(anon_client):
    """Someone mistyping their own password a few times should not be a step
    closer to being locked out for the rest of the window."""
    anon_client.post("/auth/register", json=CREDENTIALS)
    anon_client.post("/auth/logout")
    _fail_repeatedly(anon_client, throttle.MAX_FAILURES - 1)

    assert anon_client.post("/auth/login", json=CREDENTIALS).status_code == 200
    anon_client.post("/auth/logout")

    assert anon_client.post("/auth/login", json=WRONG).status_code == 400


def test_the_limit_is_per_username(anon_client):
    anon_client.post("/auth/register", json=CREDENTIALS)
    anon_client.post("/auth/logout")
    _fail_repeatedly(anon_client, throttle.MAX_FAILURES)

    other = anon_client.post("/auth/login", json={"username": "bob", "password": "wrong"})
    assert other.status_code == 400


def test_the_limit_follows_the_canonical_name(anon_client):
    """Otherwise `ALICE` is a free extra ten guesses at alice's password."""
    anon_client.post("/auth/register", json=CREDENTIALS)
    anon_client.post("/auth/logout")
    _fail_repeatedly(anon_client, throttle.MAX_FAILURES)

    assert (
        anon_client.post("/auth/login", json={"username": "ALICE", "password": "wrong"}).status_code
        == 429
    )


def test_attempts_outside_the_window_are_forgotten(anon_client, monkeypatch):
    anon_client.post("/auth/register", json=CREDENTIALS)
    anon_client.post("/auth/logout")
    _fail_repeatedly(anon_client, throttle.MAX_FAILURES)
    assert anon_client.post("/auth/login", json=WRONG).status_code == 429

    real_monotonic = throttle.time.monotonic
    monkeypatch.setattr(
        throttle.time,
        "monotonic",
        lambda: real_monotonic() + throttle.WINDOW_SECONDS + 1,
    )

    assert anon_client.post("/auth/login", json=CREDENTIALS).status_code == 200
