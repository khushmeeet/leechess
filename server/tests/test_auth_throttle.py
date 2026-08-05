"""The sign-in and sign-up limiters.

Three limits with three jobs — see app/auth/throttle.py. What the tests below
are mostly pinning down is the difference between them, because collapsing
them back into one per-username counter is the easy mistake and it is the one
that turns this from a defence into a weapon: ten deliberate failures from a
stranger used to lock the real owner out of their own account.

All of it is in-process module state, which is why conftest resets it around
every test.
"""

import pytest

from app import rate_limit
from app.auth import router as auth_router, throttle

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


def test_a_stranger_cannot_lock_the_owner_out(anon_client, monkeypatch):
    """The whole reason the block is keyed on the address as well as the name.

    Keyed on the name alone, this is a denial of service anyone can aim at
    anyone: ten wrong guesses and the owner is refused for fifteen minutes
    holding the correct password — and with no reset in this app, being
    refused is the whole of their recourse.
    """
    anon_client.post("/auth/register", json=CREDENTIALS)
    anon_client.post("/auth/logout")

    monkeypatch.setattr(auth_router, "client_key", lambda request: "203.0.113.9")
    _fail_repeatedly(anon_client, throttle.MAX_FAILURES)
    assert anon_client.post("/auth/login", json=WRONG).status_code == 429

    monkeypatch.setattr(auth_router, "client_key", lambda request: "198.51.100.4")
    assert anon_client.post("/auth/login", json=CREDENTIALS).status_code == 200


def test_one_account_is_still_protected_across_many_sources(anon_client, monkeypatch):
    """The backstop under the per-source block: a guessing attack spread over
    enough addresses to sidestep it still runs out eventually."""
    anon_client.post("/auth/register", json=CREDENTIALS)
    anon_client.post("/auth/logout")

    # Lowered rather than driven to the real ceiling: every attempt here is a
    # real argon2 verify, and fifty of them is five seconds of suite time to
    # demonstrate something six proves just as well.
    ceiling = 6
    monkeypatch.setattr(throttle._account_failures, "max_events", ceiling)

    for source in range(ceiling):
        monkeypatch.setattr(auth_router, "client_key", lambda request, s=source: f"10.0.0.{s}")
        assert anon_client.post("/auth/login", json=WRONG).status_code == 400

    monkeypatch.setattr(auth_router, "client_key", lambda request: "10.9.9.9")
    assert anon_client.post("/auth/login", json=WRONG).status_code == 429


def test_one_source_may_only_ask_for_so_much_hashing(anon_client, monkeypatch):
    """Not about guessing at all.

    Verifying a password is a 64mb argon2 hash, paid even for a username that
    does not exist. Rotating the name walks straight past a per-name limit, so
    the number of times one address may demand that work is capped on its own.
    """
    ceiling = 5  # the real one is MAX_ATTEMPTS_PER_SOURCE; see the note above
    monkeypatch.setattr(throttle._source_attempts, "max_events", ceiling)

    codes = [
        anon_client.post(
            "/auth/login", json={"username": f"ghost{attempt}", "password": "x"}
        ).status_code
        for attempt in range(ceiling + 1)
    ]

    # Every name is different, so the per-name limits never see a second
    # attempt — this is the only thing standing between one caller and
    # unlimited hashing.
    assert codes == [400] * ceiling + [429]


def test_registration_is_capped_per_source(anon_client, monkeypatch):
    ceiling = 3  # the real one is MAX_REGISTRATIONS_PER_SOURCE
    monkeypatch.setattr(throttle._registrations, "max_events", ceiling)

    codes = [
        anon_client.post(
            "/auth/register", json={"username": f"newbie{n}", "password": "aaaaaaaa"}
        ).status_code
        for n in range(ceiling + 1)
    ]

    assert codes == [200] * ceiling + [429]


def test_failed_sign_ins_do_not_accumulate_keys_forever(monkeypatch):
    """The counter used to be a plain dict that only dropped a key when that
    same key came back — so traffic that never repeats itself, which is what an
    attack looks like, collected entries until the machine ran out."""
    window = throttle._source_account_failures
    monkeypatch.setattr(window, "max_keys", 8)

    for attempt in range(40):
        window.record(f"10.0.0.1\nnobody{attempt}")

    assert len(window) <= 8


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

    real_monotonic = rate_limit.time.monotonic
    monkeypatch.setattr(
        rate_limit.time,
        "monotonic",
        lambda: real_monotonic() + throttle.WINDOW_SECONDS + 1,
    )

    assert anon_client.post("/auth/login", json=CREDENTIALS).status_code == 200
