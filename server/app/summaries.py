"""LLM post-game coach summary — three takeaways per analyzed game.

The game-level companion to the per-move "why" texts in explanations.py,
with the same cost-control pattern: one CoachSummary row per game, written
once by the analysis job and never regenerated; any API problem is logged
and the analysis still completes (scripts/explain.py backfills later). The
digest sent to Claude is data the job already stored — classifications,
motif tags, and the phase centipawn losses — no extra engine work.

LEECHESS_EXPLANATIONS=off disables this pass too: the one switch turns off
every paid LLM call (both automated suites set it).
"""

import logging

from app.cpl import aggregate_cpl, player_moves as _player_moves
from app.explanations import _san, explanations_enabled, needs_explanation
from app.llm import MODEL, request_text
from app.models import CoachSummary, Game, Move

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a chess coach writing for an improving club player rated around "
    "1400. You are given the engine-analysis digest of one completed game of "
    "theirs. Write exactly three takeaways worth remembering from this game — "
    "lessons, not a move-by-move recap. Stay grounded in the digest: refer to "
    "the concrete moves and tactical motifs it lists, and if the per-phase "
    "figures show a clearly weakest phase, make that one of the takeaways. "
    "Plain language: no headings, no variation dumps, no engine jargon like "
    "'centipawns'. Address the player as 'you'. Format: three numbered lines "
    "(1., 2., 3.), each one or two sentences."
)


def _numbered(move: Move) -> str:
    """SAN with its move number as PGN prints it: "3. Qxe5+" / "3... Nxe5"."""
    return f"{(move.ply + 1) // 2}{'.' if move.ply % 2 else '...'} {move.san}"


def _pawns_lost_line(player_moves: list[Move]) -> str | None:
    """Average pawns lost per move, overall and per phase — the progress CPL
    trend's numbers, in the explanation prompts' plain "pawns" units. None
    when any eval is missing."""
    agg = aggregate_cpl(player_moves)
    if agg is None:
        return None
    segments = ", ".join(
        f"{name} {cpl / 100:.1f}"
        for name, cpl in [
            ("opening", agg.opening_cpl),
            ("middlegame", agg.middlegame_cpl),
            ("endgame", agg.endgame_cpl),
        ]
        if cpl is not None
    )
    return f"Average pawns lost per move: {agg.avg_cpl / 100:.1f} overall ({segments})."


def build_summary_prompt(game: Game) -> str:
    """The user turn: a factual digest of the analyzed game, evals expressed
    as plain "pawns lost" figures like the explanation prompts."""
    player_moves = _player_moves(game)
    lines = [
        f"Result: {game.result}"
        + (
            f" — you played {(game.user_color or 'white').capitalize()} against the engine."
            if game.mode == "engine"
            else " — local game, both sides played by hand; every move counts as yours."
        )
    ]

    counts: dict[str, int] = {}
    for move in player_moves:
        if move.classification:
            counts[move.classification] = counts.get(move.classification, 0) + 1
    readable = ", ".join(
        f"{counts[label]} {label}"
        for label in ["best", "good", "inaccuracy", "mistake", "blunder"]
        if label in counts
    )
    lines.append(f"Your {len(player_moves)} moves: {readable}.")

    pawns_lost = _pawns_lost_line(player_moves)
    if pawns_lost is not None:
        lines.append(pawns_lost)

    flagged = [move for move in player_moves if needs_explanation(move)]
    if flagged:
        lines.append("Flagged moves:")
    for move in flagged:
        bits = [f"- {_numbered(move)} — {move.classification}"]
        best_san = _san(move.fen_before, move.best_move)
        if best_san == move.san:
            bits[0] += " (the engine's own choice)"
        elif best_san:
            bits.append(f"engine preferred {best_san}")
        if move.motifs:
            humanized = ", ".join(name.replace("_", " ") for name in move.motifs)
            bits.append(f"motifs: {humanized}")
        lines.append("; ".join(bits))

    return "\n".join(lines)


def _request_summary(prompt: str) -> str:
    """The seam the tests mock (never hit the real API from the automated
    suite); the call itself lives in app.llm, shared with explanations.py."""
    return request_text(SYSTEM_PROMPT, prompt)


def generate_summary_for_game(game: Game) -> bool:
    """Generate the game's missing coach summary; returns whether a row was
    created. Idempotent — a game with a stored row is never re-sent — and
    fail-soft: never raises. Runs after analysis and tagging (the digest
    reads classifications and motif_tags)."""
    if not explanations_enabled():
        return False
    if game.summary is not None:
        return False
    if not game.moves or any(move.classification is None for move in game.moves):
        return False  # the digest needs a fully analyzed game
    try:
        text = _request_summary(build_summary_prompt(game))
    except Exception:
        logger.exception("coach summary generation failed (game %s)", game.id)
        return False
    if not text:
        return False
    game.summary = CoachSummary(text=text, model=MODEL)
    return True
