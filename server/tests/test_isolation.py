"""Guards on the suite's own isolation.

Every other test is only as trustworthy as the database it ran against. These
assert the two invariants the rest of the suite quietly depends on: the
configured database is a throwaway, and the app's lifespan can be entered
without any service reaching past it.
"""

import pytest
from sqlalchemy import select

from app import db as app_db
from app.models import EndgameDrill, Game
from tests.conftest import DEV_DB, LIFESPAN_SESSION_FACTORIES, _TEST_DB_DIR

pytestmark = pytest.mark.unit


def test_configured_database_is_the_throwaway_one():
    """Importing app.main runs create_all and the migration at module scope,
    so the redirect has to happen in conftest before that import — not in a
    fixture. This fails loudly if the ordering ever breaks."""
    assert app_db.DATABASE_URL.startswith(f"sqlite:///{_TEST_DB_DIR}")
    assert str(DEV_DB) not in app_db.DATABASE_URL
    assert app_db.engine.url.database.startswith(_TEST_DB_DIR)


def test_lifespan_fixture_redirects_every_service(lifespan_sessions, monkeypatch):
    """The fixture is only useful if it covers every session factory the
    lifespan touches — a service added to app.main without being listed here
    would write to the configured database instead."""
    import app.main

    for target in LIFESPAN_SESSION_FACTORIES:
        module_path, attribute = target.rsplit(".", 1)
        module = __import__(module_path, fromlist=[attribute])
        assert getattr(module, attribute) is lifespan_sessions, target

    # The lifespan body calls exactly these three services; if a fourth
    # appears, LIFESPAN_SESSION_FACTORIES needs a matching entry.
    source = app.main.lifespan.__wrapped__.__code__.co_names
    assert {"reset_stale_analyses", "maybe_autoseed", "seed_catalog"} <= set(source)


def test_entering_the_lifespan_only_writes_to_the_throwaway_engine(client, db_engine):
    """seed_catalog runs inside the lifespan; its rows must land in the test
    engine. (The session-scoped dev-database guard in conftest catches the
    other direction — writes escaping to server/data/leechess.db.)"""
    with client:
        pass
    from sqlalchemy.orm import Session

    with Session(db_engine) as session:
        assert session.scalars(select(EndgameDrill)).all()
        assert session.scalars(select(Game)).all() == []
