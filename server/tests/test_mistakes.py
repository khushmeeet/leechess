"""Which step of the thinking routine broke (app/mistakes.py)."""

import chess
import pytest

from app.mistakes import (
    ALLOWED_REPLY,
    HUNG_PIECE,
    MISSED_TACTIC,
    MISSED_THREAT,
    POSITIONAL,
    apply_mistake_causes,
    mistake_cause,
)
from app.models import Game, Move

pytestmark = pytest.mark.unit


def _move(
    fen_before: str,
    san: str,
    *,
    ply: int | None = None,
    classification: str = "blunder",
    best: str | None = None,
    threat: tuple[str, float | None, int | None] | None = None,
    evals: tuple[float, float] = (0.0, -300.0),
    mates: tuple[int | None, int | None] = (None, None),
) -> Move:
    board = chess.Board(fen_before)
    if ply is None:
        ply = 1 if board.turn == chess.WHITE else 2
    board.push_san(san)
    threat_move, threat_cp, threat_mate = threat or (None, None, None)
    return Move(
        ply=ply,
        san=san,
        fen_before=fen_before,
        fen_after=board.fen(),
        eval_before=evals[0],
        eval_after=evals[1],
        mate_before=mates[0],
        mate_after=mates[1],
        classification=classification,
        best_move=best,
        threat_move=threat_move,
        threat_cp=threat_cp,
        threat_mate=threat_mate,
    )


# 3.Qh5 in Scholar's mate, Black to move: Qxf7# is threatened.
SCHOLAR = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3"
# Move 21 of the play-tested game: …Bxf5 is threatened (attacked twice,
# defended once).
BISHOP_HIT = "r1b3rk/pp3p1p/2n2p2/3p1B2/P4q2/1P5P/2QN1PP1/2R2RK1 w - - 5 21"


def test_a_threat_still_on_the_board_is_a_missed_threat():
    nf6 = _move(
        SCHOLAR,
        "Nf6",
        best="g7g6",
        threat=("h5f7", None, 1),
        evals=(-30, 1000),
        mates=(None, 1),
    )
    assert mistake_cause(nf6, "h5f7") == MISSED_THREAT


def test_moving_the_threatened_piece_onto_a_covered_square_hangs_it():
    """21.Be6?? got the bishop off f5 — onto e6, where the f7 pawn takes it.
    The threat was answered; the move itself was the blunder."""
    be6 = _move(
        BISHOP_HIT,
        "Be6",
        best="f5c8",
        threat=("c8f5", -657, None),
        evals=(-145, -651),
    )
    assert mistake_cause(be6, "f7e6") == HUNG_PIECE


def test_a_forcing_reply_that_wins_nothing_outright_is_an_allowed_reply():
    # Kd1?? lets the knight check from c3 and fork the rook on a2
    kd1 = _move("4k3/8/8/3n4/8/8/R7/4K3 w - - 0 1", "Kd1", best="a2a7")
    assert mistake_cause(kd1, "d5c3") == ALLOWED_REPLY


def test_walking_into_a_forced_mate_is_an_allowed_reply_whatever_the_reply_takes():
    # 2.g4?? in the Fool's Mate: …Qh4# is mate, not a capture of anything
    g4 = _move(
        "rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2",
        "g4",
        ply=3,
        best="e2e4",
        evals=(-60, -1000),
        mates=(None, -1),
    )
    assert mistake_cause(g4, "d8h4") == ALLOWED_REPLY


def test_a_capture_the_player_passed_up_is_a_missed_tactic():
    # exd5 won a knight for nothing; Ke2 didn't, and gave nothing away
    ke2 = _move("4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1", "Ke2", best="e4d5")
    assert mistake_cause(ke2, "d5b4") == MISSED_TACTIC


def test_a_mistake_with_nothing_concrete_is_positional():
    quiet = _move(
        "4k3/pp6/8/8/8/8/PP6/4K3 w - - 0 1",
        "Kd2",
        classification="mistake",
        best="b2b4",
        evals=(80, -10),
    )
    assert mistake_cause(quiet, "e8d7") == POSITIONAL


def test_only_mistakes_and_blunders_get_a_cause():
    for grade in ("book", "best", "good", "inaccuracy", None):
        move = _move(SCHOLAR, "Nf6", classification=grade, threat=("h5f7", None, 1))
        assert mistake_cause(move, "h5f7") is None


def test_an_answered_threat_is_not_missed():
    """The threat was there, but their best reply after the move is
    something else — whatever went wrong, it was not leaving the threat."""
    nf6 = _move(SCHOLAR, "g6", best="g7g6", threat=("h5f7", None, 1), evals=(-30, -20))
    assert mistake_cause(nf6, "h5f3") != MISSED_THREAT


def test_apply_reads_each_reply_off_the_next_move():
    board = chess.Board()
    game = Game(mode="local")
    for ply, (san, best) in enumerate(
        [
            ("e4", "e2e4"),
            ("e5", "e7e5"),
            ("Bc4", "g1f3"),
            ("Nc6", "b8c6"),
            ("Qh5", "g1f3"),
            ("Nf6", "g7g6"),
            ("Qxf7#", "h5f7"),
        ],
        start=1,
    ):
        fen_before = board.fen()
        board.push_san(san)
        game.moves.append(
            Move(
                ply=ply,
                san=san,
                fen_before=fen_before,
                fen_after=board.fen(),
                eval_before=0,
                eval_after=0,
                best_move=best,
                classification="best",
            )
        )
    nf6 = game.moves[5]
    nf6.classification = "blunder"
    nf6.threat_move, nf6.threat_mate = "h5f7", 1
    nf6.eval_after, nf6.mate_after = 1000, 1
    apply_mistake_causes(game)
    assert [move.mistake_cause for move in game.moves] == [None] * 5 + [
        MISSED_THREAT,
        None,
    ]
