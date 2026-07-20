"""Startup self-seeding of the generic pool — always against a
zstd-compressed copy of the checked-in sample CSV served from a file:// URL,
never the real network dump (the conftest autouse fixture also forces
LEECHESS_AUTO_SEED=off, so app startup inside the suite can never download
anything).

Covers: the full stream→decompress→import pipeline, the puzzle_seed_runs
completion marker (seed once, skip thereafter; failed or interrupted runs
leave no marker so the next startup resumes), the skip-the-download
short-circuit when every motif is already at cap, and the
LEECHESS_AUTO_SEED gating."""

from compression import zstd

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app import seeding
from app.lichess_import import THEME_TO_MOTIF
from app.models import Puzzle, PuzzleSeedRun
from tests.conftest import FIXTURES

pytestmark = pytest.mark.unit

SAMPLE = FIXTURES / "lichess_puzzles_sample.csv"


@pytest.fixture()
def dump_url(tmp_path):
    """file:// URL to a zstd-compressed copy of the sample CSV — exercises
    the exact urlopen → zstd → csv pipeline the real dump goes through."""
    path = tmp_path / "lichess_db_puzzle.csv.zst"
    path.write_bytes(zstd.compress(SAMPLE.read_bytes()))
    return path.as_uri()


@pytest.fixture()
def seed_sessions(db_engine, monkeypatch):
    """Point the seeding job's own sessions at the throwaway database."""
    factory = sessionmaker(bind=db_engine, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(seeding, "session_factory", factory)
    return factory


class _InlineThread:
    """Stands in for threading.Thread so maybe_autoseed's background run
    executes synchronously and assertions see its result."""

    def __init__(self, target, **kwargs):
        self._target = target

    def start(self):
        self._target()


@pytest.fixture()
def autoseed_enabled(dump_url, monkeypatch):
    monkeypatch.setenv("LEECHESS_AUTO_SEED", "on")
    monkeypatch.setenv("LEECHESS_SEED_URL", dump_url)
    monkeypatch.setattr(seeding.threading, "Thread", _InlineThread)


def test_run_seed_streams_the_dump_and_records_completion(
    seed_sessions, dump_url
):
    seeding.run_seed(url=dump_url)

    with seed_sessions() as db:
        puzzles = db.scalars(select(Puzzle)).all()
        run = db.scalars(select(PuzzleSeedRun)).one()
    # what the sample imports, see test_lichess_import.py
    assert len(puzzles) == 4
    assert all(p.source_move_id is None for p in puzzles)
    assert run.imported == 4


def test_failed_run_leaves_no_completion_marker(seed_sessions, tmp_path):
    seeding.run_seed(url=(tmp_path / "missing.csv.zst").as_uri())  # no raise

    with seed_sessions() as db:
        assert db.scalars(select(Puzzle)).all() == []
        assert db.scalars(select(PuzzleSeedRun)).all() == []


def test_full_pool_skips_the_download_but_still_completes(
    seed_sessions, tmp_path, monkeypatch
):
    """Every motif at cap → marker written without ever opening the URL
    (the URL here points at nothing, so touching it would fail the run)."""
    monkeypatch.setattr(seeding, "MAX_PER_MOTIF", 1)
    with seed_sessions() as db:
        for i, motif in enumerate(sorted(set(THEME_TO_MOTIF.values()))):
            db.add(Puzzle(fen=f"fen-{i}", solution="a1a2", motif=motif))
        db.commit()

    seeding.run_seed(url=(tmp_path / "missing.csv.zst").as_uri())
    with seed_sessions() as db:
        assert db.scalars(select(PuzzleSeedRun)).one().imported == 0


def test_autoseed_needs_the_env_flag(seed_sessions, monkeypatch):
    monkeypatch.delenv("LEECHESS_AUTO_SEED", raising=False)
    assert seeding.maybe_autoseed() is False
    monkeypatch.setenv("LEECHESS_AUTO_SEED", "off")
    assert seeding.maybe_autoseed() is False
    with seed_sessions() as db:
        assert db.scalars(select(Puzzle)).all() == []


def test_autoseed_runs_once_then_restarts_skip(seed_sessions, autoseed_enabled):
    assert seeding.maybe_autoseed() is True
    with seed_sessions() as db:
        assert len(db.scalars(select(Puzzle)).all()) == 4

    # simulated restart: the completion marker gates the second boot
    assert seeding.maybe_autoseed() is False


def test_interrupted_run_resumes_on_next_startup(
    seed_sessions, autoseed_enabled, dump_url, monkeypatch, tmp_path
):
    """A crashed run keeps its committed batches but no marker — the next
    boot streams again, and dedup + caps just top the pool up."""
    monkeypatch.setenv("LEECHESS_SEED_URL", (tmp_path / "gone.csv.zst").as_uri())
    with seed_sessions() as db:  # batches an interrupted run got through
        db.add(Puzzle(fen="partial", solution="a1a2", motif="fork"))
        db.commit()

    assert seeding.maybe_autoseed() is True  # boots, fails on the dead URL
    with seed_sessions() as db:
        assert db.scalars(select(PuzzleSeedRun)).all() == []

    monkeypatch.setenv("LEECHESS_SEED_URL", dump_url)  # dump reachable again
    assert seeding.maybe_autoseed() is True  # next boot resumes
    with seed_sessions() as db:
        # the partial fork puzzle plus the sample's 4, deduped
        assert len(db.scalars(select(Puzzle)).all()) == 5
        assert db.scalars(select(PuzzleSeedRun)).one().imported == 4
