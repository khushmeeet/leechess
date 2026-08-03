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
from tests.conftest import (
    DEV_DB,
    LIFESPAN_SESSION_FACTORIES,
    REDIRECTED_SESSION_FACTORIES,
    REQUEST_SCOPE_SESSION_FACTORIES,
    _TEST_DB_DIR,
)

pytestmark = pytest.mark.unit


def test_configured_database_is_the_throwaway_one():
    """Importing app.main runs create_all and the migration at module scope,
    so the redirect has to happen in conftest before that import — not in a
    fixture. This fails loudly if the ordering ever breaks."""
    assert app_db.DATABASE_URL.startswith(f"sqlite:///{_TEST_DB_DIR}")
    assert str(DEV_DB) not in app_db.DATABASE_URL
    assert app_db.engine.url.database.startswith(_TEST_DB_DIR)


def test_lifespan_fixture_redirects_every_listed_factory(lifespan_sessions):
    for target in REDIRECTED_SESSION_FACTORIES:
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


def test_every_router_with_its_own_session_factory_is_redirected():
    """The same exact-set guard, for the routers.

    A router normally takes its session from `get_db`, which the client
    fixture overrides — so a router owning a module-level `session_factory` is
    saying it has a code path that cannot (a WebSocket handler, which outlives
    the request scope the override belongs to). Those have to be redirected by
    hand, and the one that isn't would write to the configured database while
    every other assertion in its test read the throwaway one.
    """
    import importlib
    import pkgutil

    import app.routers

    with_factories = set()
    for info in pkgutil.iter_modules(app.routers.__path__):
        name = f"app.routers.{info.name}"
        if hasattr(importlib.import_module(name), "session_factory"):
            with_factories.add(name)
    covered = {target.rsplit(".", 1)[0] for target in REQUEST_SCOPE_SESSION_FACTORIES}
    assert with_factories == covered, (
        "a router owns a session_factory that tests/conftest.py does not "
        f"redirect (or lists one that no longer has one): {with_factories ^ covered}"
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
