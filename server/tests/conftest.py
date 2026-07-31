import json
import os
import shutil
import tempfile
from contextlib import contextmanager
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
from sqlalchemy import create_engine, select  # noqa: E402
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
    "app.legacy_ownership.session_factory",
)


def pytest_collection_modifyitems(items):
    """Every test carries exactly one of `unit` and `engine`.

    Both marks at once contradicts the registered meanings ("unit: no
    Stockfish involved") — that is how the endgame catalog's twelve depth-30
    searches ended up inside the fast suite. Neither mark is the quieter
    problem: the test simply drops out of `-m unit` and nobody notices it
    stopped running there.
    """
    problems = []
    for item in items:
        unit = item.get_closest_marker("unit") is not None
        engine = item.get_closest_marker("engine") is not None
        if unit and engine:
            problems.append(f"{item.nodeid} — marked both `unit` and `engine`")
        elif not unit and not engine:
            problems.append(f"{item.nodeid} — marked neither `unit` nor `engine`")
    if problems:
        raise pytest.UsageError(
            "every test must carry exactly one of the registered markers:\n  "
            + "\n  ".join(problems)
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


@pytest.fixture(autouse=True)
def _session_cookie_survives_http(monkeypatch):
    """TestClient speaks plain http to `testserver`, and a Secure cookie is
    never sent back over that — every request after a sign-in would look
    anonymous. `make dev` and the browser suite turn the flag off for the same
    reason; a deploy leaves it on."""
    monkeypatch.setenv("LEECHESS_AUTH_COOKIE_SECURE", "off")


@pytest.fixture(autouse=True)
def _reset_login_throttle():
    """The failed-sign-in counter is module state, so it outlives any one app
    instance — without this, a test that trips the limit locks the same
    username out of every test that follows it."""
    from app.auth import throttle

    throttle.reset()
    yield
    throttle.reset()


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


@contextmanager
def _test_client(TestSession):
    """Each request gets its own session, exactly like production get_db —
    sharing one session across requests leaks stale identity-map state
    (a cached Game can mask the analysis job's committed writes)."""

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


@pytest.fixture()
def anon_client(db_engine, lifespan_sessions):
    """A client with no session. For the auth routes themselves, and for
    asserting that everything else refuses an anonymous caller."""
    with _test_client(lifespan_sessions) as test_client:
        yield test_client


USERNAME = "tester"
OTHER_USERNAME = "somebody-else"
PASSWORD = "correct-horse"


@pytest.fixture()
def client(anon_client):
    """Signed in, because every route outside /auth requires an account — an
    anonymous client would only ever prove that 401 works. (Playing without an
    account never reaches this server: it is a mode of the SPA.)

    A real registration through the API rather than a dependency override: the
    cookie, the token and the ownership columns are the thing under test in
    most of these files, and an override would quietly skip all three.
    """
    response = anon_client.post(
        "/auth/register", json={"username": USERNAME, "password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    return anon_client


@pytest.fixture()
def signed_in_user(client, db_session):
    """The account the `client` fixture is signed in as — for tests that write
    rows directly and have to stamp them with an owner."""
    from app.auth.models import User

    # By name rather than "the only row": ownership tests add a second account.
    return db_session.scalars(select(User).where(User.username == USERNAME)).one()


@pytest.fixture()
def second_client(client):
    """A second account, with a cookie jar of its own.

    A separate TestClient, not a second registration on the same one: cookies
    live on the client, so reusing it would just swap which account the single
    browser is. `client` has already installed the get_db override and run the
    lifespan, so this needs neither.
    """
    other = TestClient(app)
    response = other.post(
        "/auth/register", json={"username": OTHER_USERNAME, "password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    return other


@pytest.fixture(scope="session")
def clientside_game():
    """A short game exported from chess.js (see client/scripts/
    generate-pgn-fixture.ts) with the FEN after every ply, used to prove the
    client and server chess libraries agree on the same PGN."""
    return json.loads((FIXTURES / "clientside_game.json").read_text())
