"""Re-grade and re-run rule-based motif tagging over every analyzed game —
no Stockfish.

Use after changing the grading rule (shared/classification.json) or refining
detection rules in app/motifs.py or the mistake causes in app/mistakes.py.
Grading runs first, since which moves get tagged and given a cause depends on
it. Also backfills the personal puzzle queue (Phase 3):
puzzles derive from the same stored analysis, and moves that already have one
are skipped.

    cd server && PYTHONPATH=. uv run python scripts/retag.py
"""

from sqlalchemy import select

from app.analysis import regrade_game
# Registers the users table the owner foreign keys point at; without it the
# first flush that touches a puzzle or tag row can't resolve them.
from app.auth import models as auth_models  # noqa: F401
from app.db import SessionLocal
from app.mistakes import apply_mistake_causes
from app.models import Game
from app.motifs import apply_rule_based_tags
from app.puzzle_generation import create_puzzles_for_game


def main() -> None:
    db = SessionLocal()
    try:
        games = list(db.scalars(select(Game).where(Game.analysis_status == "complete")))
        for game in games:
            regrade_game(game)
            apply_rule_based_tags(game)
            apply_mistake_causes(game)
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
