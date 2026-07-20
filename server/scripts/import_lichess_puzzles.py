"""Manual import of the Lichess puzzle dump into the generic pool.

Normally unnecessary: the server seeds itself on first startup when
LEECHESS_AUTO_SEED=on, or on POST /puzzles/seed (see app/seeding.py).
This script is the offline path — a dump already on disk, no network:

    cd server
    curl -LO https://database.lichess.org/lichess_db_puzzle.csv.zst
    zstd -d lichess_db_puzzle.csv.zst
    uv run python scripts/import_lichess_puzzles.py lichess_db_puzzle.csv

Safe to re-run: already-imported positions are skipped (dedup by FEN) and
each motif is only topped up to the cap.
"""

import argparse

from app.db import SessionLocal
from app.lichess_import import import_csv


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", help="decompressed lichess_db_puzzle.csv")
    parser.add_argument(
        "--max-per-motif",
        type=int,
        default=500,
        help="cap per motif so the drill pool stays bounded (default 500)",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        counts = import_csv(args.csv, db, max_per_motif=args.max_per_motif)
        for motif, count in sorted(counts.items()):
            print(f"{motif}: {count}")
        print(f"imported {sum(counts.values())} generic puzzle(s)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
