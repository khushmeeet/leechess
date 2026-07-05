"""End-to-end analysis job against the real Stockfish binary.

Uses the same scripted games as the Playwright specs (the clientside_game
fixture and Scholar's mate) so backend and frontend suites exercise
identical data. Depth is lowered via LEECHESS_ANALYSIS_DEPTH — these tests
assert plumbing (every move analyzed, statuses transition), not eval quality.
"""

import shutil

import pytest

from app.analysis import EVAL_CLAMP_CP

pytestmark = pytest.mark.engine

CLASSIFICATIONS = {"best", "good", "inaccuracy", "mistake", "blunder"}

requires_stockfish = pytest.mark.skipif(
    shutil.which("stockfish") is None, reason="stockfish binary not in PATH"
)


@pytest.fixture(autouse=True)
def fast_depth(monkeypatch):
    monkeypatch.setenv("LEECHESS_ANALYSIS_DEPTH", "8")


@requires_stockfish
def test_analysis_job_fills_every_move(client, clientside_game):
    game_id = client.post("/games", json={"pgn": clientside_game["pgn"]}).json()["id"]
    # TestClient runs the background task inline, so this call blocks until
    # analysis is done.
    done = client.post(f"/games/{game_id}/complete", json={"result": "*"})
    assert done.status_code == 200

    review = client.get(f"/games/{game_id}/review").json()
    assert review["analysis_status"] == "complete"
    moves = review["moves"]
    assert len(moves) == len(clientside_game["sans"])
    for move in moves:
        assert move["eval_before"] is not None, move["san"]
        assert move["eval_after"] is not None, move["san"]
        assert move["best_move"] is not None, move["san"]
        assert move["classification"] in CLASSIFICATIONS, move["san"]
    # eval chain is continuous: eval_after of ply N is eval_before of ply N+1
    for prev, nxt in zip(moves, moves[1:], strict=False):
        assert prev["eval_after"] == nxt["eval_before"]


@requires_stockfish
def test_analysis_of_checkmate_game(client):
    game_id = client.post("/games", json={}).json()["id"]
    for san in ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"]:  # Scholar's mate
        response = client.post(f"/games/{game_id}/moves", json={"san": san})
        assert response.status_code == 201

    client.post(f"/games/{game_id}/complete", json={})
    review = client.get(f"/games/{game_id}/review").json()
    assert review["result"] == "1-0"
    assert review["analysis_status"] == "complete"

    last = review["moves"][-1]
    # terminal position: eval pinned at the clamp for the winner, and the
    # mating move itself must classify (mate was already forced, so "best")
    assert last["eval_after"] == EVAL_CLAMP_CP
    assert last["classification"] in CLASSIFICATIONS
