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


def test_lifespan_fixture_redirects_every_listed_factory(lifespan_sessions):
    for target in LIFESPAN_SESSION_FACTORIES:
        module_path, attribute = target.rsplit(".", 1)
        module = __import__(module_path, fromlist=[attribute])
        assert getattr(module, attribute) is lifespan_sessions, target


def _modules_the_lifespan_calls_into() -> set[str]:
    """The app modules the lifespan body actually reaches, derived from its
    bytecode rather than from a list someone has to remember to update."""
    import app.main

    called = app.main.lifespan.__wrapped__.__code__.co_names
    modules = set()
    for name in called:
        target = getattr(app.main, name, None)
        module = getattr(target, "__module__", None)
        if module and module.startswith("app."):
            modules.add(module)
    return modules


def test_every_lifespan_service_with_a_session_factory_is_redirected():
    """The exact-set guard.

    A subset assertion ("these three are called") passes just as happily when a
    fourth service is added, which is precisely the change that would leak
    writes to the configured database. This instead asks the bytecode which app
    modules the lifespan calls into, keeps the ones that own a module-level
    `session_factory`, and requires that set to be exactly what
    LIFESPAN_SESSION_FACTORIES covers.
    """
    reached = _modules_the_lifespan_calls_into()
    assert reached, "could not read the lifespan's callees — has it been restructured?"

    with_factories = {
        name
        for name in reached
        if hasattr(__import__(name, fromlist=["session_factory"]), "session_factory")
    }
    covered = {target.rsplit(".", 1)[0] for target in LIFESPAN_SESSION_FACTORIES}
    assert with_factories == covered, (
        "the lifespan calls into a module with its own session_factory that "
        "tests/conftest.py does not redirect (or lists one it no longer calls): "
        f"{with_factories ^ covered}"
    )


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
