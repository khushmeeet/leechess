import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base, get_db
from app.main import app

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture()
def db_session(tmp_path):
    """Throwaway SQLite database per test — never touches the dev database."""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(bind=engine)
    TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = TestSession()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
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
