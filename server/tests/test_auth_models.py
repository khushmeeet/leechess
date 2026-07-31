import pytest
from sqlalchemy import inspect, select
from sqlalchemy.exc import IntegrityError

from app.auth.models import User, canonical
from app.db import Base

pytestmark = pytest.mark.unit


def test_users_table_is_registered_on_the_shared_metadata():
    """app.main imports app.auth.models for exactly this side effect: the table
    has to exist on Base.metadata before create_all runs at module scope. If
    that import is ever tidied away as unused, this is what notices."""
    assert "users" in Base.metadata.tables


def test_create_all_makes_the_table(db_engine):
    assert "users" in inspect(db_engine).get_table_names()


def test_an_account_round_trips_without_an_email_or_password(db_session):
    """Both columns are NOT NULL on fastapi-users' mixin and redeclared
    nullable on User: no email ever, and no password on the rows left behind
    by the guest accounts this app used to create."""
    db_session.add(User(username="drifter"))
    db_session.commit()

    user = db_session.scalars(select(User)).one()
    assert user.email is None
    assert user.hashed_password is None
    assert user.is_active is True


def test_username_keeps_its_display_casing(db_session):
    db_session.add(User(username="MagnusC"))
    db_session.commit()

    assert db_session.scalars(select(User)).one().username == "MagnusC"


def test_canonical_is_derived_on_assignment_without_being_passed():
    """The validator is what stops username and username_canonical drifting.
    Direct construction is the path tests and fixtures take, so it has to work
    there and not only through the adapter."""
    user = User(username="MagnusC")
    assert user.username_canonical == "magnusc"

    user.username = "Renamed"
    assert user.username_canonical == "renamed"


def test_the_unique_index_rejects_a_name_differing_only_in_case(db_session):
    """Usernames are login identifiers, so `Alice` must not be a second account
    alongside `alice`. The explicit check in the manager is the friendly path;
    this index is what holds when two signups race."""
    db_session.add(User(username="alice"))
    db_session.commit()

    db_session.add(User(username="ALICE"))
    with pytest.raises(IntegrityError):
        db_session.commit()


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("alice", "alice"), ("Alice", "alice"), ("MiXeD_case-99", "mixed_case-99")],
)
def test_canonical_lowercases(raw, expected):
    assert canonical(raw) == expected
