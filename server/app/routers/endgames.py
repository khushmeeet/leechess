"""Endgame-drill endpoints.

GET /endgames/next selection order mirrors the puzzle queue:
1. due drills (due_at <= now) — weakest family first, then earliest due
2. 404 when nothing is due

"Weakest" = lowest success rate over that family's most recent attempts,
computed the same way motif_success_rates does it for puzzles. A family with
no attempts counts as 0 so untouched techniques surface first — the point of
the screen is the endgame you have never practised.

The twelve-drill catalog is shared by every account; what is per account is
the scheduling state (app/scheduling.py) and the attempts. A drill with no
state row for you has never been played by you, which is what makes the whole
catalog due for a new account without anything being written for it.

Grading happens on the client (it plays the drill out against WASM Stockfish);
this router records the verdict and applies the shared Leitner scheduler.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.backend import current_active_user
from app.auth.models import User
from app.db import get_db
from app.models import EndgameDrill, EndgameDrillAttempt, EndgameDrillState, utcnow
from app.schemas import (
    DrillAttemptIn,
    DrillAttemptOut,
    DrillAttemptRecorded,
    DrillDetail,
    DrillOut,
)
from app.scheduling import drill_state, record_drill_attempt
from app.spaced_repetition import MIN_BOX

router = APIRouter(prefix="/endgames", tags=["endgames"])

# Per family, how many of the latest attempts define "recent success rate".
RECENT_ATTEMPTS_WINDOW = 20


def family_success_rates(db: Session, user: User) -> dict[str, float]:
    rows = db.execute(
        select(EndgameDrill.family, EndgameDrillAttempt.success)
        .join(EndgameDrill, EndgameDrillAttempt.drill_id == EndgameDrill.id)
        .where(EndgameDrillAttempt.user_id == user.id)
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


def drill_out(drill: EndgameDrill, state: EndgameDrillState | None) -> DrillOut:
    """box and due_at are still reported per drill; they come from the
    caller's state row. No row means never played: box 1, due since the
    catalog was seeded."""
    return DrillOut(
        id=drill.id,
        key=drill.key,
        family=drill.family,
        name=drill.name,
        fen=drill.fen,
        player_color=drill.player_color,
        goal=drill.goal,
        technique=drill.technique,
        box=state.box if state is not None else MIN_BOX,
        due_at=state.due_at if state is not None else drill.created_at,
    )


def _catalog(
    db: Session,
    user: User,
    family: str | None,
    due_by: datetime | None = None,
) -> list[tuple[EndgameDrill, EndgameDrillState | None]]:
    """The catalog paired with this account's state, or None where they have
    never played that drill.

    `due_by` filters in SQL rather than in Python on purpose: SQLite's DateTime
    column drops tzinfo, so the values that come back are naive and comparing
    them to an aware utcnow() raises.
    """
    query = (
        select(EndgameDrill, EndgameDrillState)
        # Outer join, so a drill this account has never played comes back with
        # no state — which is the "due now" case, and is why a new account
        # needs no rows written to have the whole catalog waiting.
        .outerjoin(
            EndgameDrillState,
            (EndgameDrillState.drill_id == EndgameDrill.id)
            & (EndgameDrillState.user_id == user.id),
        )
        .order_by(EndgameDrill.family, EndgameDrill.id)
    )
    if family is not None:
        query = query.where(EndgameDrill.family == family)
    if due_by is not None:
        query = query.where(
            (EndgameDrillState.id.is_(None)) | (EndgameDrillState.due_at <= due_by)
        )
    return [(row[0], row[1]) for row in db.execute(query).all()]


@router.get("/drills", response_model=list[DrillOut])
def list_drills(
    family: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_active_user),
):
    """The whole catalog with the caller's live Leitner state."""
    return [drill_out(drill, state) for drill, state in _catalog(db, user, family)]


@router.get("/next", response_model=DrillOut)
def next_drill(
    family: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_active_user),
) -> DrillOut:
    """Read-only: repeated calls return the same drill until an attempt is
    recorded (which reschedules it out of the due set)."""
    now = utcnow()
    rates = family_success_rates(db, user)

    def scheduled(pair: tuple[EndgameDrill, EndgameDrillState | None]):
        drill, state = pair
        return state.due_at if state is not None else drill.created_at

    due = _catalog(db, user, family, due_by=now)
    if not due:
        raise HTTPException(status_code=404, detail="No drills due")

    chosen = min(
        due,
        key=lambda pair: (rates.get(pair[0].family, 0.0), scheduled(pair), pair[0].id),
    )
    return drill_out(*chosen)


@router.get("/{drill_id}", response_model=DrillDetail)
def get_drill(
    drill_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_active_user),
) -> DrillDetail:
    drill = _get_drill_or_404(drill_id, db)
    base = drill_out(drill, drill_state(db, user.id, drill.id))
    return DrillDetail(
        **base.model_dump(),
        attempts=[
            DrillAttemptOut.model_validate(attempt)
            for attempt in drill.attempts
            if attempt.user_id == user.id
        ],
    )


@router.post("/{drill_id}/attempt", response_model=DrillAttemptRecorded, status_code=201)
def record_drill_attempt_route(
    drill_id: int,
    payload: DrillAttemptIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_active_user),
) -> DrillAttemptRecorded:
    drill = _get_drill_or_404(drill_id, db)
    attempt = EndgameDrillAttempt(
        user_id=user.id,
        success=payload.success,
        moves_played=payload.moves_played,
        outcome=payload.outcome,
    )
    drill.attempts.append(attempt)
    state = record_drill_attempt(
        db, user.id, drill.id, success=payload.success, now=utcnow()
    )
    db.commit()
    return DrillAttemptRecorded(
        id=attempt.id,
        drill_id=drill.id,
        success=attempt.success,
        moves_played=attempt.moves_played,
        outcome=attempt.outcome,
        attempted_at=attempt.attempted_at,
        box=state.box,
        due_at=state.due_at,
    )
