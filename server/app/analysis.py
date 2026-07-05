"""Post-game batch analysis: native Stockfish evals + move classification.

Classification thresholds live here and are mirrored in the client
(client/src/lib/classification.ts) so live badges and post-game review
never disagree — keep the two in sync.
"""

import logging
import os
import shutil

import chess
import chess.engine

from app.db import SessionLocal
from app.models import Game

logger = logging.getLogger(__name__)

# Evals are stored in centipawns from white's perspective, clamped so mate
# scores don't blow up delta math (mate-in-N ends up at the clamp).
EVAL_CLAMP_CP = 1000

# Centipawn loss (from the mover's perspective) → classification.
# Upper bounds are exclusive: loss < 10 is "best", 10-24 "good", etc.
CLASSIFICATION_THRESHOLDS: list[tuple[float, str]] = [
    (10, "best"),
    (25, "good"),
    (50, "inaccuracy"),
    (100, "mistake"),
]
BLUNDER = "blunder"

# Patchable in tests so the background job writes to the test database.
session_factory = SessionLocal


def analysis_depth() -> int:
    """Read at call time so tests/e2e can lower it via the environment."""
    return int(os.environ.get("LEECHESS_ANALYSIS_DEPTH", "18"))


def stockfish_binary() -> str | None:
    """Native Stockfish. LEECHESS_STOCKFISH pins an explicit path — PATH
    lookup can be shadowed (e.g. the npm `stockfish` package's JS stub in
    node_modules/.bin when spawned from a JS toolchain)."""
    return os.environ.get("LEECHESS_STOCKFISH") or shutil.which("stockfish")


def clamp_eval(cp: float) -> float:
    return max(-EVAL_CLAMP_CP, min(EVAL_CLAMP_CP, cp))


def classify_move(
    eval_before: float,
    eval_after: float,
    mover_is_white: bool,
    played_is_best: bool = False,
) -> str:
    """Map the eval swing of one move to a classification label.

    Evals are centipawns from white's perspective; the loss is computed from
    the mover's side. The engine's own best move always classifies as "best"
    even if its eval wobbles slightly between the two searches.
    """
    if played_is_best:
        return "best"
    loss = (eval_before - eval_after) if mover_is_white else (eval_after - eval_before)
    loss = max(0.0, loss)
    for upper_bound, label in CLASSIFICATION_THRESHOLDS:
        if loss < upper_bound:
            return label
    return BLUNDER


def _score_cp(info: chess.engine.InfoDict) -> float:
    score = info["score"].white()
    return clamp_eval(score.score(mate_score=100_000))


def _terminal_eval(board: chess.Board) -> float:
    """Eval for a game-over position without asking the engine."""
    if board.is_checkmate():
        return -EVAL_CLAMP_CP if board.turn == chess.WHITE else EVAL_CLAMP_CP
    return 0.0  # stalemate / insufficient material / draw rules


def run_game_analysis(game_id: int) -> None:
    """Background job: evaluate every position of a finished game once and
    derive per-move eval/best_move/classification. Runs with its own DB
    session (the request session is gone by the time this executes)."""
    db = session_factory()
    try:
        game = db.get(Game, game_id)
        if game is None:
            logger.error("analysis job: game %s not found", game_id)
            return
        game.analysis_status = "analyzing"
        db.commit()
        try:
            _analyze(game)
            game.analysis_status = "complete"
        except Exception:
            logger.exception("analysis job failed for game %s", game_id)
            game.analysis_status = "failed"
        db.commit()
    finally:
        db.close()


def _analyze(game: Game) -> None:
    binary = stockfish_binary()
    if binary is None:
        raise RuntimeError("stockfish not in PATH")

    depth = analysis_depth()
    limit = chess.engine.Limit(depth=depth)

    with chess.engine.SimpleEngine.popen_uci(binary) as engine:
        # Each position is searched once: the eval after move i is the eval
        # before move i+1, so walk positions and carry the result forward.
        board = chess.Board(game.moves[0].fen_before)
        info = engine.analyse(board, limit)
        eval_cp = _score_cp(info)
        best = info["pv"][0] if info.get("pv") else None

        for move in game.moves:
            board = chess.Board(move.fen_before)
            move.eval_before = eval_cp
            move.best_move = best.uci() if best else None

            played = board.parse_san(move.san)
            after = chess.Board(move.fen_after)
            if after.is_game_over():
                next_eval, next_best = _terminal_eval(after), None
            else:
                info = engine.analyse(after, limit)
                next_eval, next_best = (
                    _score_cp(info),
                    info["pv"][0] if info.get("pv") else None,
                )

            move.eval_after = next_eval
            move.classification = classify_move(
                eval_before=move.eval_before,
                eval_after=move.eval_after,
                mover_is_white=board.turn == chess.WHITE,
                played_is_best=best is not None and played == best,
            )
            eval_cp, best = next_eval, next_best
