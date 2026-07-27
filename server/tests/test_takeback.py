"""POST /games/{id}/takeback — Play's "take back and think again" drops the
trailing plies from the record so it matches the board the player is looking
at. Append-only submit_move derives ply from len(game.moves), so the record
has to shrink or the replacement move would collide with the retracted one."""

import chess
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from app.models import Move

pytestmark = pytest.mark.unit


@pytest.fixture()
def no_analysis(monkeypatch):
    """Completing a game must not shell out to Stockfish here."""
    monkeypatch.setattr("app.routers.games.run_game_analysis", lambda game_id: None)


def _live_game(client, sans: list[str]) -> int:
    """Create a pending game and play `sans` through the live-move API."""
    created = client.post("/games", json={"mode": "engine"})
    assert created.status_code == 201
    game_id = created.json()["id"]
    for san in sans:
        assert client.post(f"/games/{game_id}/moves", json={"san": san}).status_code == 201
    return game_id


def _sans(client, game_id: int) -> list[str]:
    return [move["san"] for move in client.get(f"/games/{game_id}").json()["moves"]]


def test_takeback_drops_the_trailing_plies(client):
    game_id = _live_game(client, ["e4", "e5", "Qh5", "Nc6"])

    response = client.post(f"/games/{game_id}/takeback", json={"to_ply": 2})
    assert response.status_code == 200

    board = chess.Board()
    board.push_san("e4")
    board.push_san("e5")
    assert response.json() == {"ply": 2, "fen": board.fen()}

    moves = client.get(f"/games/{game_id}").json()["moves"]
    assert [m["san"] for m in moves] == ["e4", "e5"]
    assert [m["ply"] for m in moves] == [1, 2]


def test_takeback_deletes_the_move_rows(client, db_engine):
    """delete-orphan on Game.moves must turn the detach into a row delete —
    orphans would keep colliding on ply."""
    game_id = _live_game(client, ["e4", "e5", "Qh5"])
    client.post(f"/games/{game_id}/takeback", json={"to_ply": 1})

    with OrmSession(db_engine) as session:
        rows = session.scalars(select(Move).where(Move.game_id == game_id)).all()
    assert [row.ply for row in rows] == [1]


def test_play_continues_from_the_restored_position(client):
    game_id = _live_game(client, ["e4", "e5", "Qh5"])
    client.post(f"/games/{game_id}/takeback", json={"to_ply": 2})

    # the retracted ply number is reused, and legality is re-checked against
    # the position the takeback restored
    replacement = client.post(f"/games/{game_id}/moves", json={"san": "Nf3"})
    assert replacement.status_code == 201
    assert replacement.json()["ply"] == 3
    assert _sans(client, game_id) == ["e4", "e5", "Nf3"]


def test_replacement_move_is_validated_against_the_restored_position(client):
    # Qh5 is legal at ply 3 but not once White's queen is back on d1 and the
    # knight has come to f3 instead
    game_id = _live_game(client, ["e4", "e5", "Qh5"])
    client.post(f"/games/{game_id}/takeback", json={"to_ply": 2})
    client.post(f"/games/{game_id}/moves", json={"san": "Nf3"})

    assert client.post(f"/games/{game_id}/moves", json={"uci": "d1h5"}).status_code == 422


def test_takeback_to_zero_empties_the_game(client):
    game_id = _live_game(client, ["e4", "e5"])

    response = client.post(f"/games/{game_id}/takeback", json={"to_ply": 0})
    assert response.status_code == 200
    assert response.json() == {"ply": 0, "fen": chess.STARTING_FEN}
    assert _sans(client, game_id) == []


def test_takeback_is_idempotent(client):
    """The client fires this from a promise chain — a retry or a double-click
    must not eat a second pair of plies."""
    game_id = _live_game(client, ["e4", "e5", "Qh5"])

    first = client.post(f"/games/{game_id}/takeback", json={"to_ply": 2})
    second = client.post(f"/games/{game_id}/takeback", json={"to_ply": 2})
    assert first.json() == second.json()
    assert _sans(client, game_id) == ["e4", "e5"]


def test_takeback_beyond_the_last_move_is_rejected(client):
    game_id = _live_game(client, ["e4", "e5"])

    assert client.post(f"/games/{game_id}/takeback", json={"to_ply": 3}).status_code == 409
    assert _sans(client, game_id) == ["e4", "e5"]


def test_takeback_rejects_a_negative_target(client):
    game_id = _live_game(client, ["e4"])

    assert client.post(f"/games/{game_id}/takeback", json={"to_ply": -1}).status_code == 422
    assert _sans(client, game_id) == ["e4"]


def test_takeback_rejects_a_completed_game(client, no_analysis):
    """A completed game's moves own analysis rows and generated puzzles, and
    its PGN is already written — the pending guard keeps them safe."""
    game_id = _live_game(client, ["e4", "e5"])
    assert client.post(f"/games/{game_id}/complete", json={}).status_code == 200

    assert client.post(f"/games/{game_id}/takeback", json={"to_ply": 1}).status_code == 409
    assert _sans(client, game_id) == ["e4", "e5"]


def test_takeback_on_a_missing_game_returns_404(client):
    assert client.post("/games/9999/takeback", json={"to_ply": 0}).status_code == 404
