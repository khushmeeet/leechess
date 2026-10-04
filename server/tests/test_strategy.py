"""Position ideas: the shared table, and the tags a positional mistake gets."""

import json
from pathlib import Path

import chess
import pytest

from app.strategy import (
    BACKWARD_PAWN,
    ISOLATED_PAWN,
    OPEN_FILE,
    OUTPOST,
    WEAK_BACK_RANK,
    outposts,
    pawn_weaknesses,
    strategic_tags,
    weak_back_rank,
)

pytestmark = pytest.mark.unit

TABLE = json.loads(
    (Path(__file__).resolve().parents[2] / "shared" / "position-ideas.json").read_text()
)


def _names(squares) -> list[str]:
    return sorted(chess.square_name(square) for square in squares)


@pytest.mark.parametrize("case", TABLE["cases"], ids=lambda case: case["id"])
def test_position_ideas_table(case):
    board = chess.Board(case["fen"])
    for side, color in (("white", chess.WHITE), ("black", chess.BLACK)):
        weak = pawn_weaknesses(board, color)
        assert {
            "outposts": _names(outposts(board, color)),
            "weakBackRank": weak_back_rank(board, color),
            "isolated": _names(weak[ISOLATED_PAWN]),
            "doubled": sorted(chess.FILE_NAMES[f] for f in weak["doubled_pawns"]),
            "backward": _names(weak[BACKWARD_PAWN]),
        } == case[side], side


SICILIAN = "6k1/pp3ppp/3p4/4p3/4P3/2N5/PP3PPP/6K1 w - - 0 1"


def test_the_engine_move_took_an_outpost():
    assert strategic_tags(SICILIAN, "a3", "c3d5") == {OUTPOST}


def test_the_engine_move_took_an_open_file():
    # the c-file has no pawns at all
    fen = "6k1/pp3ppp/3p4/4p3/4P3/8/PP3PPP/5RK1 w - - 0 1"
    assert strategic_tags(fen, "a3", "f1c1") == {OPEN_FILE}


def test_nothing_is_missed_when_the_move_played_was_the_idea():
    assert strategic_tags(SICILIAN, "Nd5", "c3d5") == set()


def test_a_square_no_pawn_guards_is_no_outpost():
    # b5: no White pawn guards it, and the a7 pawn could chase the knight
    assert strategic_tags(SICILIAN, "a3", "c3b5") == set()


def test_a_capture_away_from_the_centre_leaves_an_isolated_pawn():
    fen = "6k1/5ppp/8/8/1n1P4/2P5/5PPP/6K1 w - - 0 1"
    assert strategic_tags(fen, "cxb4", None) == {ISOLATED_PAWN}


def test_the_last_guard_leaving_the_back_rank_leaves_it_weak():
    fen = "3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1"
    assert WEAK_BACK_RANK in strategic_tags(fen, "Rd7", None)


def test_luft_mends_a_weak_back_rank():
    fen = "3r2k1/2R2ppp/8/8/8/8/5PPP/6K1 w - - 0 1"
    assert strategic_tags(fen, "Rc6", "h2h3") == {WEAK_BACK_RANK}
