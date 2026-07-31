"""Per-account Leitner state for the shared puzzle and drill catalogs.

The generic Lichess pool and the twelve endgame drills are one set of rows
that every account works through, so "which box is this in, and when is it
due" cannot live on the content row. It lives in puzzle_states /
endgame_drill_states, keyed by (user, item).

Rows are written lazily, on the first attempt. The absence of one means
"never seen", which the queues read as due now — so a new account finds the
whole catalog waiting without anything having been inserted for it, and
adding a puzzle to the pool needs no per-account fan-out.

app/spaced_repetition.py stays pure: it computes the next (box, due_at) and
knows nothing about rows.
"""

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import EndgameDrillState, PuzzleState
from app.spaced_repetition import MIN_BOX, schedule_attempt


def _first_attempt_row(db: Session, row, reread):
    """Insert a state row, conceding to whoever got there first.

    Two attempts on a never-seen item race: both find no state and both
    insert, and the (user, item) unique index turns the loser into a 500. The
    savepoint keeps the failed insert from taking the surrounding transaction
    with it, so the loser can just re-read and carry on.
    """
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
        return row
    except IntegrityError:
        existing = reread()
        if existing is None:  # not the race, then — something else is wrong
            raise
        return existing


def puzzle_state(db: Session, user_id: uuid.UUID, puzzle_id: int) -> PuzzleState | None:
    return db.scalars(
        select(PuzzleState).where(
            PuzzleState.user_id == user_id, PuzzleState.puzzle_id == puzzle_id
        )
    ).one_or_none()


def drill_state(
    db: Session, user_id: uuid.UUID, drill_id: int
) -> EndgameDrillState | None:
    return db.scalars(
        select(EndgameDrillState).where(
            EndgameDrillState.user_id == user_id,
            EndgameDrillState.drill_id == drill_id,
        )
    ).one_or_none()


def record_puzzle_attempt(
    db: Session,
    user_id: uuid.UUID,
    puzzle_id: int,
    *,
    correct: bool,
    hint_level_used: int,
    now: datetime,
) -> PuzzleState:
    """Advance (or reset) this account's box for a puzzle, creating the state
    row if this is the first time they have answered it."""
    state = puzzle_state(db, user_id, puzzle_id)
    if state is None:
        state = _first_attempt_row(
            db,
            PuzzleState(user_id=user_id, puzzle_id=puzzle_id, box=MIN_BOX),
            lambda: puzzle_state(db, user_id, puzzle_id),
        )
    state.box, state.due_at = schedule_attempt(
        state.box, correct, hint_level_used, now
    )
    return state


def record_drill_attempt(
    db: Session,
    user_id: uuid.UUID,
    drill_id: int,
    *,
    success: bool,
    now: datetime,
) -> EndgameDrillState:
    """As above for endgame drills. hint_level_used is always 0: a drill has
    no hint ladder, so the rule that holds a puzzle's box when the move was
    revealed cannot apply."""
    state = drill_state(db, user_id, drill_id)
    if state is None:
        state = _first_attempt_row(
            db,
            EndgameDrillState(user_id=user_id, drill_id=drill_id, box=MIN_BOX),
            lambda: drill_state(db, user_id, drill_id),
        )
    state.box, state.due_at = schedule_attempt(state.box, success, 0, now)
    return state
