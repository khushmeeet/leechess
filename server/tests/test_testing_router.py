"""The test-support reset endpoint the browser suite depends on.

Two things need proving: it is genuinely absent unless the kill switch is on
(it truncates the whole database, so a deploy must not expose it), and it
clears every table rather than the handful someone remembered to list.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import Base, get_db
from app.main import app
from app.models import (
    EndgameDrill,
    Game,
    MotifTag,
    Move,
    Puzzle,
    PuzzleAttempt,
    WikibookCache,
)
from app.routers import testing as testing_router

pytestmark = pytest.mark.unit


def test_the_endpoint_is_absent_without_the_kill_switch(client, monkeypatch):
    """app.main only mounts the router when LEECHESS_TEST_RESET=on; the
    `client` fixture builds the app with it off, as production does."""
    monkeypatch.delenv("LEECHESS_TEST_RESET", raising=False)
    assert testing_router.enabled() is False
    assert client.post("/testing/reset").status_code == 404
    assert "/testing/reset" not in {
        getattr(route, "path", "") for route in app.routes
    }


@pytest.mark.parametrize("value", ["off", "0", "true", "yes", ""])
def test_only_the_exact_on_value_enables_it(value, monkeypatch):
    monkeypatch.setenv("LEECHESS_TEST_RESET", value)
    assert testing_router.enabled() is False


def test_on_enables_it(monkeypatch):
    monkeypatch.setenv("LEECHESS_TEST_RESET", "ON")
    assert testing_router.enabled() is True


@pytest.fixture()
def reset_client(db_engine, lifespan_sessions, monkeypatch):
    """A client whose app has the reset router mounted, built the same way
    app.main does it."""
    monkeypatch.setenv("LEECHESS_TEST_RESET", "on")
    TestSession = lifespan_sessions

    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.include_router(testing_router.router)
    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()
        app.router.routes = [
            route
            for route in app.router.routes
            if getattr(route, "path", "") != "/testing/reset"
        ]


def test_reset_empties_every_table_and_reseeds_the_catalog(reset_client, db_engine):
    from sqlalchemy.orm import Session

    game_id = reset_client.post("/games", json={}).json()["id"]
    reset_client.post(f"/games/{game_id}/moves", json={"san": "e4"})

    with Session(db_engine) as db:
        move = db.scalars(select(Move)).one()
        move.motif_tags.append(MotifTag(motif="fork"))
        puzzle = Puzzle(fen="8/8/8/8/8/8/8/K6k w - - 0 1", solution="a1a2", motif="fork")
        db.add(puzzle)
        db.add(WikibookCache(path="Ruy_Lopez", title="Ruy Lopez", html="<p>x</p>"))
        db.flush()
        db.add(PuzzleAttempt(puzzle_id=puzzle.id, correct=True))
        db.commit()

    body = reset_client.post("/testing/reset").json()
    assert body["deleted"]["games"] == 1
    assert body["deleted"]["moves"] == 1

    with Session(db_engine) as db:
        # Every table walked from the metadata is empty afterwards, apart from
        # the endgame catalog the endpoint deliberately reseeds. Driving this
        # off Base.metadata (not a hand-written list) is what makes a model
        # added later fail here instead of leaking between browser specs.
        catalog = Base.metadata.tables[EndgameDrill.__tablename__]
        for table in Base.metadata.sorted_tables:
            remaining = db.execute(select(func.count()).select_from(table)).scalar_one()
            if table is catalog:
                assert remaining == body["drills_seeded"] > 0
            else:
                assert remaining == 0, f"{table.name} survived the reset"

    # and the app still works: a fresh game starts from an empty database
    assert reset_client.get("/endgames/next").status_code == 200
    new_id = reset_client.post("/games", json={}).json()["id"]
    with Session(db_engine) as db:
        assert db.scalars(select(Game)).one().id == new_id


def test_reset_clears_accounts_too(reset_client, db_engine):
    """The loop above covers `users` automatically, since it walks the
    metadata. This is the part that would not have been noticed: accounts are
    what every browser spec signs in with, so a reset that left them behind
    would leak one spec's user into the next — and a reset that could not
    delete them at all (the row is referenced elsewhere) would fail loudly
    here rather than mid-suite.
    """
    from sqlalchemy.orm import Session

    from app.auth.models import User

    reset_client.post("/auth/register", json={"username": "alice", "password": "correct-horse"})
    with Session(db_engine) as db:
        assert db.scalars(select(User)).all() != []

    reset_client.post("/testing/reset")

    with Session(db_engine) as db:
        assert db.scalars(select(User)).all() == []
    # the freed name is available again, which is what a spec re-running needs
    assert (
        reset_client.post(
            "/auth/register", json={"username": "alice", "password": "correct-horse"}
        ).status_code
        == 200
    )
