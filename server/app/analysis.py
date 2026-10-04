"""Post-game batch analysis: native Stockfish evals + move classification.

Classification constants load from shared/classification.json — the single
source the client bundles too (client/src/lib/classification.ts), so live
badges and post-game review never disagree.
"""

import json
import logging
import math
import os
import shutil
import threading
from dataclasses import dataclass
from pathlib import Path

import chess
import chess.engine
from sqlalchemy import select

from app.db import SessionLocal
from app.explanations import generate_explanations_for_game
from app.models import Game, Move
from app.motifs import apply_rule_based_tags
from app.openings import in_book
from app.puzzle_generation import create_puzzles_for_game
from app.summaries import generate_summary_for_game
from app.threats import THREAT_DEPTH, search_threat

logger = logging.getLogger(__name__)


def _shared_classification() -> dict:
    """shared/classification.json sits at the repo root locally and under
    /app in the Docker image — walk upward so both layouts resolve."""
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "shared" / "classification.json"
        if candidate.is_file():
            return json.loads(candidate.read_text())
    raise FileNotFoundError("shared/classification.json not found above " + __file__)


_shared = _shared_classification()

# Evals are stored in centipawns from white's perspective, clamped so mate
# scores don't blow up the arithmetic; a forced mate is stored beside them
# (mate_before/mate_after) so grading can still tell one apart.
EVAL_CLAMP_CP: int = _shared["evalClampCp"]

# Moves are graded by the drop in the mover's winning chances (win% points).
# Upper bounds are exclusive: a drop < 1 is "best", 1-2.5 "good", etc.
WIN_PERCENT_K: float = _shared["winPercentK"]
CLASSIFICATION_THRESHOLDS: list[tuple[float, str]] = [
    (bound, label) for bound, label in _shared["thresholds"]
]
BLUNDER: str = _shared["blunder"]
MATE_INACCURACY_ABOVE: int = _shared["mate"]["inaccuracyAboveCp"]
MATE_MISTAKE_ABOVE: int = _shared["mate"]["mistakeAboveCp"]
BOOK = "book"

# Patchable in tests so the background job writes to the test database.
session_factory = SessionLocal

# One Stockfish process per job at full depth saturates the small Fly VM, so
# engine jobs queue behind this instead of running unbounded (BackgroundTasks
# runs sync functions in a threadpool with no limit of its own).
ANALYSIS_CONCURRENCY = int(os.environ.get("LEECHESS_ANALYSIS_CONCURRENCY", "1"))
_engine_slots = threading.BoundedSemaphore(ANALYSIS_CONCURRENCY)


def analysis_depth() -> int:
    """Read at call time so tests/e2e can lower it via the environment."""
    return int(os.environ.get("LEECHESS_ANALYSIS_DEPTH", "18"))


def threat_depth() -> int:
    """Never deeper than the main analysis — the suites lower that to keep
    engine tests fast, and the threat search should follow."""
    return min(THREAT_DEPTH, analysis_depth())


def stockfish_binary() -> str | None:
    """Native Stockfish. LEECHESS_STOCKFISH pins an explicit path — PATH
    lookup can be shadowed (e.g. the npm `stockfish` package's JS stub in
    node_modules/.bin when spawned from a JS toolchain)."""
    return os.environ.get("LEECHESS_STOCKFISH") or shutil.which("stockfish")


def clamp_eval(cp: float) -> float:
    return max(-EVAL_CLAMP_CP, min(EVAL_CLAMP_CP, cp))


def win_percent(cp: float) -> float:
    """Winning chances in percent (0-100) for the side a positive eval
    favours — Lichess's fit to real games, on the clamped eval."""
    return 100 / (1 + math.exp(-WIN_PERCENT_K * clamp_eval(cp)))


@dataclass(frozen=True)
class _MoverView:
    cp: float
    # (mate is for the mover, moves to mate), or None without a forced mate
    mate: tuple[bool, int] | None


def _mover_view(cp: float, mate: int | None, mover_is_white: bool) -> _MoverView:
    """One side's view of a stored eval. Mate 0 is a mate on the board; the
    clamped centipawns say who delivered it."""
    sign = 1 if mover_is_white else -1
    cp = clamp_eval(cp) * sign
    if mate is None:
        return _MoverView(cp, None)
    for_mover = cp > 0 if mate == 0 else mate * sign > 0
    return _MoverView(cp, (for_mover, abs(mate)))


def _by_threshold(drop: float) -> str:
    for upper_bound, label in CLASSIFICATION_THRESHOLDS:
        if drop < upper_bound:
            return label
    return BLUNDER


def _grade(was: _MoverView, now: _MoverView) -> str:
    if was.mate and now.mate and was.mate[0] and now.mate[0]:
        # still mating: on track if the mate got closer, a detour otherwise
        return "best" if now.mate[1] < was.mate[1] else "good"
    if was.mate and now.mate and not was.mate[0] and not now.mate[0]:
        # already being mated: only hastening it costs anything
        return "inaccuracy" if now.mate[1] < was.mate[1] else "best"
    if was.mate and was.mate[0]:
        # a forced mate thrown away — how bad depends on what is left
        if now.cp > MATE_INACCURACY_ABOVE:
            return "inaccuracy"
        if now.cp > MATE_MISTAKE_ABOVE:
            return "mistake"
        return BLUNDER
    if now.mate and not now.mate[0]:
        # walked into a forced mate — how bad depends on how lost it was
        if was.cp < -MATE_INACCURACY_ABOVE:
            return "inaccuracy"
        if was.cp < -MATE_MISTAKE_ABOVE:
            return "mistake"
        return BLUNDER
    return _by_threshold(max(0.0, win_percent(was.cp) - win_percent(now.cp)))


def classify_move(
    eval_before: float,
    eval_after: float,
    mover_is_white: bool,
    played_is_best: bool = False,
    *,
    mate_before: int | None = None,
    mate_after: int | None = None,
    in_book: bool = False,
) -> str:
    """Grade one move by the winning chances it gave away.

    Evals are centipawns from white's perspective, with any forced mate
    signed for White beside them. The engine's own best move always grades
    "best" even if its eval wobbles between the two searches; a book move is
    "book" unless it is a blunder (the Fool's Mate is in the book). The
    client's classifyMove is the same rule — shared/classification-cases.json
    runs both.
    """
    if played_is_best:
        label = "best"
    else:
        label = _grade(
            _mover_view(eval_before, mate_before, mover_is_white),
            _mover_view(eval_after, mate_after, mover_is_white),
        )
    if in_book and label != BLUNDER:
        return BOOK
    return label


def regrade_game(game: Game) -> None:
    """Re-grade every analyzed move from its stored evals — no engine, so it
    can re-run whenever the grading rule changes (scripts/retag.py). A game
    analyzed before mates were stored grades on its clamped evals alone."""
    for move in game.moves:
        if move.eval_before is None or move.eval_after is None:
            continue
        board = chess.Board(move.fen_before)
        played = board.parse_san(move.san)
        move.classification = classify_move(
            eval_before=move.eval_before,
            eval_after=move.eval_after,
            mover_is_white=board.turn == chess.WHITE,
            played_is_best=move.best_move is not None
            and played == chess.Move.from_uci(move.best_move),
            mate_before=move.mate_before,
            mate_after=move.mate_after,
            in_book=in_book(move.fen_after),
        )


def _score(info: chess.engine.InfoDict) -> tuple[float, int | None]:
    """Clamped centipawns and the forced mate, if any, both white's POV."""
    score = info["score"].white()
    return clamp_eval(score.score(mate_score=100_000)), score.mate()


def record_threat(engine: chess.engine.SimpleEngine, move: Move, depth: int) -> None:
    """Store the null-move threat search for the position before `move`."""
    found = search_threat(engine, chess.Board(move.fen_before), depth)
    move.threat_move = found.move if found else None
    move.threat_cp = clamp_eval(found.cp) if found and found.cp is not None else None
    move.threat_mate = found.mate if found else None


def _terminal_eval(board: chess.Board) -> tuple[float, int | None]:
    """Eval for a game-over position without asking the engine: a mate on
    the board is mate 0 at the clamp, for the side that gave it."""
    if board.is_checkmate():
        return (-EVAL_CLAMP_CP if board.turn == chess.WHITE else EVAL_CLAMP_CP), 0
    return 0.0, None  # stalemate / insufficient material / draw rules


def reset_stale_analyses() -> int:
    """Startup sweep: a game still marked "analyzing" was orphaned by a
    restart — BackgroundTasks die with the process (fly.toml auto-stops the
    machine), so no job will ever finish it. Mark it failed rather than
    leaving the review page spinning forever; returns how many were swept."""
    db = session_factory()
    try:
        stale = list(db.scalars(select(Game).where(Game.analysis_status == "analyzing")))
        for game in stale:
            game.analysis_status = "failed"
        db.commit()
        if stale:
            logger.warning(
                "reset %d orphaned analyzing game(s) to failed: %s",
                len(stale),
                [game.id for game in stale],
            )
        return len(stale)
    finally:
        db.close()


def run_game_analysis(game_id: int) -> None:
    """Background job: evaluate every position of a finished game once and
    derive per-move eval/best_move/classification. Runs with its own DB
    session (the request session is gone by the time this executes).
    Serialized through the engine semaphore — the row stays "analyzing"
    (set by the /complete route) while queued."""
    with _engine_slots:
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
                apply_rule_based_tags(game)
                create_puzzles_for_game(game)
                generate_explanations_for_game(game)  # fail-soft, never raises
                generate_summary_for_game(game)  # fail-soft, never raises
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
    threats_at = threat_depth()

    with chess.engine.SimpleEngine.popen_uci(binary) as engine:
        # Each position is searched once: the eval after move i is the eval
        # before move i+1, so walk positions and carry the result forward.
        board = chess.Board(game.moves[0].fen_before)
        info = engine.analyse(board, limit)
        eval_cp, mate = _score(info)
        best = info["pv"][0] if info.get("pv") else None

        for move in game.moves:
            board = chess.Board(move.fen_before)
            move.eval_before, move.mate_before = eval_cp, mate
            move.best_move = best.uci() if best else None
            record_threat(engine, move, threats_at)

            played = board.parse_san(move.san)
            after = chess.Board(move.fen_after)
            if after.is_game_over():
                (next_eval, next_mate), next_best = _terminal_eval(after), None
            else:
                info = engine.analyse(after, limit)
                next_eval, next_mate = _score(info)
                next_best = info["pv"][0] if info.get("pv") else None

            move.eval_after, move.mate_after = next_eval, next_mate
            move.classification = classify_move(
                eval_before=move.eval_before,
                eval_after=move.eval_after,
                mover_is_white=board.turn == chess.WHITE,
                played_is_best=best is not None and played == best,
                mate_before=move.mate_before,
                mate_after=move.mate_after,
                in_book=in_book(move.fen_after),
            )
            eval_cp, mate, best = next_eval, next_mate, next_best
