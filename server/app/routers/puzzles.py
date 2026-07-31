"""Puzzle queue endpoints (Phase 3).

GET /puzzles/next selection order (product spec §4.3):
1. due personal puzzles (source_move_id set, due_at <= now) — weakest motif
   first, then earliest due
2. otherwise the generic Lichess pool, same weak-motif priority, easiest
   (lowest rating) first

"Weakest" = lowest success rate over that motif's most recent attempts. A
motif with no attempts counts as 0: a personal puzzle only exists because
you missed that tactic in a game, so no data means nothing proven yet.

Everything here is scoped to the signed-in account. Personal puzzles are
theirs outright; the generic pool is shared rows, so what makes the queue
personal is the per-account scheduling state in app/scheduling.py — and a
puzzle with no state row for you has never been served to you, which is what
"due now" means for a new account.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func, literal, select
from sqlalchemy.orm import Session

from app.auth.backend import current_active_user
from app.auth.models import User
from app.db import get_db
from app.models import Puzzle, PuzzleAttempt, PuzzleState, utcnow
from app.schemas import AttemptIn, AttemptOut, AttemptRecorded, PuzzleDetail, PuzzleOut
from app.scheduling import puzzle_state, record_puzzle_attempt
from app.spaced_repetition import MIN_BOX

router = APIRouter(prefix="/puzzles", tags=["puzzles"])

# Per motif, how many of the latest attempts define "recent success rate".
RECENT_ATTEMPTS_WINDOW = 20


def motif_success_rates(db: Session, user: User) -> dict[str, float]:
    rows = db.execute(
        select(Puzzle.motif, PuzzleAttempt.correct)
        .join(Puzzle, PuzzleAttempt.puzzle_id == Puzzle.id)
        .where(PuzzleAttempt.user_id == user.id)
        .order_by(PuzzleAttempt.id.desc())
    ).all()
    recent_by_motif: dict[str, list[bool]] = {}
    for motif, correct in rows:
        recent = recent_by_motif.setdefault(motif, [])
        if len(recent) < RECENT_ATTEMPTS_WINDOW:
            recent.append(correct)
    return {
        motif: sum(recent) / len(recent) for motif, recent in recent_by_motif.items()
    }


def _is_shared_pool(puzzle: Puzzle) -> bool:
    """A generic Lichess import: no owner *and* no source move.

    Both halves matter. user_id alone would also match a personal puzzle
    written before accounts existed — those have no owner either, and treating
    them as shared would serve one player's missed tactics to everybody else.
    app/legacy_ownership.py draws the line in the same place.
    """
    return puzzle.user_id is None and puzzle.source_move_id is None


def _get_puzzle_or_404(puzzle_id: int, db: Session, user: User) -> Puzzle:
    """404 rather than 403 for someone else's puzzle: whether a given id
    exists is not information this app owes a caller."""
    puzzle = db.get(Puzzle, puzzle_id)
    if puzzle is None or not (puzzle.user_id == user.id or _is_shared_pool(puzzle)):
        raise HTTPException(status_code=404, detail="Puzzle not found")
    return puzzle


def puzzle_out(puzzle: Puzzle, state: PuzzleState | None) -> PuzzleOut:
    """The API still reports box and due_at per puzzle; they now come from the
    caller's state row. No row means never attempted: box 1, and due since the
    puzzle existed."""
    return PuzzleOut(
        id=puzzle.id,
        fen=puzzle.fen,
        solution=puzzle.solution,
        motif=puzzle.motif,
        difficulty=puzzle.difficulty,
        source_move_id=puzzle.source_move_id,
        box=state.box if state is not None else MIN_BOX,
        due_at=state.due_at if state is not None else puzzle.created_at,
    )


def _weakest_first(rates: dict[str, float]):
    """Order key for "weakest motif first". A motif with no attempts counts as
    0 — a personal puzzle only exists because you missed that tactic, so no
    data means nothing proven yet."""
    if not rates:
        return literal(0.0)
    return case(rates, value=Puzzle.motif, else_=0.0)


@router.get("/next", response_model=PuzzleOut)
def next_puzzle(
    motif: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_active_user),
) -> PuzzleOut:
    """Read-only: repeated calls return the same puzzle until an attempt is
    recorded (which reschedules it out of the due set)."""
    now = utcnow()
    weakness = _weakest_first(motif_success_rates(db, user))

    def first_due(personal: bool) -> tuple[Puzzle, PuzzleState | None] | None:
        if personal:
            owned = Puzzle.user_id == user.id
            # Earliest due first; no state row means never served, and the
            # puzzle has been waiting since it was created.
            tiebreak = func.coalesce(PuzzleState.due_at, Puzzle.created_at)
        else:
            # Both halves: see _is_shared_pool. user_id alone would sweep in
            # personal puzzles written before accounts existed.
            owned = Puzzle.user_id.is_(None) & Puzzle.source_move_id.is_(None)
            tiebreak = func.coalesce(Puzzle.difficulty, 0)  # easiest first

        conditions = [owned, (PuzzleState.id.is_(None)) | (PuzzleState.due_at <= now)]
        if motif is not None:
            conditions.append(Puzzle.motif == motif)

        row = db.execute(
            select(Puzzle, PuzzleState)
            # Outer join, so a puzzle this account has never answered comes
            # back with no state — which is exactly the "due now" case, and
            # is why a new account needs no rows written to have a queue.
            .outerjoin(
                PuzzleState,
                (PuzzleState.puzzle_id == Puzzle.id)
                & (PuzzleState.user_id == user.id),
            )
            .where(*conditions)
            # Ranked and limited in SQL rather than in python. The generic pool
            # is every motif's 500 imports (app/seeding.py), and for a new
            # account none of it has a state row yet — so "load the due set and
            # min() it" meant materializing thousands of rows on every call,
            # for the life of the account.
            .order_by(weakness, tiebreak, Puzzle.id)
            .limit(1)
        ).first()
        return (row[0], row[1]) if row is not None else None

    chosen = first_due(personal=True) or first_due(personal=False)
    if chosen is None:
        raise HTTPException(status_code=404, detail="No puzzles due")
    return puzzle_out(*chosen)


@router.get("/{puzzle_id}", response_model=PuzzleDetail)
def get_puzzle(
    puzzle_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_active_user),
) -> PuzzleDetail:
    puzzle = _get_puzzle_or_404(puzzle_id, db, user)
    base = puzzle_out(puzzle, puzzle_state(db, user.id, puzzle.id))
    return PuzzleDetail(
        **base.model_dump(),
        attempts=[
            AttemptOut.model_validate(attempt)
            for attempt in puzzle.attempts
            if attempt.user_id == user.id
        ],
    )


@router.post("/{puzzle_id}/attempt", response_model=AttemptRecorded, status_code=201)
def record_attempt(
    puzzle_id: int,
    payload: AttemptIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_active_user),
) -> AttemptRecorded:
    puzzle = _get_puzzle_or_404(puzzle_id, db, user)
    attempt = PuzzleAttempt(
        user_id=user.id,
        correct=payload.correct,
        hint_level_used=payload.hint_level_used,
    )
    puzzle.attempts.append(attempt)
    state = record_puzzle_attempt(
        db,
        user.id,
        puzzle.id,
        correct=payload.correct,
        hint_level_used=payload.hint_level_used,
        now=utcnow(),
    )
    db.commit()
    return AttemptRecorded(
        id=attempt.id,
        puzzle_id=puzzle.id,
        correct=attempt.correct,
        hint_level_used=attempt.hint_level_used,
        attempted_at=attempt.attempted_at,
        box=state.box,
        due_at=state.due_at,
    )
