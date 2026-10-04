"""LLM "why" explanations (Phase 5) — Claude via the Anthropic API.

Gated to flagged moves only (mistakes/blunders and tagged-tactic moves, spec
§4.2) — never every move, to control cost — and cached aggressively: one
Explanation row per move, generated once by the analysis job, never
regenerated. Analysis must never fail because the LLM is unreachable: any API
problem is logged and the game still completes, just without the texts
(scripts/explain.py backfills later).

LEECHESS_EXPLANATIONS=off disables generation entirely — both automated
suites set it so they can never hit the real (paid) API.
"""

import itertools
import logging
import os
import re

import chess

from app.llm import MODEL, request_text
from app.mistakes import CAUSE_WORDS
from app.models import Explanation, Game, Move
from app.motifs import detect_motifs
from app.threats import NAMEABLE_MOTIFS, pass_turn, static_exchange, threat_kind

logger = logging.getLogger(__name__)

EXPLAINABLE_CLASSIFICATIONS = {"mistake", "blunder"}

SYSTEM_PROMPT = (
    "You are a chess coach writing for an improving club player rated around "
    "1400. Given the facts of one analyzed move from their game, explain in "
    "plain language why the engine's best move works and why the played move "
    "falls short — name the concrete pieces, squares, and threats involved, "
    "the way the facts name them ('the knight on d2'). If the played move IS "
    "the best move, explain why it works instead. Use only the facts given: "
    "every piece you name must stand on the square you name, in the position "
    "or along one of the lines. Write 2-4 sentences of flowing prose — no "
    "headings, no lists, no variation dumps, no engine jargon like "
    "'centipawns' — then end with one short rule the player can reuse next "
    "game, as a sentence starting 'Rule:'. Address the player as 'you'."
)


def explanations_enabled() -> bool:
    """LEECHESS_EXPLANATIONS=off|0|false turns the LLM pass off entirely."""
    value = os.environ.get("LEECHESS_EXPLANATIONS", "on").strip().lower()
    return value not in {"off", "0", "false"}


def needs_explanation(move: Move) -> bool:
    """Spec §4.2 gate: mistakes/blunders, plus moves carrying a motif tag
    (which includes executed tactics — "here's why your move worked")."""
    return move.classification in EXPLAINABLE_CLASSIFICATIONS or bool(move.motif_tags)


def _san(fen: str, uci: str | None) -> str | None:
    if not uci:
        return None
    board = chess.Board(fen)
    move = chess.Move.from_uci(uci)
    return board.san(move) if move in board.legal_moves else None


_PIECE_NAMES = {
    chess.KING: "king",
    chess.QUEEN: "queen",
    chess.ROOK: "rook",
    chess.BISHOP: "bishop",
    chess.KNIGHT: "knight",
    chess.PAWN: "pawn",
}


def _describe(board: chess.Board, square: int) -> str:
    """'the bishop on f5' — the form the prompt asks the model to use."""
    piece = board.piece_at(square)
    return f"the {_PIECE_NAMES[piece.piece_type]} on {chess.square_name(square)}"


def _piece_list(board: chess.Board, color: bool) -> str:
    """'King g1, Queen c2, Rooks c1 f1, Knight d2; pawns a4 b3 f2' — LLMs
    misread FEN strings, so the position goes in as words."""
    parts = []
    for piece_type in (chess.KING, chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT):
        squares = [chess.square_name(sq) for sq in board.pieces(piece_type, color)]
        if squares:
            name = _PIECE_NAMES[piece_type].capitalize()
            parts.append(f"{name}{'s' if len(squares) > 1 else ''} {' '.join(squares)}")
    pawns = [chess.square_name(sq) for sq in board.pieces(chess.PAWN, color)]
    text = ", ".join(parts)
    return f"{text}; pawns {' '.join(pawns)}" if pawns else text


def _line_san(fen: str, ucis: list[str]) -> str:
    """'21. Bxc8 Raxc8 22. Qd3' — numbered like a scoresheet, stopping at the
    first move that doesn't fit."""
    board = chess.Board(fen)
    words: list[str] = []
    for index, uci in enumerate(ucis):
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            break
        if move not in board.legal_moves:
            break
        if board.turn == chess.WHITE:
            words.append(f"{board.fullmove_number}.")
        elif index == 0:
            words.append(f"{board.fullmove_number}...")
        words.append(board.san(move))
        board.push(move)
    return " ".join(words)


def _win_chances(cp: float, mate: int | None, white: bool) -> float:
    """The mover's winning chances in percent — the curve move grading uses."""
    from app.analysis import win_percent  # analysis imports this module

    if mate is not None:
        white_chances = 100.0 if (mate > 0 if mate else cp > 0) else 0.0
    else:
        white_chances = win_percent(cp)
    return white_chances if white else 100.0 - white_chances


def _threat_fact(move: Move) -> str | None:
    """The threat the move had to answer, in words — only one the screens
    would show (threat_kind is classifyThreat's port)."""
    kind = threat_kind(
        move.fen_before,
        move.threat_move,
        move.threat_cp,
        move.threat_mate,
        move.eval_before,
        move.mate_before,
    )
    if kind is None:
        return None
    passed = pass_turn(chess.Board(move.fen_before))
    threat = chess.Move.from_uci(move.threat_move)
    side = "White" if passed.turn == chess.WHITE else "Black"
    san = passed.san(threat)
    if kind == "mate":
        return f"Before the move, {side} was threatening a forced mate starting with {san}."
    if kind == "material":
        return (
            f"Before the move, {side} was threatening {san}, winning "
            f"{_describe(passed, threat.to_square)}."
        )
    if kind == "motif":
        found = [
            name for name in NAMEABLE_MOTIFS if name in detect_motifs(passed, threat)
        ]
        what = f"a {found[0].replace('_', ' ')}" if found else "a tactic"
        return f"Before the move, {side} was threatening {san}, {what}."
    return f"Before the move, {side} was threatening {san}, which would gain a lot."


def _loose_pieces(move: Move) -> list[str]:
    """The mover's pieces the move left where the exchange count says they
    are lost: 'the bishop on e6 (the pawn on f7 takes it)'."""
    after = chess.Board(move.fen_after)
    if after.is_game_over():
        return []
    mover = not after.turn
    loose = []
    for square in chess.SquareSet(after.occupied_co[mover]):
        if after.piece_type_at(square) == chess.KING:
            continue
        attackers = list(after.attackers(after.turn, square))
        if not attackers:
            continue
        cheapest = min(attackers, key=lambda sq: after.piece_type_at(sq))
        if static_exchange(after, cheapest, square) >= 1:
            loose.append(
                f"{_describe(after, square)} ({_describe(after, cheapest)} takes it)"
            )
    return loose


def _wins_material(board: chess.Board, move: chess.Move) -> bool:
    return board.is_capture(move) and (
        static_exchange(board, move.from_square, move.to_square) >= 1
    )


def build_prompt(move: Move, opponent_best_uci: str | None) -> str:
    """The user turn: the facts of one analyzed move, in words. No FEN — the
    position goes in as piece lists, both lines in move notation, and every
    claim the coach might want to make (the threat, the loose pieces, the
    tactics and which move carries them) is worked out here rather than left
    for the model to read off a board it may misread."""
    board = chess.Board(move.fen_before)
    after = chess.Board(move.fen_after)
    mover_is_white = board.turn == chess.WHITE
    side = "White" if mover_is_white else "Black"
    number = f"{board.fullmove_number}{'.' if mover_is_white else '...'}"
    lines = [
        f"{side} to move. Pieces before the move:",
        f"- White: {_piece_list(board, chess.WHITE)}",
        f"- Black: {_piece_list(board, chess.BLACK)}",
        f"{side} played {number} {move.san}.",
    ]
    if move.classification:
        lines.append(f"Engine classification: {move.classification}")
    if move.eval_before is not None and move.eval_after is not None:
        before = _win_chances(move.eval_before, move.mate_before, mover_is_white)
        after_chances = _win_chances(move.eval_after, move.mate_after, mover_is_white)
        lines.append(
            f"{side}'s winning chances went from {before:.0f}% to {after_chances:.0f}%."
        )

    best_san = _san(move.fen_before, move.best_move)
    if best_san == move.san:
        lines.append("This was the engine's best move.")
    if move.best_line or best_san:
        best_ucis = move.best_line.split() if move.best_line else [move.best_move]
        lines.append(f"The engine's line: {_line_san(move.fen_before, best_ucis)}")
    played = board.parse_san(move.san).uci()
    reply_ucis = (
        move.reply_line.split()
        if move.reply_line
        else ([opponent_best_uci] if opponent_best_uci else [])
    )
    if reply_ucis and best_san != move.san:
        lines.append(
            f"After the move played: {_line_san(move.fen_before, [played, *reply_ucis])}"
        )

    threat = _threat_fact(move)
    if threat:
        lines.append(threat)
    loose = _loose_pieces(move)
    if loose:
        lines.append(f"After {move.san}, these can be taken: {'; '.join(loose)}.")
    if move.mistake_cause in CAUSE_WORDS:
        lines.append(f"What went wrong: {CAUSE_WORDS[move.mistake_cause]}")

    # Tactics, each with the move that carries it — a bare list of tag names
    # left the model to guess whose tactic it was, and to invent one if the
    # tag was wrong.
    best = chess.Move.from_uci(move.best_move) if best_san else None
    if best is not None:
        if _wins_material(board, best):
            lines.append(
                f"The engine's move {best_san} wins material: it takes "
                f"{_describe(board, best.to_square)}."
            )
        found = [n for n in NAMEABLE_MOTIFS if n in detect_motifs(board, best)]
        if found:
            names = ", ".join(name.replace("_", " ") for name in found)
            lines.append(f"Tactics in the engine's move {best_san}: {names}.")
    reply_san = _san(move.fen_after, opponent_best_uci)
    if reply_san and not after.is_game_over():
        reply = chess.Move.from_uci(opponent_best_uci)
        if _wins_material(after, reply):
            lines.append(
                f"The opponent's reply {reply_san} wins material: it takes "
                f"{_describe(after, reply.to_square)}."
            )
        found = [n for n in NAMEABLE_MOTIFS if n in detect_motifs(after, reply)]
        if found:
            names = ", ".join(name.replace("_", " ") for name in found)
            lines.append(f"Tactics in the opponent's reply {reply_san}: {names}.")
    return "\n".join(lines)


# "the knight on d2", "knight on d2", "Knight on d2"
_PIECE_ON_SQUARE = re.compile(
    r"\b(king|queen|rook|bishop|knight|pawn)s?\s+on\s+([a-h][1-8])\b", re.IGNORECASE
)


def _positions(move: Move, opponent_best_uci: str | None) -> list[chess.Board]:
    """Every position the explanation may talk about: before and after the
    move, and along both lines."""
    boards = [chess.Board(move.fen_before), chess.Board(move.fen_after)]
    for start, ucis in (
        (move.fen_before, (move.best_line or move.best_move or "").split()),
        (
            move.fen_after,
            (move.reply_line or opponent_best_uci or "").split(),
        ),
    ):
        board = chess.Board(start)
        for uci in ucis:
            try:
                step = chess.Move.from_uci(uci)
            except ValueError:
                break
            if step not in board.legal_moves:
                break
            board.push(step)
            boards.append(board.copy(stack=False))
    return boards


def misplaced_pieces(text: str, move: Move, opponent_best_uci: str | None) -> list[str]:
    """Pieces the text puts on a square where no position it may talk about
    has one: 'the knight on e4' when no knight ever stands there. Any of
    these means the model invented part of the board, and the text is not
    shown — a wrong square taught as fact is worse than no explanation."""
    names = {name: piece_type for piece_type, name in _PIECE_NAMES.items()}
    boards = _positions(move, opponent_best_uci)
    wrong = []
    for match in _PIECE_ON_SQUARE.finditer(text):
        piece_type = names[match.group(1).lower()]
        square = chess.parse_square(match.group(2).lower())
        if not any(board.piece_type_at(square) == piece_type for board in boards):
            wrong.append(match.group(0))
    return wrong


def _request_explanation(prompt: str) -> str:
    """The seam the tests mock (never hit the real API from the automated
    suite); the call itself lives in app.llm, shared with summaries.py."""
    return request_text(SYSTEM_PROMPT, prompt)


def generate_explanations_for_game(game: Game) -> int:
    """Generate the missing explanations for a game's flagged moves; returns
    how many were created. Idempotent — a move with a stored row is never
    re-sent. Runs after tagging (the gate reads motif_tags).

    Never raises: the first API failure logs and abandons the rest of the
    game (the remaining calls would hit the same wall), so the analysis job
    still marks the game complete.
    """
    if not explanations_enabled():
        return 0
    generated = 0
    # Move N+1's stored best_move is the opponent's best reply to move N —
    # same convention as the tagger.
    for move, reply in itertools.zip_longest(game.moves, game.moves[1:]):
        if move.explanation is not None or not needs_explanation(move):
            continue
        prompt = build_prompt(move, reply.best_move if reply else None)
        try:
            text = _request_explanation(prompt)
        except Exception:
            logger.exception(
                "explanation generation failed (game %s, ply %s); "
                "skipping the game's remaining moves",
                game.id,
                move.ply,
            )
            break
        if not text:
            continue
        wrong = misplaced_pieces(text, move, reply.best_move if reply else None)
        if wrong:
            logger.warning(
                "explanation rejected (game %s, ply %s): it names %s, which no "
                "position along the lines has",
                game.id,
                move.ply,
                ", ".join(wrong),
            )
            continue
        move.explanation = Explanation(text=text, model=MODEL)
        generated += 1
    return generated
