import shutil

import chess
import chess.engine
import pytest

pytestmark = pytest.mark.engine

STOCKFISH = shutil.which("stockfish")

# Italian game middlegame position, also used by the client's engine check —
# keep the two in sync so WASM and native evals can be compared directly.
TEST_FEN = "r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 6"


@pytest.mark.skipif(STOCKFISH is None, reason="stockfish binary not in PATH")
def test_native_stockfish_evaluates_fen():
    with chess.engine.SimpleEngine.popen_uci(STOCKFISH) as engine:
        info = engine.analyse(chess.Board(TEST_FEN), chess.engine.Limit(depth=16))

    assert info["depth"] >= 16
    score = info["score"].white()
    assert score.score(mate_score=100_000) is not None
    # Roughly balanced middlegame — a sane eval is well within ±2 pawns.
    # Guards against wiring bugs (wrong side to move, wrong FEN), not accuracy.
    assert abs(score.score(mate_score=100_000)) < 200
    assert info["pv"], "engine should return a principal variation"
