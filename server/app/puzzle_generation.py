"""Personal puzzles from a game's flagged moves (Phase 3).

Like the motif tagger this is pure python-chess over columns the analysis
job already stored (FENs, best moves, classifications) — no engine calls,
re-runnable over old games (scripts/retag.py backfills).

Each flagged move yields at most one puzzle:
- missed tactic: the engine's best move from the position the player faced
  executes a motif → drill that position, solution = the missed move
- otherwise, allowed tactic: the opponent's best reply to the played move
  executes a motif → drill the position after the mistake, solution = the
  punishing reply (how Lichess sources its own puzzles from games)
"""

import itertools

import chess

from app.models import Game, Move, Puzzle
from app.motifs import FLAGGED_CLASSIFICATIONS, detect_motifs


def puzzle_for_move(move: Move, opponent_best_uci: str | None) -> Puzzle | None:
    if move.classification not in FLAGGED_CLASSIFICATIONS or not move.best_move:
        return None

    board = chess.Board(move.fen_before)
    missed = detect_motifs(board, chess.Move.from_uci(move.best_move))
    if missed:
        return Puzzle(
            fen=move.fen_before, solution=move.best_move, motif=sorted(missed)[0]
        )

    if opponent_best_uci:
        after = chess.Board(move.fen_after)
        if not after.is_game_over():
            allowed = detect_motifs(after, chess.Move.from_uci(opponent_best_uci))
            if allowed:
                return Puzzle(
                    fen=move.fen_after,
                    solution=opponent_best_uci,
                    motif=sorted(allowed)[0],
                )
    return None


def create_puzzles_for_game(game: Game) -> list[Puzzle]:
    """Create the missing puzzle rows for an analyzed game's flagged moves.
    Idempotent: moves that already have a puzzle are skipped, so re-runs
    (practice endpoint, backfill script) never duplicate. As in the tagger,
    move N+1's stored best_move is the best reply to move N."""
    created: list[Puzzle] = []
    for move, reply in itertools.zip_longest(game.moves, game.moves[1:]):
        if move.puzzles:
            continue
        puzzle = puzzle_for_move(move, reply.best_move if reply else None)
        if puzzle is not None:
            move.puzzles.append(puzzle)
            created.append(puzzle)
    return created
