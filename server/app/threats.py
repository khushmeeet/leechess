"""The null-move threat search behind Review's threat line.

For the position before each move: give the move to the other side — as if
the player passed — and record what the engine would play with it, and the
score. That is the opponent's threat, the thing the player's move had to
answer. Play runs the same search in the browser on every engine reply.

Deciding whether the move is a threat worth telling the player about (a
mate, a capture that wins material, a tactic worth a pawn and a half, a quiet
move worth a pawn that sets up something the board can show) is
`classifyThreat` in client/src/lib/threats.ts, which Play and Review both call
on these stored facts. `threat_kind` below is its Python port, for the
mistake causes Progress counts (app/mistakes.py): the kind only, none of the
wording. shared/threats.json runs the same cases through both, so the server
can never count a threat the screens would not show.
"""

from dataclasses import dataclass

import chess
import chess.engine

from app.motifs import (
    BACK_RANK_MATE,
    DEFLECTION,
    DISCOVERED_ATTACK,
    DISCOVERED_CHECK,
    DOUBLE_CHECK,
    FORK,
    OVERLOADING,
    PIN,
    SKEWER,
    TRAPPED_PIECE,
    ZWISCHENZUG,
    detect_motifs,
)

# Swing, in centipawns, a tactic must be worth before it counts as a threat,
# and past which a threat counts with no name — classifyThreat's bars.
MOTIF_SWING_CP = 150
ATTACK_SWING_CP = 300
# ...and the bar for a quiet move that sets something up the board can show
# (sets_up) — a pawn's worth.
SMALL_SWING_CP = 100
# Kept in step with evalClampCp in shared/classification.json (a mate scores
# as the clamp) without importing app.analysis, which imports this module.
_CLAMP_CP = 1000

# The motifs the client can name in a threat sentence (liveMotifs.ts's
# MOTIF_PRIORITY, less hanging_piece, which the exchange count settles).
NAMEABLE_MOTIFS = (
    BACK_RANK_MATE,
    DOUBLE_CHECK,
    DISCOVERED_CHECK,
    DISCOVERED_ATTACK,
    FORK,
    ZWISCHENZUG,
    DEFLECTION,
    OVERLOADING,
    TRAPPED_PIECE,
    PIN,
    SKEWER,
)

_VALUES = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
    chess.KING: 100,
}

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


def static_exchange(board: chess.Board, from_square: int, to_square: int) -> int:
    """Material the side moving from -> to comes out ahead by, in pawns, if
    both sides keep recapturing on `to` with their cheapest piece and either
    may stop when continuing would lose. Attackers are recounted on the board
    after each capture, so a queen behind a rook joins in. Zero when `to` is
    empty. Same count as staticExchange in threats.ts."""
    target = board.piece_at(to_square)
    mover = board.piece_at(from_square)
    if target is None or mover is None:
        return 0
    work = board.copy(stack=False)
    gains = [_VALUES[target.piece_type]]
    work.remove_piece_at(from_square)
    work.set_piece_at(to_square, mover)
    standing = _VALUES[mover.piece_type]
    side = not mover.color
    while True:
        attackers = list(work.attackers(side, to_square))
        if not attackers:
            break
        cheapest = min(attackers, key=lambda sq: _VALUES[work.piece_type_at(sq)])
        piece = work.piece_at(cheapest)
        gains.append(standing - gains[-1])
        work.remove_piece_at(cheapest)
        work.set_piece_at(to_square, piece)
        standing = _VALUES[piece.piece_type]
        side = not side
    for i in range(len(gains) - 1, 0, -1):
        gains[i - 1] = -max(-gains[i - 1], gains[i])
    return gains[0]


def best_capture_gain(board: chess.Board) -> int:
    """The most the side to move wins, in pawns, by its best capture — zero
    when every capture loses material or there is none."""
    best = 0
    for move in board.legal_moves:
        if board.is_capture(move) and not board.is_en_passant(move):
            best = max(best, static_exchange(board, move.from_square, move.to_square))
    return best


def sets_up(passed: chess.Board, move: chess.Move) -> bool:
    """A quiet threat move sets up something the player can check on the
    board: the piece that moved could then win material by a capture, or it
    now hits more squares next to the player's king than it did (two at
    least). setsUp in threats.ts, kind only."""
    after = passed.copy(stack=False)
    after.push(move)
    mover = after.piece_at(move.to_square)
    if mover is None:
        return False
    again = pass_turn(after)
    if again is not None:
        for follow in again.legal_moves:
            if (
                follow.from_square == move.to_square
                and again.is_capture(follow)
                and not again.is_en_passant(follow)
                and static_exchange(again, follow.from_square, follow.to_square) >= 1
            ):
                return True
    king = after.king(not mover.color)
    if king is None:
        return False
    zone = chess.SquareSet(chess.BB_KING_ATTACKS[king])
    hit_now = len(zone & after.attacks(move.to_square))
    hit_before = len(zone & passed.attacks(move.from_square))
    return hit_now >= 2 and hit_now > hit_before


def _centipawns(cp: float | None, mate: int | None) -> float | None:
    if mate is not None:
        return _CLAMP_CP if mate > 0 else -_CLAMP_CP
    if cp is None:
        return None
    return max(-_CLAMP_CP, min(_CLAMP_CP, cp))


def threat_kind(
    fen: str,
    threat_uci: str | None,
    threat_cp: float | None,
    threat_mate: int | None,
    current_cp: float | None,
    current_mate: int | None,
) -> str | None:
    """The kind of threat classifyThreat would report for `fen` (the player
    to move) — "mate", "material", "motif" or "attack" — or None when there
    is nothing concrete to answer. Scores are white's point of view."""
    if not threat_uci:
        return None
    passed = pass_turn(chess.Board(fen))
    if passed is None:
        return None
    try:
        move = chess.Move.from_uci(threat_uci)
    except ValueError:
        return None
    if move not in passed.legal_moves:
        return None  # the engine's move doesn't fit this position

    sign = 1 if passed.turn == chess.WHITE else -1
    if threat_mate is not None and sign * threat_mate > 0:
        return "mate"

    motifs = detect_motifs(passed, move)
    if (
        passed.is_capture(move)
        and static_exchange(passed, move.from_square, move.to_square) >= 1
    ):
        # a capture that lands on a fork is told as the fork
        return "motif" if FORK in motifs else "material"

    now = _centipawns(current_cp, current_mate)
    after = _centipawns(threat_cp, threat_mate)
    if now is None or after is None:
        return None
    # less what the free move took off the player's board: a capture it
    # rescued from, not one still there after it
    after_board = passed.copy(stack=False)
    after_board.push(move)
    rescued = best_capture_gain(chess.Board(fen)) - best_capture_gain(after_board)
    swing = sign * (after - now) - 100 * max(0, rescued)
    if swing >= MOTIF_SWING_CP and any(name in motifs for name in NAMEABLE_MOTIFS):
        return "motif"
    if swing >= SMALL_SWING_CP and sets_up(passed, move):
        return "attack"
    if swing >= ATTACK_SWING_CP:
        return "attack"
    return None
