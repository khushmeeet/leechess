"""Self-seeding of the generic puzzle pool, at startup only.

Until the Lichess dump is imported, /puzzles only ever serves personal
puzzles — so instead of a manual step, the server seeds itself on boot:
when LEECHESS_AUTO_SEED=on (set in fly.toml; off by default so dev servers
and test runs never surprise-download ~250MB) and no completed run is
recorded in puzzle_seed_runs, a background thread streams the dump straight
off the network (HTTP → zstd → CSV → `import_rows`) — nothing touches disk,
and the download aborts as soon as every motif hits its cap.

The completion marker, not pool-emptiness, is the gate: imports commit in
batches, so a run killed mid-way (the Fly machine auto-stops) leaves a
partial pool that the next restart resumes — dedup by FEN and per-motif
caps make re-runs cheap. Restarting the app is the only trigger; to force
a re-seed of an already-seeded database, delete the puzzle_seed_runs rows
first. Progress and failures go to the server log.
"""

import csv
import logging
import os
import threading
import urllib.request
from compression import zstd
from typing import Iterator

from sqlalchemy import select

from app.db import SessionLocal
from app.lichess_import import THEME_TO_MOTIF, generic_pool_counts, import_rows
from app.models import PuzzleSeedRun

logger = logging.getLogger(__name__)

DUMP_URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst"
MAX_PER_MOTIF = 500
LOG_EVERY_ROWS = 200_000

session_factory = SessionLocal


def _dump_rows(url: str) -> Iterator[dict[str, str]]:
    """CSV rows decompressed on the fly from the (zstd) dump at `url`.
    urllib streams the body, so closing early abandons the download."""
    with urllib.request.urlopen(url) as response:
        with zstd.open(response, "rt", encoding="utf-8", newline="") as text:
            yield from csv.DictReader(text)


def run_seed(url: str | None = None) -> None:
    """The background run. Never raises: success records a PuzzleSeedRun
    row (which stops future startups from re-seeding); failure just logs,
    keeps whatever batches were committed, and leaves no row so the next
    restart picks the run back up."""
    url = url or os.environ.get("LEECHESS_SEED_URL", DUMP_URL)
    db = session_factory()
    try:
        pool = generic_pool_counts(db)
        imported = 0
        if any(
            pool.get(m, 0) < MAX_PER_MOTIF for m in set(THEME_TO_MOTIF.values())
        ):

            def on_progress(scanned: int, imported: int) -> None:
                if scanned % LOG_EVERY_ROWS == 0:
                    logger.info(
                        "seeding: %d rows scanned, %d puzzles imported",
                        scanned,
                        imported,
                    )

            logger.info("seeding generic puzzle pool from %s", url)
            counts = import_rows(
                _dump_rows(url), db, max_per_motif=MAX_PER_MOTIF, on_progress=on_progress
            )
            imported = sum(counts.values())
            logger.info("seeded %d generic puzzle(s): %s", imported, counts)
        db.add(PuzzleSeedRun(imported=imported))
        db.commit()
    except Exception:
        logger.exception(
            "seeding the generic puzzle pool failed; restart the app to resume"
        )
    finally:
        db.close()


def maybe_autoseed() -> bool:
    """Startup hook: kick off a background seed unless one already ran to
    completion (or LEECHESS_AUTO_SEED isn't on)."""
    if os.environ.get("LEECHESS_AUTO_SEED", "off") != "on":
        return False
    db = session_factory()
    try:
        seeded = db.scalars(select(PuzzleSeedRun.id).limit(1)).first() is not None
    finally:
        db.close()
    if seeded:
        return False
    threading.Thread(target=run_seed, name="puzzle-pool-seed", daemon=True).start()
    return True
