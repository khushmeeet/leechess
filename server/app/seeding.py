"""Self-seeding of the generic puzzle pool.

Until the Lichess dump is imported, /puzzles only ever serves personal
puzzles — so instead of a manual step, the server seeds itself: the dump is
streamed straight off the network (HTTP → zstd → CSV → `import_rows`),
nothing touches disk, and the download aborts as soon as every motif hits
its cap. Two triggers, both running in the background:

- first startup: when LEECHESS_AUTO_SEED=on (set in fly.toml; off by
  default so dev servers and test runs never surprise-download ~250MB)
  and the generic pool is empty
- POST /puzzles/seed at any time — also the way to resume a partially
  seeded pool, since imports commit in batches and re-runs dedup by FEN
  and only top motifs up to their caps

State is in-memory (single process, single user): GET /puzzles/seed reports
it, and a run interrupted by a restart simply shows as idle again.
"""

import csv
import logging
import os
import threading
import urllib.request
from compression import zstd
from dataclasses import dataclass, replace
from typing import Iterator

from sqlalchemy import select

from app.db import SessionLocal
from app.lichess_import import THEME_TO_MOTIF, generic_pool_counts, import_rows
from app.models import Puzzle

logger = logging.getLogger(__name__)

DUMP_URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst"
MAX_PER_MOTIF = 500  # same default the manual import script uses

session_factory = SessionLocal


@dataclass
class SeedStatus:
    state: str = "idle"  # idle | running | complete | failed
    scanned: int = 0  # dump rows read so far
    imported: int = 0  # puzzles added this run
    error: str | None = None


_status = SeedStatus()
_lock = threading.Lock()


def status() -> SeedStatus:
    with _lock:
        return replace(_status)


def begin() -> bool:
    """Claim the single seeding slot (there is no point in two concurrent
    streams of the same dump); False when a run is already active. The
    claimant must follow up with run_seed(), which releases the slot by
    moving the state to complete/failed."""
    global _status
    with _lock:
        if _status.state == "running":
            return False
        _status = SeedStatus(state="running")
        return True


def _dump_rows(url: str) -> Iterator[dict[str, str]]:
    """CSV rows decompressed on the fly from the (zstd) dump at `url`.
    urllib streams the body, so closing early abandons the download."""
    with urllib.request.urlopen(url) as response:
        with zstd.open(response, "rt", encoding="utf-8", newline="") as text:
            yield from csv.DictReader(text)


def run_seed(url: str | None = None) -> None:
    """The claimed background run — call begin() first. Never raises; the
    outcome (and any error) lands in the status for GET /puzzles/seed."""
    url = url or os.environ.get("LEECHESS_SEED_URL", DUMP_URL)
    db = session_factory()
    try:
        pool = generic_pool_counts(db)
        if all(pool.get(m, 0) >= MAX_PER_MOTIF for m in set(THEME_TO_MOTIF.values())):
            _finish(state="complete")  # already full — skip the download
            return

        def on_progress(scanned: int, imported: int) -> None:
            with _lock:
                _status.scanned, _status.imported = scanned, imported

        logger.info("seeding generic puzzle pool from %s", url)
        counts = import_rows(
            _dump_rows(url), db, max_per_motif=MAX_PER_MOTIF, on_progress=on_progress
        )
        _finish(state="complete", imported=sum(counts.values()))
        logger.info("seeded %d generic puzzle(s): %s", sum(counts.values()), counts)
    except Exception as exc:
        logger.exception("seeding the generic puzzle pool failed")
        _finish(state="failed", error=str(exc))
    finally:
        db.close()


def _finish(state: str, imported: int | None = None, error: str | None = None) -> None:
    with _lock:
        _status.state = state
        _status.error = error
        if imported is not None:
            _status.imported = imported


def maybe_autoseed() -> bool:
    """Startup hook: kick off a background seed when LEECHESS_AUTO_SEED=on
    and the generic pool is completely empty. A partial pool (crashed run)
    is left alone — resume explicitly via POST /puzzles/seed rather than
    re-streaming the dump on every restart."""
    if os.environ.get("LEECHESS_AUTO_SEED", "off") != "on":
        return False
    db = session_factory()
    try:
        empty = (
            db.scalars(
                select(Puzzle.id).where(Puzzle.source_move_id.is_(None)).limit(1)
            ).first()
            is None
        )
    finally:
        db.close()
    if not empty or not begin():
        return False
    threading.Thread(target=run_seed, name="puzzle-pool-seed", daemon=True).start()
    return True
