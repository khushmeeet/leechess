"""Stockfish verification of the endgame catalog.

Split out of test_endgame_drills.py: those tests are pure logic and carry the
`unit` mark, which the marker registry defines as "no Stockfish involved".
Twelve depth-30 searches are the opposite of that, and folding them into a
unit-marked module made `pytest -m unit` shell out to the engine and take as
long as the whole suite.
"""

import shutil

import chess
import chess.engine
import pytest

from app.endgame_drills import CATALOG

pytestmark = pytest.mark.engine

# Same lookup test_engine.py uses; Debian installs the binary into /usr/games,
# which the Dockerfile adds to PATH.
STOCKFISH = shutil.which("stockfish")

# Deep enough that these simple endings are read exactly; shallower searches
# can still call a theoretically drawn K+P position "winning".
VERIFY_DEPTH = 30
# This is a typo detector, not a precision instrument: a mistyped FEN reads
# near zero (or negative), nowhere near three pawns. Some drills only resolve
# to a mate score several plies deeper than VERIFY_DEPTH — rook-pawn-cut-off
# is mate-in-31 but reads ~+490 here — so don't demand a mate score.
WINNING_CP = 300
# A "draw" drill must sit on the drawn line, not "nearly holdable".
DRAWN_CP = 60


@pytest.mark.skipif(STOCKFISH is None, reason="stockfish binary not in PATH")
@pytest.mark.parametrize("drill", CATALOG, ids=lambda d: d.key)
def test_catalog_position_matches_its_goal(drill):
    """Every drill's stated goal must be the position's actual truth.

    Without this, a transposed FEN character ships a drill nobody can pass and
    the Leitner box just keeps resetting to 1.
    """
    board = chess.Board(drill.fen)
    player = chess.WHITE if drill.player_color == "white" else chess.BLACK
    with chess.engine.SimpleEngine.popen_uci(STOCKFISH) as engine:
        info = engine.analyse(board, chess.engine.Limit(depth=VERIFY_DEPTH))
    score = info["score"].pov(player)

    if drill.goal == "win":
        assert score.is_mate() or (score.score() or 0) > WINNING_CP, (
            f"{drill.key} is declared winning but evaluates {score}"
        )
        assert not score.is_mate() or score.mate() > 0, (
            f"{drill.key} is declared winning but the player is getting mated"
        )
    else:
        assert not score.is_mate(), f"{drill.key} is declared drawn but evaluates {score}"
        assert abs(score.score() or 0) <= DRAWN_CP, (
            f"{drill.key} is declared drawn but evaluates {score}"
        )
