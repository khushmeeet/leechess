"""Puzzle queue endpoints (Phase 3).

GET /puzzles/next selection order (product spec §4.3):
1. due personal puzzles (source_move_id set, due_at <= now) — weakest motif
   first, then earliest due
2. otherwise the generic Lichess pool, same weak-motif priority, easiest
   (lowest rating) first

"Weakest" = lowest success rate over that motif's most recent attempts. A
motif with no attempts counts as 0: a personal puzzle only exists because
you missed that tactic in a game, so no data means nothing proven yet.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import seeding
from app.db import get_db
from app.lichess_import import generic_pool_counts
from app.models import Puzzle, PuzzleAttempt, utcnow
from app.schemas import (
    AttemptIn,
    AttemptRecorded,
    PuzzleDetail,
    PuzzleOut,
    SeedStatusOut,
)
from app.spaced_repetition import schedule_attempt

router = APIRouter(prefix="/puzzles", tags=["puzzles"])

# Per motif, how many of the latest attempts define "recent success rate".
RECENT_ATTEMPTS_WINDOW = 20


def motif_success_rates(db: Session) -> dict[str, float]:
    rows = db.execute(
        select(Puzzle.motif, PuzzleAttempt.correct)
        .join(Puzzle, PuzzleAttempt.puzzle_id == Puzzle.id)
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


def _get_puzzle_or_404(puzzle_id: int, db: Session) -> Puzzle:
    puzzle = db.get(Puzzle, puzzle_id)
    if puzzle is None:
        raise HTTPException(status_code=404, detail="Puzzle not found")
    return puzzle


@router.get("/next", response_model=PuzzleOut)
def next_puzzle(motif: str | None = None, db: Session = Depends(get_db)) -> Puzzle:
    """Read-only: repeated calls return the same puzzle until an attempt is
    recorded (which reschedules it out of the due set)."""
    now = utcnow()
    rates = motif_success_rates(db)

    def due(personal: bool) -> list[Puzzle]:
        query = select(Puzzle).where(
            Puzzle.source_move_id.is_not(None) if personal else Puzzle.source_move_id.is_(None),
            Puzzle.due_at <= now,
        )
        if motif is not None:
            query = query.where(Puzzle.motif == motif)
        return list(db.scalars(query))

    personal = due(personal=True)
    if personal:
        return min(personal, key=lambda p: (rates.get(p.motif, 0.0), p.due_at, p.id))

    generic = due(personal=False)
    if generic:
        return min(
            generic, key=lambda p: (rates.get(p.motif, 0.0), p.difficulty or 0, p.id)
        )

    raise HTTPException(status_code=404, detail="No puzzles due")


def _seed_status(db: Session) -> SeedStatusOut:
    run = seeding.status()
    return SeedStatusOut(
        state=run.state,
        scanned=run.scanned,
        imported=run.imported,
        error=run.error,
        pool=generic_pool_counts(db),
    )


@router.get("/seed", response_model=SeedStatusOut)
def seed_status(db: Session = Depends(get_db)) -> SeedStatusOut:
    return _seed_status(db)


@router.post("/seed", response_model=SeedStatusOut, status_code=202)
def seed_pool(
    background_tasks: BackgroundTasks, db: Session = Depends(get_db)
) -> SeedStatusOut:
    """Stream the Lichess dump into the generic pool in the background
    (the manual alternative to LEECHESS_AUTO_SEED — also resumes a
    partially seeded pool: existing puzzles are deduped and each motif is
    only topped up to its cap). Poll GET /puzzles/seed for progress."""
    if not seeding.begin():
        raise HTTPException(status_code=409, detail="Seeding already running")
    background_tasks.add_task(seeding.run_seed)
    return _seed_status(db)


@router.get("/{puzzle_id}", response_model=PuzzleDetail)
def get_puzzle(puzzle_id: int, db: Session = Depends(get_db)) -> Puzzle:
    return _get_puzzle_or_404(puzzle_id, db)


@router.post("/{puzzle_id}/attempt", response_model=AttemptRecorded, status_code=201)
def record_attempt(
    puzzle_id: int, payload: AttemptIn, db: Session = Depends(get_db)
) -> AttemptRecorded:
    puzzle = _get_puzzle_or_404(puzzle_id, db)
    attempt = PuzzleAttempt(
        correct=payload.correct, hint_level_used=payload.hint_level_used
    )
    puzzle.attempts.append(attempt)
    puzzle.box, puzzle.due_at = schedule_attempt(
        puzzle.box, payload.correct, payload.hint_level_used, utcnow()
    )
    db.commit()
    return AttemptRecorded(
        id=attempt.id,
        puzzle_id=puzzle.id,
        correct=attempt.correct,
        hint_level_used=attempt.hint_level_used,
        attempted_at=attempt.attempted_at,
        box=puzzle.box,
        due_at=puzzle.due_at,
    )
