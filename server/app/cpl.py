"""Centipawn-loss math, shared by every surface that averages it.

The progress trend, the coach-summary digest, and the review sidebar all
aggregate the same per-move loss; this module is the single copy of that
arithmetic so the numbers cannot drift apart. Per-move CPL is never stored —
everything here derives from the Move rows' eval_before/eval_after.
"""

from dataclasses import dataclass
from typing import Protocol, Sequence

from app.models import Game, Move

# Same rough phase boundaries the Review CPL graph draws (plies).
OPENING_MAX_PLY = 20
MIDDLEGAME_MAX_PLY = 60


class EvaluatedMove(Protocol):
    """What the math needs from a move — satisfied by both the Move ORM row
    and the MoveOut schema, so schemas.py can reuse it without ORM types."""

    ply: int
    eval_before: float | None
    eval_after: float | None


def move_loss(move: EvaluatedMove) -> float | None:
    """Centipawns the mover gave away (≥0; evals are White-perspective).
    None when either eval is missing."""
    if move.eval_before is None or move.eval_after is None:
        return None
    is_white = move.ply % 2 == 1
    return max(
        0.0,
        move.eval_before - move.eval_after
        if is_white
        else move.eval_after - move.eval_before,
    )


def player_moves(game: Game) -> list[Move]:
    """The student's moves: vs the engine only the side you played
    (user_color) counts; local pass-and-play counts both sides."""
    if game.mode == "engine":
        # `or "white"` covers unflushed rows where the column default has
        # not been applied yet
        user_parity = 1 if (game.user_color or "white") == "white" else 0
        return [move for move in game.moves if move.ply % 2 == user_parity]
    return list(game.moves)


@dataclass(frozen=True)
class CplAggregate:
    avg_cpl: float
    opening_cpl: float | None  # None = no moves in that phase
    middlegame_cpl: float | None
    endgame_cpl: float | None


def aggregate_cpl(moves: Sequence[EvaluatedMove]) -> CplAggregate | None:
    """Average loss overall and per phase. None when there is nothing to
    aggregate or any move's analysis is incomplete."""
    losses: list[float] = []
    phases: dict[str, list[float]] = {"opening": [], "middlegame": [], "endgame": []}
    for move in moves:
        loss = move_loss(move)
        if loss is None:
            return None
        losses.append(loss)
        if move.ply <= OPENING_MAX_PLY:
            phases["opening"].append(loss)
        elif move.ply <= MIDDLEGAME_MAX_PLY:
            phases["middlegame"].append(loss)
        else:
            phases["endgame"].append(loss)
    if not losses:
        return None

    def avg(values: list[float]) -> float | None:
        return sum(values) / len(values) if values else None

    return CplAggregate(
        avg_cpl=sum(losses) / len(losses),
        opening_cpl=avg(phases["opening"]),
        middlegame_cpl=avg(phases["middlegame"]),
        endgame_cpl=avg(phases["endgame"]),
    )
