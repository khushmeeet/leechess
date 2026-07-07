"""Re-run rule-based motif tagging over every analyzed game — no Stockfish.

Use after refining detection rules in app/motifs.py. Also backfills the
personal puzzle queue (Phase 3): puzzles derive from the same stored
analysis, and moves that already have one are skipped.

    cd server && uv run python scripts/retag.py
"""

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Game
from app.motifs import apply_rule_based_tags
from app.puzzle_generation import create_puzzles_for_game


def main() -> None:
    db = SessionLocal()
    try:
        games = list(db.scalars(select(Game).where(Game.analysis_status == "complete")))
        for game in games:
            apply_rule_based_tags(game)
            new_puzzles = create_puzzles_for_game(game)
            tagged = sum(1 for move in game.moves if move.motif_tags)
            print(
                f"game {game.id}: {tagged}/{len(game.moves)} moves tagged, "
                f"{len(new_puzzles)} new puzzle(s)"
            )
        db.commit()
        print(f"retagged {len(games)} analyzed game(s)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
