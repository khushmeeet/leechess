"""Test-support endpoints. Never mounted unless LEECHESS_TEST_RESET=on.

The browser suite needs a clean database per test — otherwise every spec
inherits the games, puzzles, attempts and Leitner state the specs before it
left behind, and assertions like "the chart's newest point is my game" quietly
start depending on file order. Recreating the process per test is far too slow
(the analysis job's engine warm-up dominates), so the suite truncates through
this router instead.

The router is registered in app.main only when the kill switch is on, so in a
normal `make dev` or a deploy these paths do not exist at all — a stray POST
gets the same 404 as any other unknown route.
"""

import contextlib
import os

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import analysis
from app.db import Base, get_db
from app.endgame_drills import seed_drills

router = APIRouter(prefix="/testing", tags=["testing"])


def enabled() -> bool:
    return os.environ.get("LEECHESS_TEST_RESET", "off").lower() == "on"


@contextlib.contextmanager
def _no_analysis_in_flight():
    """Hold every engine slot, so no analysis job is between its own reads and
    its own commit while the tables go away. run_game_analysis does all of its
    work inside this semaphore, so holding it is the whole guarantee."""
    slots = [analysis._engine_slots for _ in range(analysis.ANALYSIS_CONCURRENCY)]
    for slot in slots:
        slot.acquire()
    try:
        yield
    finally:
        for slot in slots:
            slot.release()


@router.post("/reset")
def reset(db: Session = Depends(get_db)) -> dict:
    """Empty every table, then reseed the fixed endgame-drill catalog.

    Tables are walked from Base.metadata rather than listed here, so a model
    added later is cleared too instead of silently leaking between tests.
    """
    deleted = {}
    # Wait for any analysis job still running from the previous test. SQLite
    # hands out row ids from max(rowid)+1, so after a truncate the next game is
    # id 1 again — a job that outlived its own test would otherwise commit its
    # status onto whatever game 1 has become.
    with _no_analysis_in_flight():
        for table in reversed(Base.metadata.sorted_tables):
            result = db.execute(table.delete())
            if result.rowcount:
                deleted[table.name] = result.rowcount
        db.commit()

    # The catalog is startup-seeded state, not test data — a suite that wiped
    # it would see /endgames/next 404 for the rest of the run.
    drills = seed_drills(db)
    db.commit()
    return {"deleted": deleted, "drills_seeded": drills}
