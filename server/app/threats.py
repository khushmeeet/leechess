"""The null-move threat search behind Review's threat line.

For the position before each move: give the move to the other side — as if
the player passed — and record what the engine would play with it, and the
score. That is the opponent's threat, the thing the player's move had to
answer. Play runs the same search in the browser on every engine reply.

Only the engine half lives here. Deciding whether the move is a threat worth
telling the player about (a mate, a capture that wins material, a tactic worth
a pawn and a half) is `classifyThreat` in client/src/lib/threats.ts, which
Play and Review both call on these stored facts — so the two screens can never
disagree about what counts as a threat.
"""

from dataclasses import dataclass

import chess
import chess.engine

# The search only has to get the first move of the line right — "what would
# they do with a free move" — so it runs shallower than the main analysis.
# Same depth as the browser's search, so Play and Review see the same threats.
THREAT_DEPTH = 12


@dataclass(frozen=True)
class ThreatSearch:
    """The opponent's best move with a free move, and the score after it,
    white's point of view: centipawns, or moves to mate (one of the two)."""

    move: str
    cp: float | None
    mate: int | None


def pass_turn(board: chess.Board) -> chess.Board | None:
    """The same position with the other side to move. None when the side to
    move is in check (there is no passing out of check — the check is already
    the threat) or the game is over. The en passant square goes: it belonged
    to the move just played, not to a turn that was skipped."""
    if board.is_check() or board.is_game_over():
        return None
    passed = board.copy(stack=False)
    passed.turn = not passed.turn
    passed.ep_square = None
    return passed if passed.is_valid() else None


def search_threat(
    engine: chess.engine.SimpleEngine, board: chess.Board, depth: int
) -> ThreatSearch | None:
    """Null-move search on `board`; None when there is nothing to search."""
    passed = pass_turn(board)
    if passed is None:
        return None
    info = engine.analyse(passed, chess.engine.Limit(depth=depth))
    pv = info.get("pv")
    if not pv:
        return None
    score = info["score"].white()
    mate = score.mate()
    return ThreatSearch(
        move=pv[0].uci(),
        cp=None if mate is not None else float(score.score()),
        mate=mate,
    )
