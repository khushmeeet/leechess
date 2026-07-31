import inspect

import pytest
from fastapi_users.db import BaseUserDatabase
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.auth.db import SyncUserDatabase
from app.auth.models import User

pytestmark = pytest.mark.unit

# The subset of fastapi-users' adapter protocol leechess actually calls. The
# OAuth methods are deliberately absent: there is no provider here, so they
# stay at the base class's NotImplementedError.
PROTOCOL_METHODS = ("get", "get_by_email", "create", "update", "delete")


@pytest.fixture()
def user_db(db_session):
    return SyncUserDatabase(db_session)


async def test_create_returns_a_persisted_user(user_db, db_session):
    user = await user_db.create({"username": "alice", "hashed_password": "hashed"})

    assert user.id is not None
    assert db_session.scalars(select(User)).one().id == user.id


async def test_get_finds_by_primary_key(user_db):
    created = await user_db.create({"username": "alice"})

    assert (await user_db.get(created.id)).id == created.id


async def test_get_returns_none_for_an_unknown_id(user_db):
    import uuid

    assert await user_db.get(uuid.uuid4()) is None


@pytest.mark.parametrize("lookup", ["alice", "ALICE", "AlIcE"])
async def test_get_by_username_is_case_insensitive(user_db, lookup):
    """Case-insensitivity is the whole reason username_canonical exists — this
    is the lookup UserManager.authenticate resolves logins through."""
    created = await user_db.create({"username": "Alice"})

    found = await user_db.get_by_username(lookup)
    assert found is not None
    assert found.id == created.id


async def test_get_by_username_returns_none_when_absent(user_db):
    assert await user_db.get_by_username("nobody") is None


async def test_get_by_email_returns_none_since_nothing_sets_an_email(user_db):
    """Kept working rather than removed: fastapi-users' own code paths call it,
    and with every email NULL the honest answer is always "no such user"."""
    await user_db.create({"username": "alice"})

    assert await user_db.get_by_email("alice@example.com") is None


async def test_update_writes_and_returns_the_user(user_db, db_session):
    user = await user_db.create({"username": "alice"})

    updated = await user_db.update(user, {"hashed_password": "new-hash"})

    assert updated.hashed_password == "new-hash"
    db_session.expire_all()
    assert db_session.scalars(select(User)).one().hashed_password == "new-hash"


async def test_update_through_username_refreshes_the_canonical_column(user_db):
    """The model validator has to survive the adapter's setattr loop, or a
    rename would leave the login lookup pointing at the old name."""
    user = await user_db.create({"username": "alice"})

    updated = await user_db.update(user, {"username": "Bobby"})

    assert updated.username_canonical == "bobby"
    assert await user_db.get_by_username("BOBBY") is not None


async def test_delete_removes_the_row(user_db, db_session):
    user = await user_db.create({"username": "alice"})

    await user_db.delete(user)

    assert db_session.scalars(select(User)).all() == []


async def test_a_duplicate_name_raises_and_leaves_the_session_usable(
    user_db, db_session
):
    """A failed flush that is not rolled back poisons every later query in the
    same request — which, since get_db hands one session to the whole request,
    would turn a 409 into a cascade of unrelated errors."""
    await user_db.create({"username": "alice"})

    with pytest.raises(IntegrityError):
        await user_db.create({"username": "ALICE"})

    # The session still works, and the failed insert left nothing behind.
    assert len(db_session.scalars(select(User)).all()) == 1
    assert (await user_db.get_by_username("alice")) is not None


def test_adapter_overrides_every_protocol_method_it_relies_on():
    """Drift guard for the version pin in pyproject.toml. If a fastapi-users
    release renames or drops one of these, this fails at collection instead of
    falling through to NotImplementedError inside a live request."""
    for name in PROTOCOL_METHODS:
        declared = getattr(BaseUserDatabase, name, None)
        assert declared is not None, f"fastapi-users no longer declares {name}"
        assert getattr(SyncUserDatabase, name) is not declared, (
            f"SyncUserDatabase stopped overriding {name}"
        )


def test_adapter_signatures_still_match_the_library():
    for name in PROTOCOL_METHODS:
        ours = inspect.signature(getattr(SyncUserDatabase, name))
        theirs = inspect.signature(getattr(BaseUserDatabase, name))
        assert list(ours.parameters) == list(theirs.parameters), (
            f"{name} signature drifted from fastapi-users"
        )
