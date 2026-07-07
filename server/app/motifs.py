"""Rule-based motif tagging (Phase 2 — no LLM, no engine calls).

Deliberately standalone from the Stockfish analysis job: detection is pure
python-chess logic over FENs and best moves the job already stored, so rules
can be refined and re-run (scripts/retag.py) without re-running the engine.

A move's stored tags come from two best-line passes:
- the engine's best move from the position the player faced — stored when the
  player missed it (mistake/blunder) or played exactly that move (executed
  the tactic)
- for mistakes/blunders only, the opponent's best reply to the played move —
  the tactic the mistake allowed

Detectors implemented so far (fixed taxonomy, product spec §4.4): fork, pin,
skewer, back-rank mate, hanging piece, discovered check, double check. The
remaining tactical motifs (discovered attack, overloading, deflection, x-ray,
zwischenzug, trapped piece) and the strategic motifs are follow-ups within
this phase — add them one at a time with positive AND near-miss test cases.
"""

import itertools

import chess

from app.models import Game, MotifTag

FORK = "fork"
PIN = "pin"
SKEWER = "skewer"
BACK_RANK_MATE = "back_rank_mate"
HANGING_PIECE = "hanging_piece"
DISCOVERED_CHECK = "discovered_check"
DOUBLE_CHECK = "double_check"

# Classifications whose moves get tagged with what they missed/allowed.
FLAGGED_CLASSIFICATIONS = {"mistake", "blunder"}

_VALUES = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
    chess.KING: 100,
}

_DIAGONAL = [(1, 1), (1, -1), (-1, 1), (-1, -1)]
_ORTHOGONAL = [(1, 0), (-1, 0), (0, 1), (0, -1)]
_SLIDER_DIRECTIONS = {
    chess.BISHOP: _DIAGONAL,
    chess.ROOK: _ORTHOGONAL,
    chess.QUEEN: _DIAGONAL + _ORTHOGONAL,
}


def _value(piece: chess.Piece) -> int:
    return _VALUES[piece.piece_type]


def _is_defended(board: chess.Board, square: chess.Square) -> bool:
    piece = board.piece_at(square)
    return bool(board.attackers(piece.color, square))


def _is_safe(board: chess.Board, square: chess.Square) -> bool:
    """A piece is safe enough to base a tactic on if no cheaper enemy piece
    attacks it and, when attacked at all, it has at least one defender.
    Deliberately SEE-lite — just enough to reject "tactics" the opponent
    refutes by taking the piece for free."""
    piece = board.piece_at(square)
    attackers = board.attackers(not piece.color, square)
    if not attackers:
        return True
    if any(_value(board.piece_at(a)) < _value(piece) for a in attackers):
        return False
    return _is_defended(board, square)


def _fork_targets(board: chess.Board, square: chess.Square) -> list[chess.Square]:
    """Enemy pieces attacked from `square` that can't just be left to hang:
    the king, anything worth more than the forker, or an undefended piece."""
    forker = board.piece_at(square)
    targets = []
    for target_sq in board.attacks(square):
        target = board.piece_at(target_sq)
        if target is None or target.color == forker.color:
            continue
        if (
            target.piece_type == chess.KING
            or _value(target) > _value(forker)
            or (_value(target) >= 3 and not _is_defended(board, target_sq))
        ):
            targets.append(target_sq)
    return targets


def _is_fork(after: chess.Board, to_square: chess.Square) -> bool:
    return len(_fork_targets(after, to_square)) >= 2 and _is_safe(after, to_square)


def _first_two_pieces_on_ray(
    board: chess.Board, square: chess.Square, direction: tuple[int, int]
) -> list[chess.Piece]:
    file_delta, rank_delta = direction
    file, rank = chess.square_file(square), chess.square_rank(square)
    found: list[chess.Piece] = []
    while len(found) < 2:
        file, rank = file + file_delta, rank + rank_delta
        if not (0 <= file <= 7 and 0 <= rank <= 7):
            break
        piece = board.piece_at(chess.square(file, rank))
        if piece:
            found.append(piece)
    return found


def _line_motifs(after: chess.Board, to_square: chess.Square) -> set[str]:
    """Pins and skewers created by the slider that just landed on to_square.

    Along each ray the first two pieces must both be enemies; a blocker of
    either color in between means no line motif (the "looks pinned but the
    line is blocked" near-miss). Pinned pawns and skewers that only win a
    pawn are skipped as noise.
    """
    piece = after.piece_at(to_square)
    directions = _SLIDER_DIRECTIONS.get(piece.piece_type, [])
    if directions and not _is_safe(after, to_square):
        return set()
    motifs: set[str] = set()
    for direction in directions:
        pieces = _first_two_pieces_on_ray(after, to_square, direction)
        if len(pieces) < 2:
            continue
        front, back = pieces
        if front.color == piece.color or back.color == piece.color:
            continue
        if front.piece_type not in (chess.PAWN, chess.KING) and (
            back.piece_type == chess.KING or _value(back) > _value(front)
        ):
            motifs.add(PIN)
        elif (
            (front.piece_type == chess.KING or _value(front) > _value(back))
            and back.piece_type != chess.KING
            and _value(back) >= 3
        ):
            motifs.add(SKEWER)
    return motifs


def _is_back_rank_mate(after: chess.Board) -> bool:
    if not after.is_checkmate():
        return False
    mated = after.turn
    king_square = after.king(mated)
    back_rank = 7 if mated == chess.BLACK else 0
    if chess.square_rank(king_square) != back_rank:
        return False
    return any(
        after.piece_at(sq).piece_type in (chess.ROOK, chess.QUEEN)
        and chess.square_rank(sq) == back_rank
        for sq in after.checkers()
    )


def _wins_hanging_piece(board: chess.Board, move: chess.Move) -> bool:
    """The move captures a piece that was free to take: undefended, or
    defended but taken by something cheaper (pawn takes queen still wins).
    Pawn grabs don't count — that's material play, not a motif to drill."""
    victim = board.piece_at(move.to_square)
    if victim is None or _value(victim) < 3:
        return False
    if not _is_defended(board, move.to_square):
        return True
    return _value(victim) > _value(board.piece_at(move.from_square))


def _check_motifs(
    before: chess.Board, after: chess.Board, move: chess.Move
) -> set[str]:
    checkers = after.checkers()
    if not checkers:
        return set()
    motifs: set[str] = set()
    if len(checkers) >= 2:
        motifs.add(DOUBLE_CHECK)
    moved_to = {move.to_square}
    if before.is_castling(move):
        # count the castled rook as "the moved piece" so its direct check
        # doesn't read as discovered
        rook_file = 3 if chess.square_file(move.to_square) < 4 else 5
        moved_to.add(chess.square(rook_file, chess.square_rank(move.to_square)))
    if any(sq not in moved_to for sq in checkers):
        motifs.add(DISCOVERED_CHECK)
    return motifs


def detect_motifs(board: chess.Board, move: chess.Move) -> set[str]:
    """Motifs a legal move executes from the given position. Pure function —
    the wiring in tags_for_move decides which (position, move) pairs matter."""
    motifs: set[str] = set()
    if _wins_hanging_piece(board, move):
        motifs.add(HANGING_PIECE)
    after = board.copy(stack=False)
    after.push(move)
    motifs |= _check_motifs(board, after, move)
    if _is_back_rank_mate(after):
        motifs.add(BACK_RANK_MATE)
    if _is_fork(after, move.to_square):
        motifs.add(FORK)
    motifs |= _line_motifs(after, move.to_square)
    return motifs


def tags_for_move(
    *,
    fen_before: str,
    fen_after: str,
    played_san: str,
    best_move_uci: str | None,
    classification: str | None,
    opponent_best_uci: str | None,
) -> list[str]:
    """The tags to store for one analyzed move (empty until analysis ran)."""
    flagged = classification in FLAGGED_CLASSIFICATIONS
    motifs: set[str] = set()

    if best_move_uci:
        board = chess.Board(fen_before)
        best = chess.Move.from_uci(best_move_uci)
        if flagged or board.parse_san(played_san) == best:
            motifs |= detect_motifs(board, best)

    if flagged and opponent_best_uci:
        after = chess.Board(fen_after)
        if not after.is_game_over():
            motifs |= detect_motifs(after, chess.Move.from_uci(opponent_best_uci))

    return sorted(motifs)


def apply_rule_based_tags(game: Game) -> None:
    """(Re)derive rule-based tags for every move of an analyzed game from the
    stored analysis columns — no engine involved, so it can re-run whenever
    the rules change. Manual tags are preserved.

    The opponent's best reply to move N is move N+1's stored best_move (same
    position). The final move has no stored reply — fine, the game ended
    there or the position is the terminal one.
    """
    for move, reply in itertools.zip_longest(game.moves, game.moves[1:]):
        names = tags_for_move(
            fen_before=move.fen_before,
            fen_after=move.fen_after,
            played_san=move.san,
            best_move_uci=move.best_move,
            classification=move.classification,
            opponent_best_uci=reply.best_move if reply else None,
        )
        kept = [tag for tag in move.motif_tags if tag.source != "rule_based"]
        move.motif_tags = kept + [
            MotifTag(motif=name, source="rule_based") for name in names
        ]
