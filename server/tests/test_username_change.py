"""Renaming, through the fastapi-users users router.

PATCH /users/me is a route this app does not own, and it only translates the
library's own exceptions — so the username rules live in UserManager._update
and reach the client through the handlers registered in app/auth/router.py.
That indirection is what these tests are really checking.
"""

import pytest

pytestmark = pytest.mark.unit

CREDENTIALS = {"username": "alice", "password": "correct-horse"}


def test_a_user_can_rename_themselves(anon_client):
    anon_client.post("/auth/register", json=CREDENTIALS)

    response = anon_client.patch("/users/me", json={"username": "Bobby"})

    assert response.status_code == 200
    assert response.json()["username"] == "Bobby"
    assert anon_client.get("/auth/session").json()["user"]["username"] == "Bobby"


def test_renaming_moves_the_login_identifier_too(anon_client):
    anon_client.post("/auth/register", json=CREDENTIALS)
    anon_client.patch("/users/me", json={"username": "Bobby"})
    anon_client.post("/auth/logout")

    assert (
        anon_client.post("/auth/login", json={"username": "BOBBY", "password": CREDENTIALS["password"]}).status_code
        == 200
    )
    assert (
        anon_client.post("/auth/login", json={"username": "alice", "password": CREDENTIALS["password"]}).status_code
        == 400
    )


def test_keeping_your_own_name_is_not_a_conflict(anon_client):
    anon_client.post("/auth/register", json=CREDENTIALS)

    assert anon_client.patch("/users/me", json={"username": "alice"}).status_code == 200


def test_taking_someone_elses_name_is_a_conflict(anon_client):
    anon_client.post("/auth/register", json={"username": "bob", "password": "correct-horse"})
    anon_client.post("/auth/logout")
    anon_client.post("/auth/register", json=CREDENTIALS)

    response = anon_client.patch("/users/me", json={"username": "bob"})

    assert response.status_code == 409
    assert response.json()["detail"] == "USERNAME_TAKEN"


def test_a_name_differing_only_in_case_is_a_conflict(anon_client):
    anon_client.post("/auth/register", json={"username": "bob", "password": "correct-horse"})
    anon_client.post("/auth/logout")
    anon_client.post("/auth/register", json=CREDENTIALS)

    assert anon_client.patch("/users/me", json={"username": "BOB"}).status_code == 409


@pytest.mark.parametrize("username", ["ab", "has space", "way-too-long-a-name-for-here"])
def test_a_badly_shaped_name_is_rejected(anon_client, username):
    """400 rather than 422: the shape check moved off the schema and into the
    manager when guests stopped being held to it, so a registered user's bad
    name now comes back as a code the client already has wording for."""
    anon_client.post("/auth/register", json=CREDENTIALS)

    response = anon_client.patch("/users/me", json={"username": username})

    assert response.status_code == 400
    assert response.json()["detail"] == "USERNAME_INVALID"
    assert anon_client.get("/auth/session").json()["user"]["username"] == "alice"


def test_renaming_requires_a_session(anon_client):
    assert anon_client.patch("/users/me", json={"username": "Bobby"}).status_code == 401


def test_an_email_cannot_be_set(anon_client):
    """The schema types it as null-only. Accepting an address would create a
    second identifier that nothing in this app knows how to use."""
    anon_client.post("/auth/register", json=CREDENTIALS)

    assert anon_client.patch("/users/me", json={"email": "a@b.com"}).status_code == 422


def test_a_guest_can_choose_a_different_name_before_signing_up(anon_client):
    anon_client.post("/auth/guest", json={"username": "drifter"})

    response = anon_client.patch("/users/me", json={"username": "settled"})

    assert response.status_code == 200
    assert response.json()["is_guest"] is True


def test_an_explicitly_null_username_is_rejected_not_a_crash(anon_client):
    """create_update_dict keeps a field the caller set to null, so this reaches
    the validator as None rather than being absent — which used to hit the
    regex and 500."""
    anon_client.post("/auth/register", json=CREDENTIALS)

    response = anon_client.patch("/users/me", json={"username": None})

    assert response.status_code == 400
    assert response.json()["detail"] == "USERNAME_INVALID"
    assert anon_client.get("/auth/session").json()["user"]["username"] == "alice"
