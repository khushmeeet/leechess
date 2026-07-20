"""Import of Lichess's public puzzle dump into the generic pool (Phase 3).

The dump is a CC0 CSV — https://database.lichess.org/#puzzles — with columns
PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,
OpeningTags. Two format gotchas handled here:

- The FEN is the position BEFORE the opponent's setup move: Moves[0] is the
  opponent playing into the puzzle, and the solver's line starts at Moves[1]
  (opponent replies interleaved). We apply Moves[0] and store the rest.
- The Lichess theme list is far larger than our fixed taxonomy (spec §4.4).
  Themes are mapped where they overlap and dropped otherwise; a row with no
  mappable theme is skipped entirely — map or drop, never invent.

`import_rows` consumes any iterable of CSV rows, so the same code serves the
manual script (`scripts/import_lichess_puzzles.py`, local file) and startup
auto-seeding (`app/seeding.py`, streamed straight off the network).
"""

import csv
import logging
from collections.abc import Callable, Iterable
from pathlib import Path

import chess
from sqlalchemy import func, select
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

# Import in batches so a long streamed run that dies mid-way keeps what it
# already pulled in (the next run dedups by FEN and tops up to the caps).
COMMIT_EVERY = 200


def motif_for_row(row: dict[str, str]) -> str | None:
    """First theme on the row that maps into the taxonomy, or None. Cheap —
    no board work — so callers can reject rows for full motifs early."""
    return next(
        (THEME_TO_MOTIF[t] for t in row.get("Themes", "").split() if t in THEME_TO_MOTIF),
        None,
    )


def puzzle_from_row(row: dict[str, str], motif: str | None = None) -> Puzzle | None:
    """A generic Puzzle (source_move_id NULL) for one CSV row, or None when
    no theme maps to the taxonomy or the row doesn't parse."""
    motif = motif or motif_for_row(row)
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


def generic_pool_counts(db: Session) -> dict[str, int]:
    """Generic-pool (source_move_id NULL) puzzle count per motif."""
    rows = db.execute(
        select(Puzzle.motif, func.count())
        .where(Puzzle.source_move_id.is_(None))
        .group_by(Puzzle.motif)
    ).all()
    return dict(rows)


def import_rows(
    rows: Iterable[dict[str, str]],
    db: Session,
    max_per_motif: int = 500,
    on_progress: Callable[[int, int], None] | None = None,
) -> dict[str, int]:
    """Stream CSV rows into the puzzles table; returns imported count per
    motif. Re-import safe: positions already in the generic pool (by FEN)
    are skipped, and each motif is capped — counting puzzles already in the
    pool — so the full multi-million-row dump stays a bounded, useful drill
    pool. Stops consuming `rows` the moment every motif is full, which lets
    a network-streamed caller abort the download early. `on_progress`
    (rows scanned, puzzles imported) fires periodically for status display."""
    seen_fens = set(
        db.scalars(select(Puzzle.fen).where(Puzzle.source_move_id.is_(None)))
    )
    pool = generic_pool_counts(db)
    open_motifs = {
        m for m in set(THEME_TO_MOTIF.values()) if pool.get(m, 0) < max_per_motif
    }
    counts: dict[str, int] = {}
    scanned = imported = 0
    if open_motifs:
        for row in rows:
            scanned += 1
            if on_progress is not None and scanned % 5000 == 0:
                on_progress(scanned, imported)
            motif = motif_for_row(row)
            if motif not in open_motifs:
                continue
            puzzle = puzzle_from_row(row, motif)
            if puzzle is None or puzzle.fen in seen_fens:
                continue
            db.add(puzzle)
            seen_fens.add(puzzle.fen)
            pool[motif] = pool.get(motif, 0) + 1
            counts[motif] = counts.get(motif, 0) + 1
            imported += 1
            if imported % COMMIT_EVERY == 0:
                db.commit()
            if on_progress is not None:
                on_progress(scanned, imported)
            if pool[motif] >= max_per_motif:
                open_motifs.discard(motif)
                if not open_motifs:
                    break
    db.commit()
    return counts


def import_csv(
    path: Path | str, db: Session, max_per_motif: int = 500
) -> dict[str, int]:
    """`import_rows` over a decompressed dump on disk (the manual script)."""
    with open(path, newline="") as file:
        return import_rows(csv.DictReader(file), db, max_per_motif=max_per_motif)
