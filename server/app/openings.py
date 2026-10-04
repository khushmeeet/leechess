"""The opening book: which positions are on a known line, and their names.

Built from the same vendored lichess chess-openings TSVs the client's
build-openings.js turns into static/openings.json (shared/chess-openings/),
so the analysis job and the live badge agree on what counts as book, and
Review and Progress name an opening the way Play does. Every position along
every named line is book, not just the line's last one, and positions are
keyed by EPD (FEN minus the move counters) so a transposition into a known
line counts too.

Loaded once per process, on first use: replaying ~3,800 short lines takes
well under a second.
"""

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, Sequence

import chess


def _book_dir() -> Path:
    """shared/ sits at the repo root locally and under /app in the Docker
    image — walk upward so both layouts resolve (as analysis.py does)."""
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "shared" / "chess-openings"
        if candidate.is_dir():
            return candidate
    raise FileNotFoundError("shared/chess-openings not found above " + __file__)


@dataclass(frozen=True)
class _Book:
    positions: frozenset[str]
    # A line's final position → (eco, name); first wins, files a→e, the
    # order build-openings.js uses.
    named: dict[str, tuple[str, str]]


_built: _Book | None = None
_building = threading.Lock()


def _book() -> _Book:
    """The book, built once per process. Locked, because the warm-up thread
    started at boot and the first request that needs it can arrive together:
    the second waits for the first instead of building it again."""
    global _built
    if _built is None:
        with _building:
            if _built is None:
                _built = _build()
    return _built


def _build() -> _Book:
    positions: set[str] = set()
    named: dict[str, tuple[str, str]] = {}
    # Lines share their first moves (thousands start 1.e4 e5 2.Nf3), so each
    # position is reached once and reused: SAN parsing is the slow part.
    reached: dict[tuple[str, ...], chess.Board] = {(): chess.Board()}
    for volume in sorted(_book_dir().glob("*.tsv")):
        rows = volume.read_text().splitlines()
        header = rows[0].split("\t")
        eco_col, name_col, pgn_col = (
            header.index(col) for col in ("eco", "name", "pgn")
        )
        for row in rows[1:]:
            if not row.strip():
                continue
            cells = row.split("\t")
            sans = tuple(
                token for token in cells[pgn_col].split() if not token.endswith(".")
            )
            board = reached[()]
            for depth in range(1, len(sans) + 1):
                prefix = sans[:depth]
                known = reached.get(prefix)
                if known is None:
                    known = board.copy(stack=False)
                    known.push_san(prefix[-1])
                    reached[prefix] = known
                    positions.add(known.epd())
                board = known
            named.setdefault(board.epd(), (cells[eco_col], cells[name_col]))
    return _Book(frozenset(positions), named)


def warm() -> None:
    """Build the book now rather than on the first request that needs it —
    started in the background at boot (app/main.py)."""
    _book()


def book_positions() -> frozenset[str]:
    return _book().positions


def in_book(fen: str) -> bool:
    """The position is on a known opening line, so a move into it is a book
    move. python-chess writes an en passant square only when a capture is
    legal, as chess.js does, so stored FENs and the book agree on the key."""
    return chess.Board(fen).epd() in book_positions()


class _PlayedMove(Protocol):
    """What the opening reading needs from a move — the Move ORM row and
    the MoveOut schema both have it."""

    ply: int
    san: str
    fen_before: str
    fen_after: str


@dataclass(frozen=True)
class Opening:
    eco: str
    family: str
    variation: str | None


def _split(name: str) -> tuple[str, str | None]:
    """'Sicilian Defense: Najdorf Variation' → family, variation."""
    family, _, variation = name.partition(": ")
    return family, variation or None


def opening_of(moves: Sequence[_PlayedMove]) -> Opening | None:
    """The opening a game reached: its deepest named position, keeping a
    variation named earlier in the same family when the deepest entry is the
    family alone — the client's openingForFens, so the names match Play's."""
    named = _book().named
    deepest: tuple[str, str] | None = None
    variation_seen: tuple[str, str] | None = None
    for move in moves:
        hit = named.get(chess.Board(move.fen_after).epd())
        if hit is None:
            continue
        deepest = hit
        family, variation = _split(hit[1])
        if variation:
            variation_seen = (family, variation)
    if deepest is None:
        return None
    family, variation = _split(deepest[1])
    if variation is None and variation_seen and variation_seen[0] == family:
        variation = variation_seen[1]
    return Opening(eco=deepest[0], family=family, variation=variation)


@dataclass(frozen=True)
class LeftBook:
    """The first move of a game that left the book, and the book moves that
    were there to play instead (SAN, in the position before it)."""

    ply: int
    san: str
    book_moves: list[str]


def book_moves(fen: str) -> list[str]:
    """The legal moves from `fen` that stay on a known line."""
    board = chess.Board(fen)
    found = []
    for move in board.legal_moves:
        board.push(move)
        if board.epd() in book_positions():
            board.pop()
            found.append(board.san(move))
        else:
            board.pop()
    return sorted(found)


def left_book(moves: Sequence[_PlayedMove]) -> LeftBook | None:
    """Where the game left the book: the first move into a position no line
    has, from one that was on a line (or from the starting position). None
    for a game that never left it, or started somewhere no line goes (an
    endgame drill, a set-up position)."""
    if not moves:
        return None
    on_line = chess.Board(moves[0].fen_before).epd() == chess.Board().epd()
    for move in moves:
        if in_book(move.fen_after):
            on_line = True
            continue
        if not on_line:
            return None
        return LeftBook(
            ply=move.ply, san=move.san, book_moves=book_moves(move.fen_before)
        )
    return None
