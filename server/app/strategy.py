"""Position ideas: the strategic half of the motif taxonomy (product spec
§4.4) — outposts, open files, a weak back rank, and isolated, doubled and
backward pawns.

Like the tactical tagger this is board arithmetic, no engine: every idea is a
fact the player can check on the board. client/src/lib/positionIdeas.ts finds
the same ideas for Review and the board overlay, and
shared/position-ideas.json runs the same cases through both.

The analysis job tags a mistake with an idea when no tactic explains it (the
tactical motifs would): the engine's move took an outpost or an open file, or
mended a weak back rank — or the move played left its own side with a weak
back rank or a new weak pawn. "The position slipped" becomes "you gave
yourself an isolated pawn".
"""

import chess

OUTPOST = "outpost"
OPEN_FILE = "open_file"
WEAK_BACK_RANK = "weak_back_rank"
ISOLATED_PAWN = "isolated_pawn"
DOUBLED_PAWNS = "doubled_pawns"
BACKWARD_PAWN = "backward_pawn"

STRATEGIC_MOTIFS = (
    OUTPOST,
    OPEN_FILE,
    WEAK_BACK_RANK,
    ISOLATED_PAWN,
    DOUBLED_PAWNS,
    BACKWARD_PAWN,
)


def _relative_rank(square: chess.Square, color: chess.Color) -> int:
    """1-8 from `color`'s side of the board."""
    rank = chess.square_rank(square) + 1
    return rank if color == chess.WHITE else 9 - rank


def _ahead(rank_a: int, rank_b: int, color: chess.Color) -> bool:
    """Rank a is further up the board than rank b, for `color` (absolute
    ranks 1-8)."""
    return rank_a > rank_b if color == chess.WHITE else rank_a < rank_b


def outposts(board: chess.Board, color: chess.Color) -> list[chess.Square]:
    """Squares on `color`'s 4th to 6th rank that one of its pawns guards and
    no enemy pawn can ever attack — no enemy pawn on a neighbouring file
    further up the board, where it could come forward to challenge. Squares
    holding a pawn, or an enemy piece, are left out: an outpost is somewhere
    to put a piece."""
    enemy_pawns = board.pieces(chess.PAWN, not color)
    found = []
    for square in chess.SQUARES:
        if not 4 <= _relative_rank(square, color) <= 6:
            continue
        occupant = board.piece_at(square)
        if occupant and (occupant.piece_type == chess.PAWN or occupant.color != color):
            continue
        if not board.attackers(color, square) & board.pieces(chess.PAWN, color):
            continue
        file = chess.square_file(square)
        rank = chess.square_rank(square) + 1
        challengers = [
            pawn
            for pawn in enemy_pawns
            if abs(chess.square_file(pawn) - file) == 1
            and _ahead(chess.square_rank(pawn) + 1, rank, color)
        ]
        if not challengers:
            found.append(square)
    return found


def file_kind(board: chess.Board, file: int, color: chess.Color) -> str | None:
    """'open' with no pawns on the file, 'half_open' with none of `color`'s,
    None while `color` has a pawn there."""
    mask = chess.BB_FILES[file]
    own = board.pieces(chess.PAWN, color) & chess.SquareSet(mask)
    theirs = board.pieces(chess.PAWN, not color) & chess.SquareSet(mask)
    if own:
        return None
    return "half_open" if theirs else "open"


def weak_back_rank(board: chess.Board, color: chess.Color) -> bool:
    """`color`'s king is on its back rank with no way off it — every square in
    front of it is blocked by its own pieces or attacked — no rook or queen of
    its own stands on that rank to guard it, and the other side has a rook or
    a queen to use it. A check along the rank would then be mate, or cost
    material to stop."""
    king = board.king(color)
    if king is None or _relative_rank(king, color) != 1:
        return False
    back = chess.square_rank(king)
    if any(
        chess.square_rank(sq) == back
        for sq in board.pieces(chess.ROOK, color) | board.pieces(chess.QUEEN, color)
    ):
        return False
    if not (board.pieces(chess.ROOK, not color) | board.pieces(chess.QUEEN, not color)):
        return False
    step = 1 if color == chess.WHITE else -1
    file = chess.square_file(king)
    for df in (-1, 0, 1):
        f = file + df
        if not 0 <= f <= 7:
            continue
        square = chess.square(f, back + step)
        occupant = board.piece_at(square)
        if occupant and occupant.color == color:
            continue
        if board.is_attacked_by(not color, square):
            continue
        return False  # a way off the back rank
    return True


def pawn_weaknesses(board: chess.Board, color: chess.Color) -> dict[str, set]:
    """`color`'s weak pawns: isolated (no pawn of its own on a neighbouring
    file), doubled (another of its own on the same file — keyed by file) and
    backward (not isolated, every neighbouring pawn of its own already further
    up the board, and the square in front of it covered by an enemy pawn)."""
    pawns = board.pieces(chess.PAWN, color)
    by_file: dict[int, list[chess.Square]] = {}
    for pawn in pawns:
        by_file.setdefault(chess.square_file(pawn), []).append(pawn)
    isolated: set[chess.Square] = set()
    backward: set[chess.Square] = set()
    doubled: set[int] = {file for file, group in by_file.items() if len(group) > 1}
    step = 8 if color == chess.WHITE else -8
    for pawn in pawns:
        file = chess.square_file(pawn)
        rank = chess.square_rank(pawn) + 1
        neighbours = by_file.get(file - 1, []) + by_file.get(file + 1, [])
        if not neighbours:
            isolated.add(pawn)
            continue
        if all(_ahead(chess.square_rank(n) + 1, rank, color) for n in neighbours):
            stop = pawn + step
            if 0 <= stop < 64 and board.attackers(not color, stop) & board.pieces(
                chess.PAWN, not color
            ):
                backward.add(pawn)
    return {ISOLATED_PAWN: isolated, DOUBLED_PAWNS: doubled, BACKWARD_PAWN: backward}


def _after(board: chess.Board, move: chess.Move) -> chess.Board:
    after = board.copy(stack=False)
    after.push(move)
    return after


def move_ideas(board: chess.Board, move: chess.Move) -> set[str]:
    """What a move does strategically for the side making it: takes an
    outpost with a knight or bishop, puts a rook or queen on an open or
    half-open file it was not on, or mends a weak back rank."""
    color = board.turn
    piece = board.piece_at(move.from_square)
    if piece is None:
        return set()
    after = _after(board, move)
    ideas: set[str] = set()
    if piece.piece_type in (chess.KNIGHT, chess.BISHOP) and move.to_square in outposts(
        after, color
    ):
        ideas.add(OUTPOST)
    if piece.piece_type in (chess.ROOK, chess.QUEEN):
        to_file = chess.square_file(move.to_square)
        if to_file != chess.square_file(move.from_square) and file_kind(
            after, to_file, color
        ):
            ideas.add(OPEN_FILE)
    if weak_back_rank(board, color) and not weak_back_rank(after, color):
        ideas.add(WEAK_BACK_RANK)
    return ideas


def weaknesses_made(board: chess.Board, move: chess.Move) -> set[str]:
    """Weaknesses a move leaves its own side with that it did not have: a weak
    back rank, or a new isolated, doubled or backward pawn."""
    color = board.turn
    after = _after(board, move)
    made: set[str] = set()
    if weak_back_rank(after, color) and not weak_back_rank(board, color):
        made.add(WEAK_BACK_RANK)
    before_pawns = pawn_weaknesses(board, color)
    after_pawns = pawn_weaknesses(after, color)
    for name in (ISOLATED_PAWN, DOUBLED_PAWNS, BACKWARD_PAWN):
        if after_pawns[name] - before_pawns[name]:
            made.add(name)
    return made


def strategic_tags(
    fen_before: str, played_san: str, best_move_uci: str | None
) -> set[str]:
    """The position ideas behind a mistake no tactic explains: what the
    engine's move would have done, and what the move played gave away."""
    board = chess.Board(fen_before)
    played = board.parse_san(played_san)
    tags = weaknesses_made(board, played)
    if best_move_uci:
        best = chess.Move.from_uci(best_move_uci)
        if best != played and best in board.legal_moves:
            tags |= move_ideas(board, best) - move_ideas(board, played)
    return tags
