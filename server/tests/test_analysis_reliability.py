"""Reliability plumbing around the analysis job: the startup sweep that
recovers rows orphaned by a restart, and the semaphore that stops engine
jobs from running unbounded (BackgroundTasks has no limit of its own)."""

import threading

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app import analysis
from app.main import app
from app.models import Game


def _session_factory(db_engine, monkeypatch):
    TestSession = sessionmaker(bind=db_engine, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr("app.analysis.session_factory", TestSession)
    return TestSession


def test_sweep_marks_orphaned_analyzing_games_failed(db_engine, monkeypatch):
    TestSession = _session_factory(db_engine, monkeypatch)
    with TestSession() as db:
        db.add_all(
            [
                Game(pgn="", analysis_status="analyzing"),
                Game(pgn="", analysis_status="complete"),
                Game(pgn="", analysis_status="pending"),
            ]
        )
        db.commit()

    assert analysis.reset_stale_analyses() == 1

    with TestSession() as db:
        statuses = sorted(db.scalars(select(Game.analysis_status)))
        assert statuses == ["complete", "failed", "pending"]


def test_startup_runs_the_sweep(db_engine, monkeypatch):
    """The lifespan hook sweeps on boot — a deploy or auto-stopped machine
    must not leave games spinning as "analyzing" forever."""
    TestSession = _session_factory(db_engine, monkeypatch)
    with TestSession() as db:
        game = Game(pgn="", analysis_status="analyzing")
        db.add(game)
        db.commit()
        game_id = game.id

    with TestClient(app):
        pass  # entering the context runs the lifespan startup

    with TestSession() as db:
        assert db.get(Game, game_id).analysis_status == "failed"


def test_engine_jobs_wait_for_a_free_slot(db_engine, monkeypatch):
    """run_game_analysis blocks on the engine semaphore, so a burst of
    completed games can never spawn unbounded concurrent Stockfish runs."""
    TestSession = _session_factory(db_engine, monkeypatch)
    with TestSession() as db:
        game = Game(pgn="", analysis_status="analyzing")
        db.add(game)
        db.commit()
        game_id = game.id

    monkeypatch.setattr("app.analysis._analyze", lambda game: None)

    with analysis._engine_slots:  # hold the only slot
        job = threading.Thread(target=analysis.run_game_analysis, args=(game_id,))
        job.start()
        job.join(timeout=0.3)
        assert job.is_alive()  # blocked behind the held slot
        with TestSession() as db:
            assert db.get(Game, game_id).analysis_status == "analyzing"

    job.join(timeout=5)
    assert not job.is_alive()
    with TestSession() as db:
        assert db.get(Game, game_id).analysis_status == "complete"
