"""One-time import of Lichess's public puzzle dump (Phase 3 generic pool).

The dump is a CC0 CSV — https://database.lichess.org/#puzzles — with columns
PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,
OpeningTags. Two format gotchas handled here:

- The FEN is the position BEFORE the opponent's setup move: Moves[0] is the
  opponent playing into the puzzle, and the solver's line starts at Moves[1]
  (opponent replies interleaved). We apply Moves[0] and store the rest.
- The Lichess theme list is far larger than our fixed taxonomy (spec §4.4).
  Themes are mapped where they overlap and dropped otherwise; a row with no
  mappable theme is skipped entirely — map or drop, never invent.
"""

import csv
import logging
from pathlib import Path

import chess
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Puzzle

logger = logging.getLogger(__name__)

# Lichess theme name → our motif taxonomy. First mapped theme on a row wins.
THEME_TO_MOTIF: dict[str, str] = {
    "fork": "fork",
    "pin": "pin",
    "skewer": "skewer",
    "discoveredAttack": "discovered_attack",
    "doubleCheck": "double_check",
    "backRankMate": "back_rank_mate",
    "hangingPiece": "hanging_piece",
    "capturingDefender": "removing_the_defender",
    "deflection": "deflection",
    "intermezzo": "zwischenzug",
    "trappedPiece": "trapped_piece",
    "xRayAttack": "x_ray_attack",
}


def puzzle_from_row(row: dict[str, str]) -> Puzzle | None:
    """A generic Puzzle (source_move_id NULL) for one CSV row, or None when
    no theme maps to the taxonomy or the row doesn't parse."""
    motif = next(
        (THEME_TO_MOTIF[t] for t in row["Themes"].split() if t in THEME_TO_MOTIF),
        None,
    )
    if motif is None:
        return None
    try:
        moves = row["Moves"].split()
        board = chess.Board(row["FEN"])
        setup = chess.Move.from_uci(moves[0])
        if setup not in board.legal_moves:
            raise ValueError(f"illegal setup move {moves[0]}")
        board.push(setup)  # opponent plays into the puzzle position
        return Puzzle(
            fen=board.fen(),
            solution=" ".join(moves[1:]),
            motif=motif,
            difficulty=int(row["Rating"]),
        )
    except (KeyError, ValueError, IndexError) as exc:
        logger.warning("skipping puzzle %s: %s", row.get("PuzzleId", "?"), exc)
        return None


def import_csv(
    path: Path | str, db: Session, max_per_motif: int = 500
) -> dict[str, int]:
    """Stream the CSV into the puzzles table; returns imported count per
    motif. Re-import safe: positions already in the generic pool (by FEN)
    are skipped, and each motif is capped so the full multi-million-row
    dump stays a bounded, useful drill pool."""
    seen_fens = set(
        db.scalars(select(Puzzle.fen).where(Puzzle.source_move_id.is_(None)))
    )
    counts: dict[str, int] = {}
    with open(path, newline="") as file:
        for row in csv.DictReader(file):
            puzzle = puzzle_from_row(row)
            if puzzle is None or puzzle.fen in seen_fens:
                continue
            if counts.get(puzzle.motif, 0) >= max_per_motif:
                continue
            db.add(puzzle)
            seen_fens.add(puzzle.fen)
            counts[puzzle.motif] = counts.get(puzzle.motif, 0) + 1
    db.commit()
    return counts
