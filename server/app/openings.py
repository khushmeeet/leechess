"""The opening book, for grading: which positions are on a known line.

Built from the same vendored lichess chess-openings TSVs the client's
build-openings.js turns into static/openings.json (shared/chess-openings/),
so the analysis job and the live badge agree on what counts as book. Every
position along every named line is book, not just the line's last one, and
positions are keyed by EPD (FEN minus the move counters) so a transposition
into a known line counts too.

Loaded once per process, on first use: replaying ~3,800 short lines takes
well under a second, and only the analysis job asks.
"""

import functools
from pathlib import Path

import chess


def _book_dir() -> Path:
    """shared/ sits at the repo root locally and under /app in the Docker
    image — walk upward so both layouts resolve (as analysis.py does)."""
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "shared" / "chess-openings"
        if candidate.is_dir():
            return candidate
    raise FileNotFoundError("shared/chess-openings not found above " + __file__)


@functools.cache
def book_positions() -> frozenset[str]:
    positions: set[str] = set()
    for volume in sorted(_book_dir().glob("*.tsv")):
        rows = volume.read_text().splitlines()
        pgn_col = rows[0].split("\t").index("pgn")
        for row in rows[1:]:
            if not row.strip():
                continue
            board = chess.Board()
            for token in row.split("\t")[pgn_col].split():
                if token.endswith("."):
                    continue  # move number
                board.push_san(token)
                positions.add(board.epd())
    return frozenset(positions)


def in_book(fen: str) -> bool:
    """The position is on a known opening line, so a move into it is a book
    move. python-chess writes an en passant square only when a capture is
    legal, as chess.js does, so stored FENs and the book agree on the key."""
    return chess.Board(fen).epd() in book_positions()
