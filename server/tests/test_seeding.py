"""Generic-pool self-seeding — always against a zstd-compressed copy of the
checked-in sample CSV served from a file:// URL, never the real network dump
(the conftest autouse fixture also forces LEECHESS_AUTO_SEED=off, so app
startup inside the suite can never download anything).

Covers: the full stream→decompress→import pipeline, status transitions
(complete/failed), the skip-the-download short-circuit when every motif is
already at cap, both /puzzles/seed endpoints, the concurrent-run guard, and
the LEECHESS_AUTO_SEED startup gating."""

from compression import zstd

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app import seeding
from app.lichess_import import THEME_TO_MOTIF
from app.models import Puzzle
from tests.conftest import FIXTURES

pytestmark = pytest.mark.unit

SAMPLE = FIXTURES / "lichess_puzzles_sample.csv"
# What the sample imports (see test_lichess_import.py).
SAMPLE_POOL = {"fork": 2, "back_rank_mate": 1, "hanging_piece": 1}


@pytest.fixture(autouse=True)
def _fresh_seed_state():
    """Seeding status is module-global (in-memory, single-process) — give
    every test a clean slate."""
    seeding._status = seeding.SeedStatus()
    yield
    seeding._status = seeding.SeedStatus()


@pytest.fixture()
def dump_url(tmp_path):
    """file:// URL to a zstd-compressed copy of the sample CSV — exercises
    the exact urlopen → zstd → csv pipeline the real dump goes through."""
    path = tmp_path / "lichess_db_puzzle.csv.zst"
    path.write_bytes(zstd.compress(SAMPLE.read_bytes()))
    return path.as_uri()


@pytest.fixture()
def seed_sessions(db_engine, monkeypatch):
    """Point the seeding job's own sessions at the throwaway database (the
    `client` fixture does this too; this one serves the direct-call tests)."""
    factory = sessionmaker(bind=db_engine, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(seeding, "session_factory", factory)
    return factory


def test_run_seed_streams_the_dump_into_the_pool(seed_sessions, dump_url):
    assert seeding.begin()
    seeding.run_seed(url=dump_url)

    status = seeding.status()
    assert status.state == "complete"
    assert status.imported == 4
    assert status.error is None
    with seed_sessions() as db:
        puzzles = db.scalars(select(Puzzle)).all()
    assert len(puzzles) == 4
    assert all(p.source_move_id is None for p in puzzles)


def test_run_seed_failure_lands_in_status_not_an_exception(
    seed_sessions, tmp_path
):
    assert seeding.begin()
    seeding.run_seed(url=(tmp_path / "missing.csv.zst").as_uri())

    status = seeding.status()
    assert status.state == "failed"
    assert status.error
    with seed_sessions() as db:
        assert db.scalars(select(Puzzle)).all() == []


def test_full_pool_skips_the_download_entirely(
    seed_sessions, tmp_path, monkeypatch
):
    """Every motif at cap → complete without ever opening the URL (the URL
    here points at nothing, so touching it would flip the status to failed)."""
    monkeypatch.setattr(seeding, "MAX_PER_MOTIF", 1)
    with seed_sessions() as db:
        for i, motif in enumerate(sorted(set(THEME_TO_MOTIF.values()))):
            db.add(Puzzle(fen=f"fen-{i}", solution="a1a2", motif=motif))
        db.commit()

    assert seeding.begin()
    seeding.run_seed(url=(tmp_path / "missing.csv.zst").as_uri())
    assert seeding.status().state == "complete"


def test_seed_endpoints_trigger_and_report(client, dump_url, monkeypatch):
    monkeypatch.setenv("LEECHESS_SEED_URL", dump_url)

    idle = client.get("/puzzles/seed").json()
    assert idle == {
        "state": "idle", "scanned": 0, "imported": 0, "error": None, "pool": {},
    }  # fmt: skip

    started = client.post("/puzzles/seed")
    assert started.status_code == 202
    assert started.json()["state"] == "running"

    # TestClient runs the background task inline, so the run has finished.
    done = client.get("/puzzles/seed").json()
    assert done["state"] == "complete"
    assert done["imported"] == 4
    assert done["pool"] == SAMPLE_POOL

    # The queue actually serves the imported pool now.
    assert client.get("/puzzles/next").status_code == 200


def test_second_seed_while_running_is_409(client):
    assert seeding.begin()  # simulate an in-flight run
    response = client.post("/puzzles/seed")
    assert response.status_code == 409


class _InlineThread:
    """Stands in for threading.Thread so maybe_autoseed's background run
    executes synchronously and assertions see its result."""

    def __init__(self, target, **kwargs):
        self._target = target

    def start(self):
        self._target()


def test_autoseed_needs_the_env_flag(seed_sessions, monkeypatch):
    monkeypatch.delenv("LEECHESS_AUTO_SEED", raising=False)
    assert seeding.maybe_autoseed() is False
    monkeypatch.setenv("LEECHESS_AUTO_SEED", "off")
    assert seeding.maybe_autoseed() is False
    assert seeding.status().state == "idle"


def test_autoseed_fills_an_empty_pool(seed_sessions, dump_url, monkeypatch):
    monkeypatch.setenv("LEECHESS_AUTO_SEED", "on")
    monkeypatch.setenv("LEECHESS_SEED_URL", dump_url)
    monkeypatch.setattr(seeding.threading, "Thread", _InlineThread)

    assert seeding.maybe_autoseed() is True
    assert seeding.status().state == "complete"
    with seed_sessions() as db:
        assert len(db.scalars(select(Puzzle)).all()) == 4


def test_autoseed_leaves_a_nonempty_pool_alone(seed_sessions, monkeypatch):
    """A partial pool (e.g. a crashed run's committed batches) must not be
    re-streamed on every restart — resuming is POST /puzzles/seed's job."""
    monkeypatch.setenv("LEECHESS_AUTO_SEED", "on")
    with seed_sessions() as db:
        db.add(Puzzle(fen="fen-partial", solution="a1a2", motif="fork"))
        db.commit()
    assert seeding.maybe_autoseed() is False
    assert seeding.status().state == "idle"
