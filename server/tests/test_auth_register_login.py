"""Registration, sign-in and the session cookie that carries them."""

import pytest
from sqlalchemy import select

from app.auth.config import COOKIE_NAME
from app.auth.models import User

pytestmark = pytest.mark.unit

CREDENTIALS = {"username": "alice", "password": "correct-horse"}


def test_register_signs_the_new_account_in(anon_client, db_engine):
    response = anon_client.post("/auth/register", json=CREDENTIALS)

    assert response.status_code == 200
    body = response.json()
    assert body["username"] == "alice"
    assert body["is_guest"] is False
    assert body["email"] is None
    assert COOKIE_NAME in response.cookies

    # and the cookie is immediately good for the next request
    session = anon_client.get("/auth/session").json()
    assert session["authenticated"] is True
    assert session["user"]["username"] == "alice"


def test_the_session_cookie_is_httponly(anon_client):
    """The credential must be out of reach of page scripts — Review renders
    sanitized Wikibooks HTML, so there is a real injection surface here."""
    response = anon_client.post("/auth/register", json=CREDENTIALS)

    cookie = next(
        value
        for key, value in response.headers.items()
        if key.lower() == "set-cookie" and value.startswith(COOKIE_NAME)
    )
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie


def test_the_password_is_not_stored_in_the_clear(anon_client, db_session):
    anon_client.post("/auth/register", json=CREDENTIALS)

    stored = db_session.scalars(select(User)).one().hashed_password
    assert stored is not None
    assert CREDENTIALS["password"] not in stored
    assert stored.startswith("$argon2")


def test_session_is_200_and_unauthenticated_when_signed_out(anon_client):
    """Not a 401. The SPA calls this on every boot, and being signed out is an
    ordinary answer rather than an error."""
    response = anon_client.get("/auth/session")

    assert response.status_code == 200
    assert response.json() == {"authenticated": False, "user": None}


def test_login_with_the_right_password_returns_the_user(anon_client):
    anon_client.post("/auth/register", json=CREDENTIALS)
    anon_client.post("/auth/logout")

    response = anon_client.post("/auth/login", json=CREDENTIALS)

    assert response.status_code == 200
    assert response.json()["username"] == "alice"
    assert anon_client.get("/auth/session").json()["authenticated"] is True


@pytest.mark.parametrize("lookup", ["alice", "ALICE", "AlIcE"])
def test_login_is_case_insensitive_on_the_username(anon_client, lookup):
    anon_client.post("/auth/register", json=CREDENTIALS)
    anon_client.post("/auth/logout")

    response = anon_client.post(
        "/auth/login", json={"username": lookup, "password": CREDENTIALS["password"]}
    )

    assert response.status_code == 200


def test_login_with_the_wrong_password_is_rejected(anon_client):
    anon_client.post("/auth/register", json=CREDENTIALS)
    anon_client.post("/auth/logout")

    response = anon_client.post("/auth/login", json={"username": "alice", "password": "nope"})

    assert response.status_code == 400
    assert response.json()["detail"] == "LOGIN_BAD_CREDENTIALS"
    assert anon_client.get("/auth/session").json()["authenticated"] is False


def test_an_unknown_user_gets_the_same_answer_as_a_wrong_password(anon_client):
    """Telling the two apart is a username oracle and buys the caller
    nothing."""
    response = anon_client.post(
        "/auth/login", json={"username": "ghost", "password": "whatever"}
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "LOGIN_BAD_CREDENTIALS"


def test_logout_clears_the_cookie(anon_client):
    anon_client.post("/auth/register", json=CREDENTIALS)

    response = anon_client.post("/auth/logout")

    assert response.status_code == 204
    assert anon_client.get("/auth/session").json()["authenticated"] is False


def test_logout_requires_a_current_session(anon_client):
    assert anon_client.post("/auth/logout").status_code == 401


def test_a_duplicate_username_is_a_conflict(anon_client):
    anon_client.post("/auth/register", json=CREDENTIALS)
    anon_client.post("/auth/logout")

    response = anon_client.post(
        "/auth/register", json={"username": "ALICE", "password": "another-one"}
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "USERNAME_TAKEN"


@pytest.mark.parametrize("username", ["ab", "has space", "way-too-long-a-name-for-here"])
def test_a_badly_shaped_username_is_rejected(anon_client, username):
    response = anon_client.post(
        "/auth/register", json={"username": username, "password": "correct-horse"}
    )

    assert response.status_code == 422


def test_a_short_password_is_rejected(anon_client, db_session):
    response = anon_client.post("/auth/register", json={"username": "alice", "password": "s"})

    assert response.status_code == 400
    assert db_session.scalars(select(User)).all() == []


def test_registration_routes_that_need_an_email_are_not_mounted(anon_client):
    """fastapi-users' register, reset and verify routers are all built around
    an email address. Mounting them would advertise flows this app cannot
    complete — there is no mail sender and no reset."""
    for path in (
        "/auth/forgot-password",
        "/auth/reset-password",
        "/auth/request-verify-token",
        "/auth/verify",
    ):
        assert anon_client.post(path, json={}).status_code == 404, path
