"""Re-grading stored analysis without the engine (analysis.regrade_game)."""

import chess
import pytest

from app.analysis import EVAL_CLAMP_CP, regrade_game
from app.models import Game, Move

pytestmark = pytest.mark.unit


def _game(
    rows: list[tuple[str, float, float, str | None, int | None, int | None]],
) -> Game:
    """A game from (san, eval_before, eval_after, best_move, mate_before,
    mate_after) rows, played from the start position."""
    board = chess.Board()
    game = Game(mode="local")
    for ply, (san, before, after, best, mate_before, mate_after) in enumerate(
        rows, start=1
    ):
        fen_before = board.fen()
        board.push_san(san)
        game.moves.append(
            Move(
                ply=ply,
                san=san,
                fen_before=fen_before,
                fen_after=board.fen(),
                eval_before=before,
                eval_after=after,
                best_move=best,
                mate_before=mate_before,
                mate_after=mate_after,
                classification="blunder",  # stale: the old grade
            )
        )
    return game


def test_regrade_applies_book_and_engine_choice():
    game = _game(
        [
            ("e4", 30, 0, "d2d4", None, None),  # book: never an inaccuracy
            ("e5", 0, 40, "c7c5", None, None),  # book reply too
            ("Ba6", 40, -60, "g1f3", None, None),  # off book, a pawn's worth: mistake
            ("Nxa6", -60, -400, "b8a6", None, None),  # the engine's own choice
        ]
    )
    regrade_game(game)
    assert [move.classification for move in game.moves] == [
        "book",
        "book",
        "mistake",
        "best",
    ]


def test_regrade_reads_the_stored_mates():
    """Fool's Mate: 2.g4?? walks into mate in one, and is in the book."""
    game = _game(
        [
            ("f3", 30, -50, "e2e4", None, None),
            ("e5", -50, -60, "e7e5", None, None),
            ("g4", -60, -EVAL_CLAMP_CP, "d2d4", None, -1),
            ("Qh4#", -EVAL_CLAMP_CP, -EVAL_CLAMP_CP, "d8h4", -1, 0),
        ]
    )
    regrade_game(game)
    assert game.moves[2].classification == "blunder"
    # the mate itself is book as well as the engine's choice
    assert game.moves[3].classification == "book"


def test_regrade_skips_moves_without_analysis():
    game = _game([("e4", 30, 0, "e2e4", None, None)])
    game.moves[0].eval_after = None
    regrade_game(game)
    assert game.moves[0].classification == "blunder"  # untouched
