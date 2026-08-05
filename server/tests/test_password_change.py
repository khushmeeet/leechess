"""Changing a password through PATCH /users/me.

The route comes from fastapi-users and accepts `password` whether or not this
app's UI offers a way to send one — so what it does with one is this app's
problem. Two rules, and both exist because leechess has no password reset: an
account taken this way is taken permanently, and its owner has no way back in.
"""

import pytest
from fastapi.testclient import TestClient

from app.auth.config import COOKIE_NAME
from app.main import app

pytestmark = pytest.mark.unit

PASSWORD = "correct-horse"  # what conftest's `client` fixture registers with


def test_a_password_change_needs_the_password_it_replaces(client):
    """Without this, a session cookie is a complete account takeover: anyone
    who gets one for a moment — a borrowed laptop, a tab left open — sets a new
    password and the owner is locked out for good."""
    response = client.patch("/users/me", json={"password": "brand-new-password"})

    assert response.status_code == 403
    assert response.json()["detail"] == "CURRENT_PASSWORD_WRONG"

    # And the old one still works, which is the point.
    signed_out = TestClient(app)
    assert (
        signed_out.post(
            "/auth/login", json={"username": "tester", "password": PASSWORD}
        ).status_code
        == 200
    )


def test_a_wrong_current_password_is_refused(client):
    response = client.patch(
        "/users/me",
        json={"password": "brand-new-password", "current_password": "not-it"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "CURRENT_PASSWORD_WRONG"


def test_the_right_current_password_changes_it(client):
    response = client.patch(
        "/users/me",
        json={"password": "a-whole-new-password", "current_password": PASSWORD},
    )
    assert response.status_code == 200

    fresh = TestClient(app)
    assert (
        fresh.post(
            "/auth/login", json={"username": "tester", "password": PASSWORD}
        ).status_code
        == 400
    )
    assert (
        fresh.post(
            "/auth/login",
            json={"username": "tester", "password": "a-whole-new-password"},
        ).status_code
        == 200
    )


def test_a_new_password_is_still_held_to_the_length_rule(client):
    response = client.patch(
        "/users/me", json={"password": "short", "current_password": PASSWORD}
    )

    assert response.status_code == 400


def test_changing_the_password_ends_every_older_session(client):
    """A stateless JWT cannot be deleted, so it is dated instead: the account
    carries a cutoff and the token carries when it was signed.

    Without this the change is half a fix — the password is new and the thirty-
    day cookie that prompted the change is still signed in.
    """
    stolen = TestClient(app)
    stolen.cookies.set(COOKIE_NAME, client.cookies.get(COOKIE_NAME))
    assert stolen.get("/auth/session").json()["authenticated"] is True

    assert (
        client.patch(
            "/users/me",
            json={"password": "a-whole-new-password", "current_password": PASSWORD},
        ).status_code
        == 200
    )

    assert stolen.get("/auth/session").json()["authenticated"] is False
    # Including the session that made the change: the old cookie is old.
    assert client.get("/auth/session").json()["authenticated"] is False


def test_a_session_from_after_the_change_is_fine(client):
    client.patch(
        "/users/me",
        json={"password": "a-whole-new-password", "current_password": PASSWORD},
    )

    fresh = TestClient(app)
    fresh.post(
        "/auth/login", json={"username": "tester", "password": "a-whole-new-password"}
    )

    assert fresh.get("/auth/session").json()["authenticated"] is True


def test_renaming_still_needs_no_password(client):
    """The current-password rule belongs to password changes alone — a rename
    is not one, and asking for a password to change a display name would be a
    worse app for no security."""
    response = client.patch("/users/me", json={"username": "renamed"})

    assert response.status_code == 200
    assert response.json()["username"] == "renamed"
    assert client.get("/auth/session").json()["authenticated"] is True


def test_current_password_is_not_written_to_the_row(client):
    """It is a proof, not a field. Left in the update dict it reaches
    setattr() and becomes an attribute the users table has never had."""
    response = client.patch(
        "/users/me", json={"username": "renamed", "current_password": PASSWORD}
    )

    assert response.status_code == 200
    assert "current_password" not in response.json()
