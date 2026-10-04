"""Guess the move (Literature) scores.

The client weighs each guess with its own engine and posts the run's totals
after every scored guess — the trust model Think first, puzzles and endgame
drills use. A run is created on its first guess and updated from then on, so
one left halfway is still on record. Literature shows the best and latest per
game; Progress shows the same summary for its window. Anonymous play never
posts: it keeps nothing.
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.backend import current_active_user
from app.auth.models import User
from app.db import get_db
from app.models import GuessRun, utcnow
from app.schemas import GuessRunIn, GuessScore, GuessSummary

router = APIRouter(prefix="/guess", tags=["guess"])


@router.post("/runs", status_code=201)
def start_run(
    payload: GuessRunIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_active_user),
) -> dict[str, int]:
    run = GuessRun(user_id=user.id, **payload.model_dump())
    db.add(run)
    db.commit()
    return {"id": run.id}


@router.put("/runs/{run_id}")
def update_run(
    run_id: int,
    payload: GuessRunIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_active_user),
) -> dict[str, int]:
    run = db.get(GuessRun, run_id)
    # someone else's run is as absent as one that never existed
    if run is None or run.user_id != user.id:
        raise HTTPException(status_code=404, detail="Run not found")
    if (run.game_id, run.side) != (payload.game_id, payload.side):
        raise HTTPException(status_code=409, detail="A run keeps its game and side")
    if payload.guessed < run.guessed:
        raise HTTPException(status_code=409, detail="A run's guesses only grow")
    for field, value in payload.model_dump().items():
        setattr(run, field, value)
    run.updated_at = utcnow()
    db.commit()
    return {"id": run.id}


def _share(run: GuessRun) -> float:
    return run.points / run.max_points if run.max_points else 0.0


def guess_summary(db: Session, user: User, since: datetime | None) -> list[GuessSummary]:
    """Per landmark game and side: run count, best finished run (highest share
    of points, earliest on a tie) and latest run; most recently played first."""
    query = (
        select(GuessRun)
        .where(GuessRun.user_id == user.id)
        .order_by(GuessRun.updated_at, GuessRun.id)
    )
    if since is not None:
        query = query.where(GuessRun.updated_at >= since)
    by_game: dict[tuple[str, str], list[GuessRun]] = {}
    for run in db.scalars(query):
        by_game.setdefault((run.game_id, run.side), []).append(run)

    summaries = []
    for (game_id, side), runs in by_game.items():
        finished = [run for run in runs if run.finished]
        best = max(finished, key=_share, default=None)
        summaries.append(
            GuessSummary(
                game_id=game_id,
                side=side,
                runs=len(runs),
                best=GuessScore.model_validate(best) if best else None,
                latest=GuessScore.model_validate(runs[-1]),
            )
        )
    summaries.sort(key=lambda summary: summary.latest.updated_at, reverse=True)
    return summaries


@router.get("/summary", response_model=list[GuessSummary])
def get_summary(
    days: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
    user: User = Depends(current_active_user),
) -> list[GuessSummary]:
    since = utcnow() - timedelta(days=days) if days is not None else None
    return guess_summary(db, user, since)
