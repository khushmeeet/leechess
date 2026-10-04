"""The engine half of the threat search, with the engine stubbed out.

What counts as a threat is decided client-side (client/src/lib/threats.ts);
these pin what the search hands it — the position searched, and the score
turned to white's point of view. The real-engine path is covered by
test_analysis_job.py.
"""

import chess
import chess.engine
import pytest

from app.threats import pass_turn, search_threat

pytestmark = pytest.mark.unit

# 3.Qh5 in Scholar's mate, Black to move: Qxf7# is threatened.
SCHOLAR = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3"


class StubEngine:
    """Answers every search with one canned result and remembers the board."""

    def __init__(self, move: str, score: chess.engine.Score, pov: chess.Color):
        self.result = {"pv": [chess.Move.from_uci(move)], "score": chess.engine.PovScore(score, pov)}
        self.searched: list[chess.Board] = []

    def analyse(self, board, limit):
        self.searched.append(board.copy())
        return self.result


def test_pass_turn_hands_the_move_over():
    passed = pass_turn(chess.Board(SCHOLAR))
    assert passed is not None
    assert passed.turn == chess.WHITE
    assert passed.board_fen() == chess.Board(SCHOLAR).board_fen()


def test_pass_turn_drops_the_en_passant_square():
    board = chess.Board("rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3")
    assert board.ep_square is not None
    assert pass_turn(board).ep_square is None


def test_pass_turn_refuses_check_and_finished_games():
    assert pass_turn(chess.Board("4k3/8/8/8/8/8/8/R3K2r w - - 0 1")) is None
    assert pass_turn(chess.Board("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")) is None  # stalemate


def test_search_runs_on_the_passed_position():
    engine = StubEngine("h5f7", chess.engine.Mate(1), chess.WHITE)
    found = search_threat(engine, chess.Board(SCHOLAR), depth=12)
    assert engine.searched[0].turn == chess.WHITE
    assert found.move == "h5f7"


def test_mate_is_reported_as_moves_to_mate_from_whites_side():
    engine = StubEngine("h5f7", chess.engine.Mate(1), chess.WHITE)
    found = search_threat(engine, chess.Board(SCHOLAR), depth=12)
    assert (found.mate, found.cp) == (1, None)


def test_centipawns_are_turned_to_whites_side():
    # Black to move in the passed position, Black 3 pawns better
    board = chess.Board("r1b2rk1/ppq2ppp/2n1p3/3p4/2P1n3/PP1BbN1P/1BQN1PP1/3RK2R w K - 0 14")
    engine = StubEngine("e4f2", chess.engine.Cp(332), chess.BLACK)
    found = search_threat(engine, board, depth=12)
    assert (found.move, found.cp, found.mate) == ("e4f2", -332.0, None)


def test_no_search_in_check():
    engine = StubEngine("h1a1", chess.engine.Cp(0), chess.WHITE)
    assert search_threat(engine, chess.Board("4k3/8/8/8/8/8/8/R3K2r w - - 0 1"), 12) is None
    assert engine.searched == []
