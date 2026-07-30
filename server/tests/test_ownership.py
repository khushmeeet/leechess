"""Two accounts, one database.

Everything personal — games, attempts, puzzles generated from your own
mistakes, progress — belongs to exactly one account. Two things are
deliberately shared: the imported Lichess puzzle pool and the twelve-drill
endgame catalog, because duplicating either per account would be pointless.
What is per account there is the scheduling state and the attempts.

These are the tests that hold that line, so a query that quietly loses its
WHERE clause fails here rather than in front of somebody else's games.
"""

import chess
import pytest
from sqlalchemy import select

from app.models import EndgameDrill, EndgameDrillState, Puzzle, PuzzleState

pytestmark = pytest.mark.unit

FEN = chess.STARTING_FEN


@pytest.fixture()
def other_client(second_client):
    """A second signed-in account on the same database, sharing nothing with
    the `client` fixture but the tables."""
    return second_client


def _finish_a_game(client) -> int:
    game_id = client.post("/games", json={"mode": "local"}).json()["id"]
    client.post(f"/games/{game_id}/moves", json={"san": "e4"})
    client.post(f"/games/{game_id}/complete", json={"result": "1-0"})
    return game_id


# --- games ---


def test_a_game_is_invisible_to_another_account(client, other_client):
    game_id = _finish_a_game(client)

    assert other_client.get(f"/games/{game_id}").status_code == 404
    assert other_client.get(f"/games/{game_id}/review").status_code == 404
    assert other_client.get("/games").json() == []


def test_the_owner_still_sees_their_own_game(client, other_client):
    game_id = _finish_a_game(client)

    assert client.get(f"/games/{game_id}").status_code == 200
    assert [game["id"] for game in client.get("/games").json()] == [game_id]


def test_another_account_cannot_move_in_or_delete_your_game(client, other_client):
    game_id = client.post("/games", json={"mode": "local"}).json()["id"]

    assert (
        other_client.post(f"/games/{game_id}/moves", json={"san": "e4"}).status_code
        == 404
    )
    assert other_client.delete(f"/games/{game_id}").status_code == 404
    assert (
        other_client.post(f"/games/{game_id}/takeback", json={"to_ply": 0}).status_code
        == 404
    )
    # ...and the game is untouched
    assert client.get(f"/games/{game_id}").status_code == 200


def test_signed_out_callers_get_nothing(anon_client):
    for path in (
        "/games",
        "/puzzles/next",
        "/endgames/drills",
        "/endgames/next",
        "/progress",
    ):
        assert anon_client.get(path).status_code == 401, f"GET {path}"
    assert anon_client.post("/games", json={}).status_code == 401


# --- puzzles: personal is private, the generic pool is shared ---


def test_a_personal_puzzle_belongs_to_the_player_who_missed_it(
    client, other_client, db_session, signed_in_user
):
    puzzle = Puzzle(
        fen=FEN, solution="e2e4", motif="fork", user_id=signed_in_user.id
    )
    db_session.add(puzzle)
    db_session.commit()

    assert client.get(f"/puzzles/{puzzle.id}").status_code == 200
    assert other_client.get(f"/puzzles/{puzzle.id}").status_code == 404
    assert other_client.get("/puzzles/next").status_code == 404


def test_the_generic_pool_is_served_to_everybody(client, other_client, db_session):
    # user_id NULL is what makes a puzzle part of the shared imported pool.
    db_session.add(
        Puzzle(fen=FEN, solution="e2e4", motif="fork", difficulty=1200)
    )
    db_session.commit()

    assert client.get("/puzzles/next").status_code == 200
    assert other_client.get("/puzzles/next").status_code == 200


def test_answering_a_shared_puzzle_reschedules_it_for_you_alone(
    client, other_client, db_session
):
    """The whole reason scheduling moved off the puzzle row."""
    db_session.add(Puzzle(fen=FEN, solution="e2e4", motif="fork", difficulty=1200))
    db_session.commit()
    puzzle_id = client.get("/puzzles/next").json()["id"]

    assert (
        client.post(
            f"/puzzles/{puzzle_id}/attempt", json={"correct": True}
        ).status_code
        == 201
    )

    # Solved and pushed out of the queue for the account that solved it...
    assert client.get("/puzzles/next").status_code == 404
    # ...and untouched for everybody else.
    assert other_client.get("/puzzles/next").json()["id"] == puzzle_id
    assert other_client.get(f"/puzzles/{puzzle_id}").json()["box"] == 1

    states = db_session.scalars(select(PuzzleState)).all()
    assert len(states) == 1, "one attempt must not schedule the puzzle for everyone"


def test_attempts_on_a_shared_puzzle_are_not_pooled(client, other_client, db_session):
    db_session.add(Puzzle(fen=FEN, solution="e2e4", motif="fork", difficulty=1200))
    db_session.commit()
    puzzle_id = client.get("/puzzles/next").json()["id"]

    client.post(f"/puzzles/{puzzle_id}/attempt", json={"correct": False})

    assert len(client.get(f"/puzzles/{puzzle_id}").json()["attempts"]) == 1
    assert other_client.get(f"/puzzles/{puzzle_id}").json()["attempts"] == []


# --- endgame drills: one catalog, per-account progress ---


def test_the_catalog_is_the_same_for_everyone(client, other_client, db_session):
    mine = client.get("/endgames/drills").json()
    theirs = other_client.get("/endgames/drills").json()

    assert [d["key"] for d in mine] == [d["key"] for d in theirs]
    assert mine, "the seeded catalog should not be empty"
    # one set of rows, not one per account
    assert len(db_session.scalars(select(EndgameDrill)).all()) == len(mine)


def test_playing_a_drill_advances_only_your_box(client, other_client, db_session):
    drill_id = client.get("/endgames/next").json()["id"]

    client.post(
        f"/endgames/{drill_id}/attempt",
        json={"success": True, "moves_played": 5, "outcome": "promoted"},
    )

    assert client.get(f"/endgames/{drill_id}").json()["box"] == 2
    assert other_client.get(f"/endgames/{drill_id}").json()["box"] == 1
    assert len(db_session.scalars(select(EndgameDrillState)).all()) == 1


def test_drill_attempts_are_not_pooled(client, other_client):
    drill_id = client.get("/endgames/next").json()["id"]

    client.post(
        f"/endgames/{drill_id}/attempt",
        json={"success": False, "moves_played": 3, "outcome": "pawn-lost"},
    )

    assert len(client.get(f"/endgames/{drill_id}").json()["attempts"]) == 1
    assert other_client.get(f"/endgames/{drill_id}").json()["attempts"] == []


# --- progress ---


def test_progress_reports_only_your_own_history(client, other_client, db_session):
    db_session.add(Puzzle(fen=FEN, solution="e2e4", motif="fork", difficulty=1200))
    db_session.commit()
    puzzle_id = client.get("/puzzles/next").json()["id"]
    client.post(f"/puzzles/{puzzle_id}/attempt", json={"correct": True})
    _finish_a_game(client)

    mine = client.get("/progress").json()
    assert mine["puzzles_solved"] == 1
    assert [m["motif"] for m in mine["motifs"]] == ["fork"]
    assert mine["streak_days"] == 1

    theirs = other_client.get("/progress").json()
    assert theirs["puzzles_solved"] == 0
    assert theirs["motifs"] == []
    assert theirs["cpl_trend"] == []
    assert theirs["streak_days"] == 0
