"""Where password hashing is actually paid for, and how much of it may run.

An argon2 hash is memory-hard on purpose: the default parameters here are
64mb and about 100ms of CPU each. That is the right cost for a password and
the wrong thing to let a stranger ask for without limit — eight of them at
once is the whole of a 512mb Fly machine, and the sign-in route hashes even
when the username does not exist (app/auth/manager.py, so response time does
not reveal which names are real).

Two things happen here, and neither is about how *often* the work may be
asked for — that is app/auth/throttle.py's job:

**A ceiling on how many hashes run at once,** which is what bounds peak
memory. A caller who arrives while every slot is busy waits briefly and is
then told the server is busy, rather than being queued into an
out-of-memory alongside everyone else.

**Getting the work off the event loop.** These calls used to run inline in
`async def` handlers, so every sign-in stalled the single worker's loop for
the duration of the hash — every other request, and every live game's socket,
waited on somebody's password. A threadpool hop is all that was missing.
"""

import os
import threading

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool

# Peak memory is this times argon2's memory_cost (64mb by default), so it is
# the number that has to fit in the machine rather than the number that makes
# sign-ins fastest. Two slots is ~22 hashes/second, orders of magnitude more
# than this app sees.
CONCURRENCY = int(os.environ.get("LEECHESS_PASSWORD_HASH_CONCURRENCY", "2"))
# How long to wait for a slot before giving up. Long enough that ordinary
# contention is invisible, short enough that waiters cannot themselves pile up
# into the resource exhaustion this is here to prevent.
WAIT_SECONDS = float(os.environ.get("LEECHESS_PASSWORD_HASH_WAIT", "2.5"))

_slots = threading.BoundedSemaphore(CONCURRENCY)


class ServerBusy(HTTPException):
    """Every hashing slot was taken for longer than a caller should wait.

    A 503 rather than a 429: the caller has done nothing wrong and their own
    rate limit is not what refused them, so telling them to slow down would be
    a lie. Retry-After keeps a well-behaved client from making it worse.
    """

    def __init__(self) -> None:
        super().__init__(
            status_code=503,
            detail="SERVER_BUSY",
            headers={"Retry-After": "5"},
        )


def _under_a_slot(work):
    """Run `work` holding one hashing slot, in whichever worker thread this is.

    The wait happens inside the thread rather than on the loop so that a
    blocked hash blocks nothing else, and it is bounded so that the threadpool
    cannot fill with waiters.
    """
    if not _slots.acquire(timeout=WAIT_SECONDS):
        raise ServerBusy()
    try:
        return work()
    finally:
        _slots.release()


async def hash_password(password_helper, password: str) -> str:
    return await run_in_threadpool(_under_a_slot, lambda: password_helper.hash(password))


async def verify_and_update(
    password_helper, password: str, hashed_password: str
) -> tuple[bool, str | None]:
    return await run_in_threadpool(
        _under_a_slot,
        lambda: password_helper.verify_and_update(password, hashed_password),
    )
