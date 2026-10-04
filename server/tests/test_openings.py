"""The opening book the analysis job grades against (app/openings.py)."""

import chess
import pytest

from app.openings import book_positions, in_book

pytestmark = pytest.mark.unit


def fen_after(*sans: str) -> str:
    board = chess.Board()
    for san in sans:
        board.push_san(san)
    return board.fen()


def test_a_named_line_and_every_position_on_the_way_are_book():
    # 1.e4 e5 2.Nf3 Nc6 3.Bb5 is the Ruy Lopez; each step to it is book too
    line = ["e4", "e5", "Nf3", "Nc6", "Bb5"]
    for plies in range(1, len(line) + 1):
        assert in_book(fen_after(*line[:plies])), line[:plies]


def test_a_move_off_every_line_is_not_book():
    assert not in_book(fen_after("e4", "e5", "Ke2", "Ke7", "Ke1"))


def test_a_transposition_into_a_known_line_is_book():
    # 1.Nf3 d5 2.d4 reaches the same position as 1.d4 d5 2.Nf3
    assert in_book(fen_after("Nf3", "d5", "d4"))
    assert (
        fen_after("Nf3", "d5", "d4").split()[:4]
        == fen_after("d4", "d5", "Nf3").split()[:4]
    )


def test_move_counters_do_not_matter():
    fen = fen_after("e4")
    assert in_book(fen.rsplit(" ", 2)[0] + " 7 40")


def test_the_book_matches_the_clients():
    """build-openings.js reports the same count from the same TSVs — if the
    two replays ever disagree on a key (the en passant square is the usual
    suspect), one side grades a move as book that the other doesn't."""
    assert len(book_positions()) == 7847
