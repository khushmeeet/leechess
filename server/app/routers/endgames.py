"""Endgame-drill endpoints.

GET /endgames/next selection order mirrors the puzzle queue:
1. due drills (due_at <= now) — weakest family first, then earliest due
2. 404 when nothing is due

"Weakest" = lowest success rate over that family's most recent attempts,
computed the same way motif_success_rates does it for puzzles. A family with
no attempts counts as 0 so untouched techniques surface first — the point of
the screen is the endgame you have never practised.

Grading happens on the client (it plays the drill out against WASM Stockfish);
this router records the verdict and applies the shared Leitner scheduler.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import EndgameDrill, EndgameDrillAttempt, utcnow
from app.schemas import DrillAttemptIn, DrillAttemptRecorded, DrillDetail, DrillOut
from app.spaced_repetition import schedule_attempt

router = APIRouter(prefix="/endgames", tags=["endgames"])

# Per family, how many of the latest attempts define "recent success rate".
RECENT_ATTEMPTS_WINDOW = 20


def family_success_rates(db: Session) -> dict[str, float]:
    rows = db.execute(
        select(EndgameDrill.family, EndgameDrillAttempt.success)
        .join(EndgameDrill, EndgameDrillAttempt.drill_id == EndgameDrill.id)
        .order_by(EndgameDrillAttempt.id.desc())
    ).all()
    recent_by_family: dict[str, list[bool]] = {}
    for family, success in rows:
        recent = recent_by_family.setdefault(family, [])
        if len(recent) < RECENT_ATTEMPTS_WINDOW:
            recent.append(success)
    return {
        family: sum(recent) / len(recent) for family, recent in recent_by_family.items()
    }


def _get_drill_or_404(drill_id: int, db: Session) -> EndgameDrill:
    drill = db.get(EndgameDrill, drill_id)
    if drill is None:
        raise HTTPException(status_code=404, detail="Drill not found")
    return drill


@router.get("/drills", response_model=list[DrillOut])
def list_drills(family: str | None = None, db: Session = Depends(get_db)):
    """The whole catalog with live Leitner state — the drill list view."""
    query = select(EndgameDrill).order_by(EndgameDrill.family, EndgameDrill.id)
    if family is not None:
        query = query.where(EndgameDrill.family == family)
    return list(db.scalars(query))


@router.get("/next", response_model=DrillOut)
def next_drill(family: str | None = None, db: Session = Depends(get_db)) -> EndgameDrill:
    """Read-only: repeated calls return the same drill until an attempt is
    recorded (which reschedules it out of the due set)."""
    now = utcnow()
    rates = family_success_rates(db)

    query = select(EndgameDrill).where(EndgameDrill.due_at <= now)
    if family is not None:
        query = query.where(EndgameDrill.family == family)
    due = list(db.scalars(query))
    if not due:
        raise HTTPException(status_code=404, detail="No drills due")

    return min(due, key=lambda d: (rates.get(d.family, 0.0), d.due_at, d.id))


@router.get("/{drill_id}", response_model=DrillDetail)
def get_drill(drill_id: int, db: Session = Depends(get_db)) -> EndgameDrill:
    return _get_drill_or_404(drill_id, db)


@router.post("/{drill_id}/attempt", response_model=DrillAttemptRecorded, status_code=201)
def record_drill_attempt(
    drill_id: int, payload: DrillAttemptIn, db: Session = Depends(get_db)
) -> DrillAttemptRecorded:
    drill = _get_drill_or_404(drill_id, db)
    attempt = EndgameDrillAttempt(
        success=payload.success,
        moves_played=payload.moves_played,
        outcome=payload.outcome,
    )
    drill.attempts.append(attempt)
    # hint_level_used is always 0: a drill has no hint ladder, so the rule that
    # holds a puzzle's box when the move was revealed never applies here.
    drill.box, drill.due_at = schedule_attempt(drill.box, payload.success, 0, utcnow())
    db.commit()
    return DrillAttemptRecorded(
        id=attempt.id,
        drill_id=drill.id,
        success=attempt.success,
        moves_played=attempt.moves_played,
        outcome=attempt.outcome,
        attempted_at=attempt.attempted_at,
        box=drill.box,
        due_at=drill.due_at,
    )
