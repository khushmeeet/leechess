import pytest

pytestmark = pytest.mark.unit


def test_create_game_stores_game_and_moves(client, clientside_game):
    response = client.post("/games", json={"pgn": clientside_game["pgn"]})
    assert response.status_code == 201
    body = response.json()
    assert body["white"] == "client"
    assert body["result"] == "*"
    assert body["analysis_status"] == "pending"

    detail = client.get(f"/games/{body['id']}")
    assert detail.status_code == 200
    moves = detail.json()["moves"]
    assert len(moves) == len(clientside_game["sans"])
    assert [m["san"] for m in moves] == clientside_game["sans"]
    assert [m["fen_after"] for m in moves] == clientside_game["fens"]
    assert moves[0]["ply"] == 1
    assert moves[0]["fen_before"].startswith(
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w"
    )


def test_create_game_rejects_pgn_without_moves(client):
    response = client.post("/games", json={"pgn": "not a pgn at all"})
    assert response.status_code == 422


def test_create_game_rejects_illegal_moves(client):
    # Illegal second move: the e5 pawn can't hop to e3.
    response = client.post("/games", json={"pgn": "1. e4 e5 2. e3e3 *"})
    assert response.status_code == 422


def test_get_missing_game_returns_404(client):
    response = client.get("/games/9999")
    assert response.status_code == 404
