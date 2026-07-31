"""What a guest is allowed to call themselves — which is anything, including
somebody else's name.

A guest cannot sign in with their name: there is no password behind it, and
POST /auth/guest resumes a session from the cookie rather than from the name.
So it identifies nobody, and none of the machinery that protects an identifier
applies — not the shape, not uniqueness. Two browsers can both be playing as
`guest1` and be two different players with two different sets of games.

The checks are not gone, they have moved to the one place the name starts
meaning something: signing up. These tests hold both halves — the door open
while you are a guest, and shut the moment you take a password.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth.models import USERNAME_MAX_LENGTH, User
from app.main import app

pytestmark = pytest.mark.unit


def start_as_guest(client, username):
    """A guest on a client that may already be signed in as one — which is
    exactly the case that resumes rather than creating."""
    response = client.post("/auth/guest", json={"username": username})
    assert response.status_code == 200, response.text
    return response.json()


def another_browser():
    """A second cookie jar. The `anon_client` fixture has already installed
    the get_db override and run the lifespan, so this needs neither."""
    return TestClient(app)


# --- the same browser, the same name: one player ----------------------------


def test_asking_again_for_the_name_you_are_playing_under_resumes_it(anon_client):
    first = start_as_guest(anon_client, "guest1")

    second = start_as_guest(anon_client, "guest1")

    assert second["id"] == first["id"]
    assert second["username"] == "guest1"


def test_resuming_does_not_open_a_second_account(anon_client, db_session):
    start_as_guest(anon_client, "guest1")
    start_as_guest(anon_client, "guest1")

    assert db_session.scalars(select(User)).one().username == "guest1"


def test_resuming_keeps_the_games_that_session_already_owns(anon_client):
    start_as_guest(anon_client, "guest1")
    game_id = anon_client.post("/games", json={}).json()["id"]

    start_as_guest(anon_client, "guest1")

    assert anon_client.get(f"/games/{game_id}").status_code == 200


def test_the_name_is_matched_case_insensitively(anon_client):
    first = start_as_guest(anon_client, "guest1")

    assert start_as_guest(anon_client, "GUEST1")["id"] == first["id"]


def test_a_different_name_starts_a_fresh_session(anon_client, db_session):
    first = start_as_guest(anon_client, "guest1")

    second = start_as_guest(anon_client, "guest2")

    assert second["id"] != first["id"]
    assert db_session.scalars(select(User)).all() != []
    assert {user.username for user in db_session.scalars(select(User))} == {
        "guest1",
        "guest2",
    }


def test_a_signed_out_browser_starts_fresh_rather_than_resuming(anon_client):
    """The cookie is the only thing that says this browser is that guest. Once
    it is gone the account is gone with it — anything else would hand somebody
    else's games to whoever guessed the name."""
    first = start_as_guest(anon_client, "guest1")
    anon_client.post("/auth/logout")

    second = start_as_guest(anon_client, "guest1")

    assert second["id"] != first["id"]


def test_a_registered_account_is_never_resumed_by_name(anon_client):
    """Same reasoning, and more so: a name with a password behind it is only
    ever handed over by /auth/login."""
    anon_client.post(
        "/auth/register", json={"username": "ada", "password": "correct-horse"}
    )

    guest = start_as_guest(anon_client, "ada")

    assert guest["is_guest"] is True
    assert guest["username"] == "ada"


# --- another browser, the same name: two players ----------------------------


def test_two_browsers_can_play_under_one_name(anon_client, db_session):
    mine = start_as_guest(anon_client, "guest1")

    theirs = start_as_guest(another_browser(), "guest1")

    assert theirs["id"] != mine["id"]
    # Both stored as typed. Nobody is renamed around anybody.
    assert [user.username for user in db_session.scalars(select(User))] == [
        "guest1",
        "guest1",
    ]


def test_neither_of_them_can_see_the_other_s_games(anon_client):
    start_as_guest(anon_client, "guest1")
    game_id = anon_client.post("/games", json={}).json()["id"]

    stranger = another_browser()
    start_as_guest(stranger, "guest1")

    # Sharing a name is not sharing an account: ownership is the row id.
    assert stranger.get(f"/games/{game_id}").status_code == 404
    assert stranger.get("/games").json() == []


# --- the shape rules do not apply either ------------------------------------


@pytest.mark.parametrize(
    "username",
    ["x", "two words", "Grüße", "♞ knight", "e.g. o'brien"],
)
def test_the_registered_shape_does_not_apply(anon_client, username):
    assert start_as_guest(anon_client, username)["username"] == username


def test_a_long_name_is_cut_rather_than_rejected(anon_client):
    assert start_as_guest(anon_client, "a" * 60)["username"] == "a" * USERNAME_MAX_LENGTH


def test_whitespace_is_flattened(anon_client):
    assert start_as_guest(anon_client, "  the \n drifter\t")["username"] == "the drifter"


def test_characters_that_would_not_render_as_themselves_are_dropped(anon_client):
    """A zero-width space is not a name, it is a way to look like somebody
    else's — and to make a nav bar disagree with a settings field."""
    assert start_as_guest(anon_client, "dri​fter")["username"] == "drifter"


def test_a_name_of_nothing_falls_back_rather_than_failing(anon_client):
    assert start_as_guest(anon_client, "   ")["username"] == "guest"


def test_a_guest_rename_ignores_the_shape_rules(anon_client):
    start_as_guest(anon_client, "guest1")

    response = anon_client.patch("/users/me", json={"username": "two words"})

    assert response.status_code == 200
    assert response.json()["username"] == "two words"


def test_a_guest_can_rename_onto_a_name_somebody_else_uses(anon_client):
    other = another_browser()
    start_as_guest(other, "guest1")
    start_as_guest(anon_client, "guest2")

    response = anon_client.patch("/users/me", json={"username": "guest1"})

    assert response.status_code == 200
    assert response.json()["username"] == "guest1"


def test_a_guest_renaming_to_nothing_gets_the_fallback_not_a_500(anon_client):
    start_as_guest(anon_client, "guest1")

    response = anon_client.patch("/users/me", json={"username": None})

    assert response.status_code == 200
    assert response.json()["username"] == "guest"


# --- and every check lands at sign-up ---------------------------------------


def test_signing_up_takes_the_name_you_were_playing_under(anon_client):
    start_as_guest(anon_client, "guest1")

    response = anon_client.post(
        "/auth/upgrade", json={"username": "guest1", "password": "correct-horse"}
    )

    assert response.status_code == 200
    assert response.json()["username"] == "guest1"
    assert response.json()["is_guest"] is False


def test_signing_up_can_change_the_name(anon_client):
    """The guest name was a label; this is the first time anyone is choosing a
    login, so it is a real field rather than a fait accompli."""
    start_as_guest(anon_client, "two words")

    response = anon_client.post(
        "/auth/upgrade", json={"username": "settled", "password": "correct-horse"}
    )

    assert response.status_code == 200
    assert response.json()["username"] == "settled"


def test_signing_up_on_a_registered_name_is_refused(anon_client):
    anon_client.post(
        "/auth/register", json={"username": "ada", "password": "correct-horse"}
    )
    anon_client.post("/auth/logout")
    start_as_guest(anon_client, "ada")

    response = anon_client.post(
        "/auth/upgrade", json={"username": "ada", "password": "correct-horse"}
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "USERNAME_TAKEN"


def test_signing_up_on_a_badly_shaped_name_is_refused(anon_client):
    start_as_guest(anon_client, "two words")

    response = anon_client.post(
        "/auth/upgrade", json={"username": "two words", "password": "correct-horse"}
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "USERNAME_INVALID"


def test_a_refused_sign_up_leaves_the_account_a_guest(anon_client, db_session):
    start_as_guest(anon_client, "two words")

    anon_client.post(
        "/auth/upgrade", json={"username": "two words", "password": "correct-horse"}
    )

    still_a_guest = db_session.scalars(select(User)).one()
    assert still_a_guest.is_guest is True
    assert still_a_guest.hashed_password is None
    assert still_a_guest.username == "two words"


def test_only_one_of_two_guests_sharing_a_name_can_register_it(anon_client):
    start_as_guest(anon_client, "guest1")
    other = another_browser()
    start_as_guest(other, "guest1")

    first = anon_client.post(
        "/auth/upgrade", json={"username": "guest1", "password": "correct-horse"}
    )
    second = other.post(
        "/auth/upgrade", json={"username": "guest1", "password": "another-one"}
    )

    assert first.status_code == 200
    assert second.status_code == 409
    # The loser is still playing, still a guest, still called guest1.
    assert other.get("/auth/session").json()["user"]["username"] == "guest1"


def test_a_guest_name_does_not_block_a_registration(anon_client):
    """The half that used to be the other way round. A name nobody can sign in
    with is not holding anything: whoever wants it as a login can have it."""
    start_as_guest(anon_client, "ada")
    anon_client.post("/auth/logout")

    response = anon_client.post(
        "/auth/register", json={"username": "ADA", "password": "correct-horse"}
    )

    assert response.status_code == 200


def test_registration_is_still_held_to_the_shape(anon_client):
    response = anon_client.post(
        "/auth/register", json={"username": "x", "password": "correct-horse"}
    )

    assert response.status_code == 422


def test_a_registered_name_is_still_taken(anon_client):
    anon_client.post(
        "/auth/register", json={"username": "ada", "password": "correct-horse"}
    )
    anon_client.post("/auth/logout")

    response = anon_client.post(
        "/auth/register", json={"username": "ADA", "password": "another-one"}
    )

    assert response.status_code == 409


def test_signing_in_finds_the_registered_account_past_the_guests(anon_client):
    """Several rows can carry this canonical name; exactly one of them has a
    password, and that is the one a sign-in resolves to."""
    start_as_guest(another_browser(), "ada")
    start_as_guest(another_browser(), "ada")
    anon_client.post(
        "/auth/register", json={"username": "ada", "password": "correct-horse"}
    )
    anon_client.post("/auth/logout")

    response = anon_client.post(
        "/auth/login", json={"username": "ada", "password": "correct-horse"}
    )

    assert response.status_code == 200
    assert response.json()["is_guest"] is False
