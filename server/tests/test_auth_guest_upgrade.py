"""Guest play, and the in-place upgrade to a registered account.

The point of modelling a guest as a real user row is that signing up later
moves no data. These tests are what hold that: a guest plays a game, sets a
password, and it is still the same account owning the same game.
"""

import pytest
from sqlalchemy import select

from app.auth.config import COOKIE_NAME
from app.auth.models import User

pytestmark = pytest.mark.unit


def test_a_guest_gets_a_session_without_a_password(anon_client):
    response = anon_client.post("/auth/guest", json={"username": "drifter"})

    assert response.status_code == 200
    assert response.json()["is_guest"] is True
    assert COOKIE_NAME in response.cookies
    assert anon_client.get("/auth/session").json()["user"]["username"] == "drifter"


def test_a_guest_has_no_password_hash(anon_client, db_session):
    anon_client.post("/auth/guest", json={"username": "drifter"})

    assert db_session.scalars(select(User)).one().hashed_password is None


def test_a_guest_cannot_be_signed_in_to_with_a_password(anon_client):
    """No hash means nothing to verify against, so the answer is the same one
    an unknown username gets — a guest account is not a way in."""
    anon_client.post("/auth/guest", json={"username": "drifter"})
    anon_client.post("/auth/logout")

    response = anon_client.post(
        "/auth/login", json={"username": "drifter", "password": "anything"}
    )

    assert response.status_code == 400


def test_a_guest_username_reserves_nothing(anon_client):
    """A name nobody can sign in with is not holding a login. The rest of that
    contract — including two guests sharing one name — is in
    tests/test_guest_names.py."""
    anon_client.post("/auth/guest", json={"username": "drifter"})
    anon_client.post("/auth/logout")

    response = anon_client.post(
        "/auth/register", json={"username": "DRIFTER", "password": "correct-horse"}
    )

    assert response.status_code == 200


def test_upgrading_keeps_the_same_account_and_its_games(anon_client, db_session):
    """The whole reason guests are real rows: no migration at the moment
    somebody decides to sign up."""
    guest = anon_client.post("/auth/guest", json={"username": "drifter"}).json()
    game_id = anon_client.post("/games", json={}).json()["id"]

    response = anon_client.post("/auth/upgrade", json={"username": "drifter", "password": "correct-horse"})

    assert response.status_code == 200
    upgraded = response.json()
    assert upgraded["id"] == guest["id"]
    assert upgraded["is_guest"] is False
    assert db_session.scalars(select(User)).one().hashed_password is not None
    # the game is still there, still reachable
    assert anon_client.get(f"/games/{game_id}").status_code == 200


def test_after_upgrading_the_password_signs_you_back_in(anon_client):
    anon_client.post("/auth/guest", json={"username": "drifter"})
    anon_client.post("/auth/upgrade", json={"username": "drifter", "password": "correct-horse"})
    anon_client.post("/auth/logout")

    response = anon_client.post(
        "/auth/login", json={"username": "drifter", "password": "correct-horse"}
    )

    assert response.status_code == 200
    assert response.json()["is_guest"] is False


def test_upgrading_twice_is_a_conflict(anon_client):
    anon_client.post("/auth/guest", json={"username": "drifter"})
    anon_client.post("/auth/upgrade", json={"username": "drifter", "password": "correct-horse"})

    response = anon_client.post("/auth/upgrade", json={"username": "drifter", "password": "something-else"})

    assert response.status_code == 409
    assert response.json()["detail"] == "ALREADY_REGISTERED"


def test_a_registered_account_cannot_be_upgraded(anon_client):
    anon_client.post("/auth/register", json={"username": "alice", "password": "correct-horse"})

    response = anon_client.post("/auth/upgrade", json={"username": "alice", "password": "another-one"})

    assert response.status_code == 409


def test_upgrading_requires_a_session(anon_client):
    assert anon_client.post("/auth/upgrade", json={"username": "drifter", "password": "correct-horse"}).status_code == 401


def test_a_short_password_does_not_upgrade_the_account(anon_client, db_session):
    anon_client.post("/auth/guest", json={"username": "drifter"})

    response = anon_client.post("/auth/upgrade", json={"username": "drifter", "password": "s"})

    assert response.status_code == 400
    still_a_guest = db_session.scalars(select(User)).one()
    assert still_a_guest.is_guest is True
    assert still_a_guest.hashed_password is None
