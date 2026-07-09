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

import chess

from app.models import Explanation, Game, Move

logger = logging.getLogger(__name__)

MODEL = "claude-opus-4-8"
# The answer is 2-4 sentences, but adaptive thinking spends from the same
# budget — leave it room rather than truncating mid-thought.
MAX_TOKENS = 8000

EXPLAINABLE_CLASSIFICATIONS = {"mistake", "blunder"}

SYSTEM_PROMPT = (
    "You are a chess coach writing for an improving club player rated around "
    "1400. Given one analyzed move from their game, explain in plain language "
    "why the engine's best move works and why the played move falls short — "
    "name the concrete pieces, squares, and threats involved. If the played "
    "move IS the best move, explain why it works instead. Write 2-4 "
    "sentences of flowing prose: no headings, no lists, no variation dumps, "
    "no engine jargon like 'centipawns'. Address the player as 'you'."
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


def build_prompt(move: Move, opponent_best_uci: str | None) -> str:
    """The user turn: just the facts of one analyzed move. The stored best
    line is its first move; evals become a plain "pawns lost" figure."""
    board = chess.Board(move.fen_before)
    mover_is_white = board.turn == chess.WHITE
    lines = [
        f"Position (FEN): {move.fen_before}",
        f"{'White' if mover_is_white else 'Black'} played: {move.san}",
    ]
    if move.classification:
        lines.append(f"Engine classification: {move.classification}")
    if move.eval_before is not None and move.eval_after is not None:
        loss = (
            move.eval_before - move.eval_after
            if mover_is_white
            else move.eval_after - move.eval_before
        )
        lines.append(f"The move lost about {max(0.0, loss) / 100:.1f} pawns.")
    best_san = _san(move.fen_before, move.best_move)
    if best_san:
        if best_san == move.san:
            lines.append("This was the engine's best move.")
        else:
            lines.append(f"Engine's best move was: {best_san}")
    reply_san = _san(move.fen_after, opponent_best_uci)
    if reply_san:
        lines.append(f"Opponent's strongest reply to the played move: {reply_san}")
    if move.motifs:
        humanized = ", ".join(name.replace("_", " ") for name in move.motifs)
        lines.append(f"Tactical motifs involved: {humanized}")
    return "\n".join(lines)


def _request_explanation(prompt: str) -> str:
    """One Claude call — the seam the tests mock (never hit the real API
    from the automated suite). Credentials resolve from the environment
    (ANTHROPIC_API_KEY or an `ant auth login` profile)."""
    import anthropic

    client = anthropic.Anthropic()
    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        thinking={"type": "adaptive"},
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )
    return "\n\n".join(
        block.text for block in response.content if block.type == "text"
    ).strip()


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
        if text:
            move.explanation = Explanation(text=text, model=MODEL)
            generated += 1
    return generated
