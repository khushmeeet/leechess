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

from app.explanations import _san, explanations_enabled, needs_explanation
from app.llm import MODEL, request_text
from app.models import CoachSummary, Game, Move

# The progress endpoint owns the phase boundaries — importing them beats a
# third copy of those plies (the client CPL graph mirrors them already).
from app.routers.progress import MIDDLEGAME_MAX_PLY, OPENING_MAX_PLY

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


def _player_moves(game: Game) -> list[Move]:
    """The student's moves — same rule as the progress CPL: vs the engine you
    play White; local pass-and-play counts both sides."""
    if game.mode == "engine":
        return [move for move in game.moves if move.ply % 2 == 1]
    return list(game.moves)


def _pawns_lost_line(player_moves: list[Move]) -> str | None:
    """Average pawns lost per move, overall and per phase — the same loss and
    phase math as the progress CPL trend, in the explanation prompts' plain
    "pawns" units. None when any eval is missing."""
    losses: list[float] = []
    phases: dict[str, list[float]] = {"opening": [], "middlegame": [], "endgame": []}
    for move in player_moves:
        if move.eval_before is None or move.eval_after is None:
            return None
        is_white = move.ply % 2 == 1
        loss = max(
            0.0,
            move.eval_before - move.eval_after
            if is_white
            else move.eval_after - move.eval_before,
        )
        losses.append(loss)
        if move.ply <= OPENING_MAX_PLY:
            phases["opening"].append(loss)
        elif move.ply <= MIDDLEGAME_MAX_PLY:
            phases["middlegame"].append(loss)
        else:
            phases["endgame"].append(loss)
    if not losses:
        return None
    segments = ", ".join(
        f"{name} {sum(values) / len(values) / 100:.1f}"
        for name, values in phases.items()
        if values
    )
    overall = sum(losses) / len(losses) / 100
    return f"Average pawns lost per move: {overall:.1f} overall ({segments})."


def build_summary_prompt(game: Game) -> str:
    """The user turn: a factual digest of the analyzed game, evals expressed
    as plain "pawns lost" figures like the explanation prompts."""
    player_moves = _player_moves(game)
    lines = [
        f"Result: {game.result}"
        + (
            " — you played White against the engine."
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
