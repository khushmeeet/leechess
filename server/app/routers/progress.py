"""Progress screen aggregates (Phase 4).

Everything is computed on read from the tables Phases 1-3 already write —
motif success from puzzle_attempts ⋈ puzzles, the CPL trend from analyzed
games/moves — no snapshot pipeline (spec §4.5). The optional ?days window
covers the spec's last-30/90/all-time views.
"""

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.cpl import aggregate_cpl, player_moves
from app.db import get_db
from app.models import Game, Puzzle, PuzzleAttempt, utcnow
from app.schemas import GameCplPoint, MotifProgress, ProgressOut

router = APIRouter(prefix="/progress", tags=["progress"])

# A motif needs at least this many attempts before the weakest-motif callout
# surfaces it — one failed attempt isn't a trend worth drilling yet.
MIN_CALLOUT_ATTEMPTS = 3
WEAKEST_LIMIT = 3


def motif_progress(db: Session, since: datetime | None) -> list[MotifProgress]:
    """All-attempt success rate per motif within the window, weakest first.
    (The puzzle queue's "weakest" uses a recent-attempts window instead —
    that one drives scheduling, this one reports totals.)"""
    query = select(Puzzle.motif, PuzzleAttempt.correct).join(
        Puzzle, PuzzleAttempt.puzzle_id == Puzzle.id
    )
    if since is not None:
        query = query.where(PuzzleAttempt.attempted_at >= since)

    by_motif: dict[str, list[bool]] = {}
    for motif, correct in db.execute(query):
        by_motif.setdefault(motif, []).append(correct)

    stats = [
        MotifProgress(
            motif=motif,
            attempts=len(results),
            correct=sum(results),
            success_rate=sum(results) / len(results),
        )
        for motif, results in by_motif.items()
    ]
    stats.sort(key=lambda s: (s.success_rate, -s.attempts, s.motif))
    return stats


def game_cpl(game: Game) -> GameCplPoint | None:
    """Average centipawn loss from the player's side, phase-segmented.
    None when the game has no fully-analyzed moves to aggregate."""
    agg = aggregate_cpl(player_moves(game))
    if agg is None:
        return None
    return GameCplPoint(
        game_id=game.id,
        created_at=game.created_at,
        mode=game.mode,
        avg_cpl=agg.avg_cpl,
        opening_cpl=agg.opening_cpl,
        middlegame_cpl=agg.middlegame_cpl,
        endgame_cpl=agg.endgame_cpl,
    )


def day_streak(activity_dates: set[date], today: date) -> int:
    """Consecutive days with activity, counting back from today. A streak
    with activity yesterday but not (yet) today is still alive."""
    current = today
    if current not in activity_dates:
        current -= timedelta(days=1)
    streak = 0
    while current in activity_dates:
        streak += 1
        current -= timedelta(days=1)
    return streak


@router.get("", response_model=ProgressOut)
def get_progress(
    days: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
) -> ProgressOut:
    now = utcnow()
    since = now - timedelta(days=days) if days is not None else None

    motifs = motif_progress(db, since)
    # "Weakest" needs enough attempts to be a trend, and a perfect record —
    # however small the sample pool ranks it — isn't a weakness to drill.
    weakest = [
        stat
        for stat in motifs
        if stat.attempts >= MIN_CALLOUT_ATTEMPTS and stat.success_rate < 1.0
    ][:WEAKEST_LIMIT]

    games_query = (
        select(Game)
        .where(Game.analysis_status == "complete")
        .order_by(Game.created_at, Game.id)
    )
    if since is not None:
        games_query = games_query.where(Game.created_at >= since)
    trend = [
        point
        for game in db.scalars(games_query)
        if (point := game_cpl(game)) is not None
    ]

    solved_query = select(PuzzleAttempt).where(PuzzleAttempt.correct.is_(True))
    if since is not None:
        solved_query = solved_query.where(PuzzleAttempt.attempted_at >= since)
    puzzles_solved = len(db.scalars(solved_query).all())

    # Streak is inherently "current", so it ignores the window: any played
    # game or puzzle attempt counts as activity for its (UTC) day.
    activity = {
        stamp.date()
        for stamp in db.scalars(select(Game.created_at)).all()
    } | {
        stamp.date()
        for stamp in db.scalars(select(PuzzleAttempt.attempted_at)).all()
    }

    return ProgressOut(
        days=days,
        motifs=motifs,
        weakest_motifs=weakest,
        cpl_trend=trend,
        streak_days=day_streak(activity, now.date()),
        puzzles_solved=puzzles_solved,
    )
