"""Think first (Play's critical-moment check) results.

The client weighs the candidates with its own engine and posts the verdict,
the same trust model puzzles and endgame drills use; Progress counts them
(app/routers/progress.py). Anonymous play never posts: it keeps nothing.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.backend import current_active_user
from app.auth.models import User
from app.db import get_db
from app.models import CriticalMoment
from app.schemas import CriticalMomentIn

router = APIRouter(prefix="/thinking", tags=["thinking"])


@router.post("/moments", status_code=201)
def record_moment(
    payload: CriticalMomentIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_active_user),
) -> dict[str, int]:
    moment = CriticalMoment(
        user_id=user.id,
        fen=payload.fen,
        found=payload.found,
        had_threat=payload.had_threat,
        answered_threat=payload.answered_threat if payload.had_threat else None,
        candidates=payload.candidates,
    )
    db.add(moment)
    db.commit()
    return {"id": moment.id}
