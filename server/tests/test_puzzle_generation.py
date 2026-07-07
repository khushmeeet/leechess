"""Personal puzzles from flagged moves — unit tests over hand-analyzed
games, plus one engine-marked end-to-end run of the real analysis job
(extends test_analysis_job.py's hung-queen scenario, same scripted game)."""

import shutil
from datetime import datetime, timezone

import chess
import pytest
from sqlalchemy import select

from app.models import Game, Move, Puzzle
from app.puzzle_generation import create_puzzles_for_game
from tests.test_motifs import analyzed_hung_queen_game

requires_stockfish = pytest.mark.skipif(
    shutil.which("stockfish") is None, reason="stockfish binary not in PATH"
)


def naive_utcnow() -> datetime:
    """Comparable to datetimes loaded from SQLite, which come back naive."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


# --- unit: which moves generate which puzzles ---


@pytest.mark.unit
def test_blunder_generates_a_punish_the_mistake_puzzle(db_session):
    """Qxe5+?? allowed Nxe5: best-vs-Qxe5 was quiet, so the puzzle is the
    position after the blunder with the punishing reply as the solution."""
    game = analyzed_hung_queen_game()
    db_session.add(game)

    created = create_puzzles_for_game(game)
    db_session.commit()

    assert len(created) == 1
    puzzle = created[0]
    qxe5 = game.moves[4]
    assert puzzle.source_move_id == qxe5.id
    assert puzzle.fen == qxe5.fen_after
    assert puzzle.solution == "c6e5"
    assert puzzle.motif == "hanging_piece"
    assert puzzle.difficulty is None
    # fresh puzzles are in box 1 and due immediately
    assert puzzle.box == 1
    assert puzzle.due_at <= datetime.now(timezone.utc)


ROYAL_FORK_FEN = "r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1"


@pytest.mark.unit
def test_missed_tactic_puzzle_drills_the_position_faced():
    """When the engine's best move executes a motif (Nc7+ royal fork), the
    puzzle is the position the player faced, solution = the missed move."""
    board = chess.Board(ROYAL_FORK_FEN)
    board.push_san("Kd1")
    game = Game(pgn="", analysis_status="complete")
    game.moves.append(
        Move(
            ply=1,
            san="Kd1",
            fen_before=ROYAL_FORK_FEN,
            fen_after=board.fen(),
            best_move="b5c7",
            classification="blunder",
        )
    )

    created = create_puzzles_for_game(game)

    assert len(created) == 1
    assert created[0].fen == ROYAL_FORK_FEN
    assert created[0].solution == "b5c7"
    assert created[0].motif == "fork"


@pytest.mark.unit
def test_flagged_move_without_any_motif_generates_no_puzzle():
    """A blunder that neither missed nor allowed a detectable tactic stays
    out of the queue — don't force a puzzle where there's no pattern."""
    board = chess.Board()
    board.push_san("e4")
    game = Game(pgn="", analysis_status="complete")
    game.moves.append(
        Move(
            ply=1,
            san="e4",
            fen_before=chess.STARTING_FEN,
            fen_after=board.fen(),
            best_move="g1f3",  # quiet best move, no motifs, no reply stored
            classification="blunder",
        )
    )
    assert create_puzzles_for_game(game) == []


@pytest.mark.unit
def test_create_puzzles_is_idempotent(db_session):
    game = analyzed_hung_queen_game()
    db_session.add(game)
    create_puzzles_for_game(game)
    db_session.commit()

    assert create_puzzles_for_game(game) == []
    db_session.commit()
    assert len(db_session.scalars(select(Puzzle)).all()) == 1


# --- practice endpoint: Review's "practice these misses" ---


@pytest.mark.unit
def test_practice_makes_this_games_puzzles_due_now(client, db_session):
    game = analyzed_hung_queen_game()
    db_session.add(game)
    create_puzzles_for_game(game)
    puzzle = game.moves[4].puzzles[0]
    puzzle.box = 3
    puzzle.due_at = datetime(2030, 1, 1)  # scheduled far out
    db_session.commit()

    response = client.post(f"/games/{game.id}/practice")
    assert response.status_code == 200
    assert response.json() == {"game_id": game.id, "queued": 1}

    db_session.expire_all()
    assert puzzle.due_at <= naive_utcnow()
    assert puzzle.box == 3  # drilling now doesn't reset learning progress
    # no duplicate rows were created
    assert len(db_session.scalars(select(Puzzle)).all()) == 1


@pytest.mark.unit
def test_practice_backfills_puzzles_for_games_analyzed_before_phase3(
    client, db_session
):
    game = analyzed_hung_queen_game()  # analyzed, but no puzzle rows yet
    db_session.add(game)
    db_session.commit()

    response = client.post(f"/games/{game.id}/practice")
    assert response.json()["queued"] == 1
    assert len(db_session.scalars(select(Puzzle)).all()) == 1


@pytest.mark.unit
def test_practice_rejects_unanalyzed_games(client):
    game_id = client.post("/games", json={}).json()["id"]
    client.post(f"/games/{game_id}/moves", json={"san": "e4"})
    assert client.post(f"/games/{game_id}/practice").status_code == 409


# --- engine: the real analysis job creates the puzzle row ---


@requires_stockfish
@pytest.mark.engine
def test_analysis_job_creates_personal_puzzle(client, db_session, monkeypatch):
    monkeypatch.setenv("LEECHESS_ANALYSIS_DEPTH", "8")
    game_id = client.post("/games", json={}).json()["id"]
    for san in ["e4", "e5", "Qh5", "Nc6", "Qxe5+", "Nxe5"]:
        assert client.post(f"/games/{game_id}/moves", json={"san": san}).status_code == 201
    client.post(f"/games/{game_id}/complete", json={"result": "0-1"})
    assert client.get(f"/games/{game_id}/review").json()["analysis_status"] == "complete"

    puzzles = db_session.scalars(select(Puzzle)).all()
    # every generated puzzle points back at its source move (none generic)
    assert puzzles and all(p.source_move_id is not None for p in puzzles)

    qxe5 = db_session.scalars(
        select(Move).where(Move.game_id == game_id, Move.san == "Qxe5+")
    ).one()
    (puzzle,) = qxe5.puzzles
    assert puzzle.fen == qxe5.fen_after
    assert puzzle.solution == "c6e5"  # the punish: knight takes the hung queen
    assert puzzle.motif == "hanging_piece"
