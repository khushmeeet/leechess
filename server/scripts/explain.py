"""Backfill LLM "why" explanations for already-analyzed games — Phase 5.

The analysis job generates explanations for new games; this covers games
analyzed before Phase 5 (or during an API outage). Needs Anthropic
credentials in the environment (ANTHROPIC_API_KEY or an `ant auth login`
profile) — without them each game logs one failure and is skipped.

    cd server && uv run python scripts/explain.py
"""

from sqlalchemy import select

from app.db import SessionLocal
from app.explanations import generate_explanations_for_game
from app.models import Game


def main() -> None:
    db = SessionLocal()
    try:
        games = list(db.scalars(select(Game).where(Game.analysis_status == "complete")))
        total = 0
        for game in games:
            generated = generate_explanations_for_game(game)
            db.commit()  # per game — LLM calls are slow and paid, keep what landed
            if generated:
                print(f"game {game.id}: {generated} explanation(s) generated")
            total += generated
        print(f"checked {len(games)} analyzed game(s), generated {total}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
