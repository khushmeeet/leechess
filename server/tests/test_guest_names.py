"""What a guest is allowed to call themselves — which is anything.

A guest cannot sign in with their name: there is no password behind it. So it
is a label rather than a credential, and none of the checks that protect a
credential apply. Refusing somebody at the door because three characters is
too few, or because a stranger got to "khushmeet" first, costs them the game
they turned up to play and protects nothing. These tests are what hold that
open — and, just as importantly, hold the door shut again the moment the same
account takes a password.
"""

import pytest
from sqlalchemy import select

from app.auth.models import USERNAME_MAX_LENGTH, User

pytestmark = pytest.mark.unit


def start_as_guest(client, username):
    """A fresh guest on a client that may already be signed in as one."""
    client.post("/auth/logout")
    response = client.post("/auth/guest", json={"username": username})
    assert response.status_code == 200, response.text
    return response.json()


def test_a_name_somebody_already_has_is_numbered_not_refused(anon_client):
    start_as_guest(anon_client, "drifter")

    second = start_as_guest(anon_client, "drifter")

    assert second["username"] == "drifter-2"
    assert second["is_guest"] is True


def test_the_numbering_keeps_going(anon_client):
    start_as_guest(anon_client, "drifter")
    start_as_guest(anon_client, "drifter")

    assert start_as_guest(anon_client, "drifter")["username"] == "drifter-3"


def test_a_case_variant_counts_as_taken(anon_client):
    """Uniqueness is still case-insensitive — the unique index is on the
    canonical column, so `DRIFTER` cannot be stored beside `drifter`."""
    start_as_guest(anon_client, "drifter")

    assert start_as_guest(anon_client, "DRIFTER")["username"] == "DRIFTER-2"


def test_a_registered_name_is_numbered_around_too(anon_client):
    anon_client.post("/auth/register", json={"username": "ada", "password": "correct-horse"})

    assert start_as_guest(anon_client, "ada")["username"] == "ada-2"


@pytest.mark.parametrize(
    "username",
    [
        "x",  # under the three-character floor
        "two words",
        "Grüße",
        "♞ knight",
        "e.g. o'brien",
    ],
)
def test_the_registered_shape_does_not_apply(anon_client, username):
    assert start_as_guest(anon_client, username)["username"] == username


def test_a_long_name_is_cut_rather_than_rejected(anon_client):
    guest = start_as_guest(anon_client, "a" * 60)

    assert guest["username"] == "a" * USERNAME_MAX_LENGTH


def test_a_numbered_long_name_still_fits_the_column(anon_client):
    """The number is what makes the name free, so it is the tail of the name
    that gives way — not the other way around."""
    start_as_guest(anon_client, "a" * USERNAME_MAX_LENGTH)

    second = start_as_guest(anon_client, "a" * USERNAME_MAX_LENGTH)

    assert len(second["username"]) <= USERNAME_MAX_LENGTH
    assert second["username"].endswith("-2")


def test_whitespace_is_flattened(anon_client):
    assert start_as_guest(anon_client, "  the \n drifter\t")["username"] == "the drifter"


def test_characters_that_would_not_render_as_themselves_are_dropped(anon_client):
    """A zero-width space is not a name, it is a way to look like somebody
    else's — and to make a nav bar disagree with a settings field."""
    assert start_as_guest(anon_client, "dri​fter")["username"] == "drifter"


def test_a_name_of_nothing_falls_back_rather_than_failing(anon_client):
    assert start_as_guest(anon_client, "   ")["username"] == "guest"


def test_a_guest_still_holds_their_name_against_a_registration(anon_client):
    """The relaxation runs one way. Registration is still a credential, so it
    is still refused — a guest's name is not free for the taking."""
    start_as_guest(anon_client, "drifter")
    anon_client.post("/auth/logout")

    response = anon_client.post(
        "/auth/register", json={"username": "DRIFTER", "password": "correct-horse"}
    )

    assert response.status_code == 409


def test_registration_is_still_held_to_the_shape(anon_client):
    response = anon_client.post(
        "/auth/register", json={"username": "x", "password": "correct-horse"}
    )

    assert response.status_code == 422


def test_every_guest_name_is_stored_exactly_once(anon_client, db_session):
    for _ in range(4):
        start_as_guest(anon_client, "drifter")

    names = [user.username for user in db_session.scalars(select(User))]
    assert names == ["drifter", "drifter-2", "drifter-3", "drifter-4"]


# --- renaming, which is the same freedom from the other side ----------------


def test_a_guest_renaming_onto_a_taken_name_is_numbered_not_refused(anon_client):
    start_as_guest(anon_client, "settled")
    start_as_guest(anon_client, "drifter")

    response = anon_client.patch("/users/me", json={"username": "settled"})

    assert response.status_code == 200
    assert response.json()["username"] == "settled-2"


def test_a_guest_rename_ignores_the_shape_rules(anon_client):
    start_as_guest(anon_client, "drifter")

    response = anon_client.patch("/users/me", json={"username": "two words"})

    assert response.status_code == 200
    assert response.json()["username"] == "two words"


def test_a_guest_keeping_their_own_name_is_not_a_collision(anon_client):
    """The name they hold is the one in the way, so a rename to it has to be
    recognised as their own — otherwise saving the field untouched renames
    them to `drifter-2`."""
    start_as_guest(anon_client, "drifter")

    response = anon_client.patch("/users/me", json={"username": "drifter"})

    assert response.status_code == 200
    assert response.json()["username"] == "drifter"


def test_a_guest_renaming_to_nothing_gets_the_fallback_not_a_500(anon_client):
    start_as_guest(anon_client, "drifter")

    response = anon_client.patch("/users/me", json={"username": None})

    assert response.status_code == 200
    assert response.json()["username"] == "guest"


# --- and the door closes again on signing up --------------------------------


def test_the_name_a_guest_ended_up_with_is_the_one_that_signs_them_back_in(anon_client):
    start_as_guest(anon_client, "drifter")
    numbered = start_as_guest(anon_client, "drifter")["username"]
    anon_client.post("/auth/upgrade", json={"password": "correct-horse"})
    anon_client.post("/auth/logout")

    response = anon_client.post(
        "/auth/login", json={"username": numbered, "password": "correct-horse"}
    )

    assert response.status_code == 200
    assert response.json()["username"] == "drifter-2"


def test_once_registered_the_name_is_verified_again(anon_client):
    """Setting a password turns the label into a credential. From then on a
    rename is checked like anyone else's — including against being taken."""
    start_as_guest(anon_client, "settled")
    start_as_guest(anon_client, "drifter")
    anon_client.post("/auth/upgrade", json={"password": "correct-horse"})

    shape = anon_client.patch("/users/me", json={"username": "two words"})
    taken = anon_client.patch("/users/me", json={"username": "settled"})

    assert shape.status_code == 400
    assert shape.json()["detail"] == "USERNAME_INVALID"
    assert taken.status_code == 409
    assert taken.json()["detail"] == "USERNAME_TAKEN"
