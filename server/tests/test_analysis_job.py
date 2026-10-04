"""End-to-end analysis job against the real Stockfish binary.

Uses the same scripted games as the Playwright specs (the clientside_game
fixture and Scholar's mate) so backend and frontend suites exercise
identical data. Depth is lowered via LEECHESS_ANALYSIS_DEPTH — these tests
assert plumbing (every move analyzed, statuses transition), not eval quality.
"""

import shutil

import chess
import pytest

from app.analysis import EVAL_CLAMP_CP

pytestmark = pytest.mark.engine

CLASSIFICATIONS = {"book", "best", "good", "inaccuracy", "mistake", "blunder"}

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
    # every position got a threat search, except where the mover was in check
    for move in moves:
        in_check = chess.Board(move["fen_before"]).is_check()
        assert (move["threat_move"] is None) == in_check, move["san"]
        if not in_check:
            assert (move["threat_cp"] is None) != (move["threat_mate"] is None), move["san"]


@requires_stockfish
def test_analysis_tags_hung_queen_blunder(client):
    """Phase 2: the analysis job runs the rule-based tagger before marking
    the game complete. Same scripted game as test_motifs.py and the
    Playwright review spec: 3.Qxe5+?? hangs the queen to 3...Nxe5."""
    game_id = client.post("/games", json={}).json()["id"]
    for san in ["e4", "e5", "Qh5", "Nc6", "Qxe5+", "Nxe5"]:
        response = client.post(f"/games/{game_id}/moves", json={"san": san})
        assert response.status_code == 201

    client.post(f"/games/{game_id}/complete", json={"result": "0-1"})
    review = client.get(f"/games/{game_id}/review").json()
    assert review["analysis_status"] == "complete"

    qxe5, nxe5 = review["moves"][4], review["moves"][5]
    assert qxe5["classification"] == "blunder"
    assert "hanging_piece" in qxe5["motifs"]  # the tactic the blunder allowed
    assert "hanging_piece" in nxe5["motifs"]  # ...and the punish that took it


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

    moves = review["moves"]
    last = moves[-1]
    # terminal position: eval pinned at the clamp for the winner, with the
    # mate on the board stored as mate 0 — and the mating move grades best
    assert last["eval_after"] == EVAL_CLAMP_CP
    assert last["mate_after"] == 0
    assert last["classification"] == "best"
    # the forced mate rides beside the clamped evals, continuous like them
    assert last["mate_before"] == 1
    assert moves[-2]["mate_after"] == 1
    # 3...Nf6?? walked into it: a blunder, book or not
    assert moves[5]["classification"] == "blunder"
    # 1.e4 is book, whatever the engine thinks of it at depth 8
    assert moves[0]["classification"] == "book"


@requires_stockfish
def test_analysis_records_the_threat_each_move_had_to_answer(client):
    """Scholar's mate again: 3...Nf6 had to answer Qxf7#, and didn't. The
    search before it found the mate in one from White's side, and Qxf7# was
    still White's best reply after it — which is how Review tells an ignored
    threat from an answered one."""
    game_id = client.post("/games", json={}).json()["id"]
    for san in ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"]:
        assert client.post(f"/games/{game_id}/moves", json={"san": san}).status_code == 201

    client.post(f"/games/{game_id}/complete", json={})
    nf6, qxf7 = client.get(f"/games/{game_id}/review").json()["moves"][5:7]

    assert nf6["threat_move"] == "h5f7"
    assert nf6["threat_mate"] == 1
    assert nf6["threat_cp"] is None
    assert qxf7["best_move"] == nf6["threat_move"]
    # ...which makes it the cause Progress counts for the blunder
    assert nf6["mistake_cause"] == "missed_threat"
    assert qxf7["mistake_cause"] is None
