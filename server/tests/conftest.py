import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base, get_db
from app.main import app

FIXTURES = Path(__file__).parent / "fixtures"


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
def client(db_engine, monkeypatch):
    """Each request gets its own session, exactly like production get_db —
    sharing one session across requests leaks stale identity-map state
    (a cached Game can mask the analysis job's committed writes)."""
    TestSession = sessionmaker(bind=db_engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    # The analysis background job opens its own session — point it at the
    # same throwaway database (TestClient runs background tasks inline).
    monkeypatch.setattr("app.analysis.session_factory", TestSession)
    # Same for the puzzle-pool seeding job.
    monkeypatch.setattr("app.seeding.session_factory", TestSession)
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
