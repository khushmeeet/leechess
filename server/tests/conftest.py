import json
import os
import shutil
import tempfile
from pathlib import Path

# Point the application database at a throwaway file BEFORE anything imports
# app.db. Importing app.main runs Base.metadata.create_all and the hand-rolled
# migration at module scope, which happens while pytest is collecting — long
# before any fixture could override a dependency. Without this line a plain
# `pytest` run creates and migrates the developer's real server/data/
# leechess.db, and any lifespan service whose session factory a test forgets
# to patch writes to it. _dev_database_is_untouched below is the guard that
# keeps this honest.
_TEST_DB_DIR = tempfile.mkdtemp(prefix="leechess-pytest-")
os.environ["LEECHESS_DB_URL"] = f"sqlite:///{Path(_TEST_DB_DIR) / 'import-time.db'}"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.db import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"

# The database a developer's `make dev` uses. Nothing in the suite may open it.
DEV_DB = Path(__file__).resolve().parents[1] / "data" / "leechess.db"

# Every session factory the app lifespan and its background jobs reach for.
# Direct-lifespan tests must redirect all of them: patching only the one the
# test cares about leaves the others pointed at the configured database.
LIFESPAN_SESSION_FACTORIES = (
    "app.analysis.session_factory",
    "app.seeding.session_factory",
    "app.endgame_drills.session_factory",
)


def pytest_collection_modifyitems(items):
    """`unit` is registered as "no Stockfish involved" — a test carrying both
    marks makes `pytest -m unit` shell out to the engine, which is how the
    endgame catalog's twelve depth-30 searches ended up in the fast suite."""
    both = [
        item.nodeid
        for item in items
        if item.get_closest_marker("unit") and item.get_closest_marker("engine")
    ]
    if both:
        raise pytest.UsageError(
            "these tests are marked both `unit` and `engine`, which contradicts "
            "the registered marker meanings:\n  " + "\n  ".join(both)
        )


@pytest.fixture(scope="session", autouse=True)
def _dev_database_is_untouched():
    """Fails the run if anything wrote to the development database.

    Test isolation here is a property of import order and monkeypatching, both
    of which are easy to break by accident (a new lifespan service, a new
    module-scope query). This notices.
    """

    def snapshot():
        if not DEV_DB.exists():
            return None
        stat = DEV_DB.stat()
        return (stat.st_size, stat.st_mtime_ns)

    before = snapshot()
    try:
        yield
        assert snapshot() == before, (
            f"a test wrote to the development database at {DEV_DB} — check that "
            "every session factory the code under test uses was redirected at "
            "the throwaway engine"
        )
    finally:
        shutil.rmtree(_TEST_DB_DIR, ignore_errors=True)


@pytest.fixture(autouse=True)
def _no_real_llm(monkeypatch):
    """The suite must never call the real (paid) Claude API — engine-marked
    tests run the full analysis job, which includes the Phase 5 explanation
    pass. test_explanations.py re-enables this and mocks the client."""
    monkeypatch.setenv("LEECHESS_EXPLANATIONS", "off")
    # Likewise, never hit the real Wikibooks API — test_wikibook.py
    # re-enables this and mocks the fetch.
    monkeypatch.setenv("LEECHESS_WIKIBOOK", "off")
    # And never auto-download the Lichess puzzle dump at app startup —
    # test_seeding.py exercises seeding against a local fixture file.
    monkeypatch.setenv("LEECHESS_AUTO_SEED", "off")


@pytest.fixture()
def db_engine(tmp_path):
    """Throwaway SQLite database per test — never touches the dev database."""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(bind=engine)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture()
def db_session(db_engine):
    TestSession = sessionmaker(bind=db_engine, autoflush=False, expire_on_commit=False)
    session = TestSession()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def lifespan_sessions(db_engine, monkeypatch):
    """Redirect every lifespan/background session factory at the throwaway
    engine and hand back the factory, for tests that enter the app lifespan
    themselves instead of going through the `client` fixture."""
    TestSession = sessionmaker(bind=db_engine, autoflush=False, expire_on_commit=False)
    for target in LIFESPAN_SESSION_FACTORIES:
        monkeypatch.setattr(target, TestSession)
    return TestSession


@pytest.fixture()
def client(db_engine, lifespan_sessions):
    """Each request gets its own session, exactly like production get_db —
    sharing one session across requests leaks stale identity-map state
    (a cached Game can mask the analysis job's committed writes)."""
    TestSession = lifespan_sessions

    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture(scope="session")
def clientside_game():
    """A short game exported from chess.js (see client/scripts/
    generate-pgn-fixture.ts) with the FEN after every ply, used to prove the
    client and server chess libraries agree on the same PGN."""
    return json.loads((FIXTURES / "clientside_game.json").read_text())
