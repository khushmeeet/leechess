"""Why a mistake happened: which step of a thinking routine broke.

Motif success rates say which patterns a player misses in puzzles. They do
not say which habit fails at the board, and that is what a player can change.
Every move graded a mistake or blunder gets the first step of the routine
that would have caught it:

| Cause           | The step that broke                                          |
|-----------------|--------------------------------------------------------------|
| `missed_threat` | "What does their last move threaten?" — there was a threat   |
|                 | (classifyThreat would have shown it) and it was still their  |
|                 | best move after yours                                        |
| `hung_piece`    | "Is my move safe?" — their best reply takes something that   |
|                 | the exchange count says is lost                              |
| `allowed_reply` | "Is my move safe?" — their best reply is a check, a mate, or |
|                 | a tactic, without winning material outright                  |
| `missed_tactic` | "Do I have a check, capture or threat?" — your best move     |
|                 | won material or ran a tactic, and you played something else  |
| `positional`    | none of the above: the position slipped without one          |
|                 | concrete move to point at                                    |

The order is the routine's order, with the threat first because it was on the
board before the move was chosen. Everything is read off stored analysis —
no engine — so `scripts/retag.py` can re-derive it whenever the rules change.
The opponent's best reply to move N is move N+1's stored best move, as in
motif tagging.
"""

import itertools

import chess

from app.models import Game, Move
from app.motifs import FLAGGED_CLASSIFICATIONS, detect_motifs
from app.threats import NAMEABLE_MOTIFS, static_exchange, threat_kind

MISSED_THREAT = "missed_threat"
HUNG_PIECE = "hung_piece"
ALLOWED_REPLY = "allowed_reply"
MISSED_TACTIC = "missed_tactic"
POSITIONAL = "positional"
CAUSES = (MISSED_THREAT, HUNG_PIECE, ALLOWED_REPLY, MISSED_TACTIC, POSITIONAL)

# The causes in words, for the LLM prompt (app/explanations.py). The client's
# $lib/mistakes.ts has the screen's own wording.
CAUSE_WORDS = {
    MISSED_THREAT: "their last move threatened something, and this move left it on the board.",
    HUNG_PIECE: "this move left a piece where it can be taken for free.",
    ALLOWED_REPLY: "this move allowed a forcing reply: a check, a mate or a tactic.",
    MISSED_TACTIC: "the player had a tactic or a free capture, and played something else.",
    POSITIONAL: "no single tactic; the position slipped.",
}


def _legal(board: chess.Board, uci: str | None) -> chess.Move | None:
    if not uci:
        return None
    try:
        move = chess.Move.from_uci(uci)
    except ValueError:
        return None
    return move if move in board.legal_moves else None


def _wins_material(board: chess.Board, move: chess.Move) -> bool:
    return board.is_capture(move) and (
        static_exchange(board, move.from_square, move.to_square) >= 1
    )


def _runs_a_tactic(board: chess.Board, move: chess.Move) -> bool:
    return bool(detect_motifs(board, move) & set(NAMEABLE_MOTIFS))


def _mate_for_mover(move: Move, cp: float | None, mate: int | None) -> bool | None:
    """Whether a stored mate (white POV, the clamped eval saying whose when
    it is 0) is the mover's; None without one."""
    if mate is None or cp is None:
        return None
    mover_is_white = move.ply % 2 == 1
    return (cp > 0) == mover_is_white


def _walked_into_mate(move: Move) -> bool:
    """The move left a forced mate against its mover that was not there."""
    return _mate_for_mover(move, move.eval_after, move.mate_after) is False and (
        _mate_for_mover(move, move.eval_before, move.mate_before) is not False
    )


def mistake_cause(move: Move, reply_uci: str | None) -> str | None:
    """The cause for one graded move; None unless it is a mistake or blunder.
    `reply_uci` is the opponent's best move after it (the next move's stored
    best move), None for the last move of a game."""
    if move.classification not in FLAGGED_CLASSIFICATIONS:
        return None

    kind = threat_kind(
        move.fen_before,
        move.threat_move,
        move.threat_cp,
        move.threat_mate,
        move.eval_before,
        move.mate_before,
    )
    if kind is not None and reply_uci is not None and reply_uci == move.threat_move:
        return MISSED_THREAT

    after = chess.Board(move.fen_after)
    reply = _legal(after, reply_uci)
    if _walked_into_mate(move):
        return ALLOWED_REPLY
    if reply is not None:
        if _wins_material(after, reply):
            return HUNG_PIECE
        if after.gives_check(reply) or _runs_a_tactic(after, reply):
            return ALLOWED_REPLY

    before = chess.Board(move.fen_before)
    best = _legal(before, move.best_move)
    if best is not None and best != before.parse_san(move.san):
        if _wins_material(before, best) or _runs_a_tactic(before, best):
            return MISSED_TACTIC
        if _mate_for_mover(move, move.eval_before, move.mate_before):
            return MISSED_TACTIC  # a forced mate of their own

    return POSITIONAL


def apply_mistake_causes(game: Game) -> None:
    """(Re)derive the cause of every graded move of an analyzed game."""
    for move, reply in itertools.zip_longest(game.moves, game.moves[1:]):
        move.mistake_cause = mistake_cause(move, reply.best_move if reply else None)
