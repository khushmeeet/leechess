"""Backfill the LLM texts for already-analyzed games — the per-move "why"
explanations (Phase 5) and the post-game coach summary.

The analysis job generates both for new games; this covers games analyzed
before those passes existed (or during an API outage). Needs Anthropic
credentials in the environment (ANTHROPIC_API_KEY or an `ant auth login`
profile) — without them each game logs one failure and is skipped.

    cd server && uv run python scripts/explain.py
"""

from sqlalchemy import select

from app.db import SessionLocal
from app.explanations import generate_explanations_for_game
from app.models import Game
from app.summaries import generate_summary_for_game


def main() -> None:
    db = SessionLocal()
    try:
        games = list(db.scalars(select(Game).where(Game.analysis_status == "complete")))
        total = 0
        summaries = 0
        for game in games:
            generated = generate_explanations_for_game(game)
            summarized = generate_summary_for_game(game)
            db.commit()  # per game — LLM calls are slow and paid, keep what landed
            if generated or summarized:
                parts = [f"{generated} explanation(s)"]
                if summarized:
                    parts.append("coach summary")
                print(f"game {game.id}: generated {' + '.join(parts)}")
            total += generated
            summaries += summarized
        print(
            f"checked {len(games)} analyzed game(s), generated "
            f"{total} explanation(s) and {summaries} summary(ies)"
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
