"""What stops someone hammering the sign-in and sign-up routes.

Three limits, because they answer three different questions, and the old
single per-username counter conflated them badly enough to be a weapon:

*Per source, per account.* Ten wrong guesses at one name from one address and
that pairing is done for the window. This is the anti-guessing limit, and it
is keyed on the address as well as the name for a reason — keyed on the name
alone, ten deliberate failures from a stranger locked the real owner out of
their own account with the correct password in hand. The limit is supposed to
cost the attacker something, not the person being attacked.

*Per account, across sources.* A much higher ceiling, as a backstop against a
guessing attack spread over many addresses. High enough that one attacker
cannot cheaply reach it and take the account offline, low enough to matter to
somebody driving a botnet at one name. This is the honest compromise: without
shared state there is no way to be strict here *and* immune to being used as a
denial-of-service against a user, so it errs toward keeping people signed in.

*Per source, every attempt.* This one is not about guessing at all. Verifying
a password is an argon2 hash — 64mb of memory and ~100ms of CPU, paid even
when the username does not exist (app/auth/manager.py hashes anyway so the
response time gives nothing away). On a 512mb machine that is an
out-of-memory in single digits of concurrency, so the number of times an
anonymous caller may ask for that work is capped on its own, separately from
whether they are getting the answer right. Registration is capped the same
way, for the same reason.

Still in-process and still deliberately crude — one machine, one worker — but
the state underneath is bounded now; see app/rate_limit.py.
"""

from app.rate_limit import SlidingWindow

WINDOW_SECONDS = 15 * 60

# One address guessing at one account.
MAX_FAILURES = 10
# One account, summed over every address — the distributed backstop.
MAX_FAILURES_PER_ACCOUNT = 50
# Every sign-in attempt from one address, right or wrong: the argon2 budget.
MAX_ATTEMPTS_PER_SOURCE = 60

# Sign-ups are rarer than sign-ins by orders of magnitude, so this can be
# tight. It is the only unauthenticated route that writes a row *and* hashes.
REGISTRATION_WINDOW_SECONDS = 60 * 60
MAX_REGISTRATIONS_PER_SOURCE = 10

_source_account_failures = SlidingWindow(
    window_seconds=WINDOW_SECONDS, max_events=MAX_FAILURES
)
_account_failures = SlidingWindow(
    window_seconds=WINDOW_SECONDS, max_events=MAX_FAILURES_PER_ACCOUNT
)
_source_attempts = SlidingWindow(
    window_seconds=WINDOW_SECONDS, max_events=MAX_ATTEMPTS_PER_SOURCE
)
_registrations = SlidingWindow(
    window_seconds=REGISTRATION_WINDOW_SECONDS, max_events=MAX_REGISTRATIONS_PER_SOURCE
)

_ALL = (_source_account_failures, _account_failures, _source_attempts, _registrations)


class TooManyAttempts(Exception):
    """Raised on the request that would have been one too many."""

    def __init__(self, retry_after: int) -> None:
        super().__init__("too many attempts")
        self.retry_after = retry_after


def _pair(source: str, account: str) -> str:
    # The address cannot contain a newline (it is an IP), so this is
    # unambiguous without any escaping to get wrong.
    return f"{source}\n{account}"


def check_login(source: str, account: str) -> None:
    """Raise if this sign-in must not be attempted. Called before the password
    is verified, so a refused attempt costs no argon2 work at all."""
    for window, key in (
        (_source_attempts, source),
        (_source_account_failures, _pair(source, account)),
        (_account_failures, account),
    ):
        if window.exceeded(key):
            raise TooManyAttempts(retry_after=window.retry_after(key))
    # Counted here rather than after the verify: the cost is incurred by
    # asking, and an attempt abandoned mid-flight still spent the hash.
    _source_attempts.record(source)


def record_login_failure(source: str, account: str) -> None:
    _source_account_failures.record(_pair(source, account))
    _account_failures.record(account)


def clear_login(source: str, account: str) -> None:
    """Called on a successful sign-in: those failures were someone mistyping
    their own password, not an attack.

    Only this address's count against the account is cleared. The cross-source
    tally is not, because "somebody, somewhere, signed in successfully" is
    exactly what an attacker who has just guessed right would produce.
    """
    _source_account_failures.clear(_pair(source, account))


def check_registration(source: str) -> None:
    if _registrations.exceeded(source):
        raise TooManyAttempts(retry_after=_registrations.retry_after(source))
    _registrations.record(source)


def reset() -> None:
    """Test support — this is module state, so it outlives the app instance and
    would otherwise leak between tests."""
    for window in _ALL:
        window.reset()
