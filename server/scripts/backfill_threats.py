"""Run the null-move threat search over games analyzed before it existed.

Review shows the threat each move had to answer from moves.threat_*, which
the analysis job now fills in. Games analyzed earlier have none on record;
this fills them in with native Stockfish, one shallow search per position,
and commits per game so an interrupted run keeps what it did. Games that
already have threats are skipped, so it is safe to re-run.

    cd server && uv run python scripts/backfill_threats.py
"""

import chess.engine
from sqlalchemy import select

from app.analysis import record_threat, stockfish_binary, threat_depth
from app.db import SessionLocal
from app.models import Game


def needs_threats(game: Game) -> bool:
    """No move has a search on record. A move can legitimately have none
    (its mover was in check), but every move of a game never can."""
    return bool(game.moves) and all(move.threat_move is None for move in game.moves)


def main() -> None:
    binary = stockfish_binary()
    if binary is None:
        raise SystemExit("stockfish not in PATH (or set LEECHESS_STOCKFISH)")
    depth = threat_depth()
    db = SessionLocal()
    try:
        games = [
            game
            for game in db.scalars(select(Game).where(Game.analysis_status == "complete"))
            if needs_threats(game)
        ]
        with chess.engine.SimpleEngine.popen_uci(binary) as engine:
            for game in games:
                for move in game.moves:
                    record_threat(engine, move, depth)
                db.commit()
                found = sum(1 for move in game.moves if move.threat_move is not None)
                print(f"game {game.id}: {found}/{len(game.moves)} positions searched")
        print(f"backfilled {len(games)} game(s)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
