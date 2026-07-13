import chess
import pytest

pytestmark = pytest.mark.unit

STARTING_FEN = chess.STARTING_FEN

# Fool's mate — shortest possible checkmate, handy for lifecycle tests.
FOOLS_MATE = ["f3", "e5", "g4", "Qh4#"]


@pytest.fixture()
def no_analysis(monkeypatch):
    """Unit tests must not shell out to Stockfish — swap the background job
    for a no-op (the real job is covered by test_analysis_job.py)."""
    calls: list[int] = []
    monkeypatch.setattr(
        "app.routers.games.run_game_analysis", lambda game_id: calls.append(game_id)
    )
    return calls


# --- Phase 0 path: import a finished game from a full PGN ---


def test_create_game_from_pgn_stores_game_and_moves(client, clientside_game):
    response = client.post("/games", json={"pgn": clientside_game["pgn"]})
    assert response.status_code == 201
    body = response.json()
    assert body["white"] == "client"
    assert body["result"] == "*"
    assert body["analysis_status"] == "pending"
    # current position after the import is the last ply's FEN
    assert body["fen"] == clientside_game["fens"][-1]

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


# --- Phase 1 path: live game lifecycle ---


def test_start_game_returns_id_and_starting_fen(client):
    response = client.post("/games", json={"mode": "engine"})
    assert response.status_code == 201
    body = response.json()
    assert body["id"] > 0
    assert body["fen"] == STARTING_FEN
    assert body["mode"] == "engine"
    assert body["analysis_status"] == "pending"


def test_submit_legal_move_uci_and_san(client):
    game_id = client.post("/games", json={}).json()["id"]

    first = client.post(f"/games/{game_id}/moves", json={"uci": "e2e4"})
    assert first.status_code == 201
    body = first.json()
    assert body == {
        "ply": 1,
        "san": "e4",
        "uci": "e2e4",
        "fen_after": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
        "turn": "black",
        "game_over": False,
    }

    second = client.post(f"/games/{game_id}/moves", json={"san": "e5"})
    assert second.status_code == 201
    assert second.json()["ply"] == 2
    assert second.json()["uci"] == "e7e5"


def test_submit_illegal_move_is_rejected(client):
    game_id = client.post("/games", json={}).json()["id"]
    # Server-side validation must reject what a hacked client could send.
    for payload in [{"uci": "e2e5"}, {"san": "Qh5"}, {"uci": "garbage"}, {}]:
        response = client.post(f"/games/{game_id}/moves", json=payload)
        assert response.status_code == 422, payload
    # nothing was stored
    assert client.get(f"/games/{game_id}").json()["moves"] == []


def test_complete_derives_checkmate_result_and_queues_analysis(client, no_analysis):
    game_id = client.post("/games", json={}).json()["id"]
    for san in FOOLS_MATE:
        response = client.post(f"/games/{game_id}/moves", json={"san": san})
        assert response.status_code == 201
    assert response.json()["game_over"] is True

    done = client.post(f"/games/{game_id}/complete", json={})
    assert done.status_code == 200
    assert done.json()["result"] == "0-1"  # derived from the board, not sent
    assert done.json()["analysis_status"] == "analyzing"
    assert no_analysis == [game_id]

    # PGN was rebuilt from the stored moves
    pgn = client.get(f"/games/{game_id}").json()["pgn"]
    assert "Qh4#" in pgn and "0-1" in pgn


def test_complete_accepts_resignation_result(client, no_analysis):
    game_id = client.post("/games", json={}).json()["id"]
    client.post(f"/games/{game_id}/moves", json={"san": "e4"})
    done = client.post(f"/games/{game_id}/complete", json={"result": "0-1"})
    assert done.status_code == 200
    assert done.json()["result"] == "0-1"


def test_complete_rejects_empty_game_and_double_complete(client, no_analysis):
    game_id = client.post("/games", json={}).json()["id"]
    assert client.post(f"/games/{game_id}/complete", json={}).status_code == 422

    client.post(f"/games/{game_id}/moves", json={"san": "e4"})
    assert client.post(f"/games/{game_id}/complete", json={}).status_code == 200
    assert client.post(f"/games/{game_id}/complete", json={}).status_code == 409
    # no moves after completion either
    response = client.post(f"/games/{game_id}/moves", json={"san": "e5"})
    assert response.status_code == 409


def test_review_endpoint_returns_moves_and_status(client, no_analysis):
    game_id = client.post("/games", json={}).json()["id"]
    for san in ["e4", "e5"]:
        client.post(f"/games/{game_id}/moves", json={"san": san})
    client.post(f"/games/{game_id}/complete", json={"result": "1/2-1/2"})

    review = client.get(f"/games/{game_id}/review")
    assert review.status_code == 200
    body = review.json()
    assert body["analysis_status"] == "analyzing"  # job was stubbed out
    assert [m["san"] for m in body["moves"]] == ["e4", "e5"]
    assert all(m["classification"] is None for m in body["moves"])


def _finished_game(client) -> int:
    game_id = client.post("/games", json={}).json()["id"]
    client.post(f"/games/{game_id}/moves", json={"san": "e4"})
    client.post(f"/games/{game_id}/complete", json={"result": "1-0"})
    return game_id


def test_list_games_newest_first_finished_only(client, no_analysis):
    first = _finished_game(client)
    second = _finished_game(client)
    unfinished = client.post("/games", json={}).json()["id"]

    response = client.get("/games")
    assert response.status_code == 200
    ids = [g["id"] for g in response.json()]
    # in-progress/abandoned games never show up in the review list
    assert unfinished not in ids
    assert ids.index(second) < ids.index(first)


def test_discard_deletes_unfinished_game(client):
    game_id = client.post("/games", json={}).json()["id"]
    client.post(f"/games/{game_id}/moves", json={"san": "e4"})

    assert client.delete(f"/games/{game_id}").status_code == 204
    assert client.get(f"/games/{game_id}").status_code == 404
    assert client.delete(f"/games/{game_id}").status_code == 404


def test_discard_rejects_completed_game(client, no_analysis):
    game_id = _finished_game(client)
    assert client.delete(f"/games/{game_id}").status_code == 409
    assert client.get(f"/games/{game_id}").status_code == 200
