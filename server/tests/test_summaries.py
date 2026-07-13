"""Post-game coach summary: one cached LLM call per analyzed game. The
Claude API is always mocked here — the automated suite never depends on the
live paid API (cross-phase testing rule); one real exploratory call to judge
prompt quality is a manual step.

Reuses the scripted hung-queen game (1. e4 e5 2. Qh5 Nc6 3. Qxe5+ Nxe5):
after tagging, ply 5 is a blunder and ply 6 the executed punish — both land
in the digest's flagged list."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import select

from app.models import CoachSummary, Game
from app.motifs import apply_rule_based_tags
from app.summaries import (
    MODEL,
    SYSTEM_PROMPT,
    build_summary_prompt,
    generate_summary_for_game,
)
from tests.test_motifs import analyzed_hung_queen_game

pytestmark = pytest.mark.unit

TAKEAWAYS = (
    "1. Never grab a defended pawn with your queen.\n"
    "2. Check what recaptures before you capture.\n"
    "3. Your opening was fine until move 3."
)


@pytest.fixture()
def claude(monkeypatch):
    """Summaries on, the Claude call mocked. Returns the mock so tests can
    assert call counts and inspect prompts."""
    monkeypatch.setenv("LEECHESS_EXPLANATIONS", "on")
    mock = Mock(return_value=TAKEAWAYS)
    monkeypatch.setattr("app.summaries._request_summary", mock)
    return mock


def tagged_hung_queen_game() -> Game:
    game = analyzed_hung_queen_game()
    apply_rule_based_tags(game)
    # Evals as the analysis job would store them: quiet until the queen grab
    # loses ~8.5 pawns; the game never leaves the opening plies.
    for move in game.moves:
        move.eval_before, move.eval_after = 30.0, 30.0
    game.moves[4].eval_before, game.moves[4].eval_after = 30.0, -820.0
    game.moves[5].eval_before, game.moves[5].eval_after = -820.0, -830.0
    game.result = "0-1"
    return game


# --- one call per game, cached forever ---


def test_generates_and_stores_one_summary(claude, db_session):
    game = tagged_hung_queen_game()
    db_session.add(game)

    assert generate_summary_for_game(game) is True
    db_session.commit()

    assert claude.call_count == 1
    assert game.summary.text == TAKEAWAYS
    assert game.summary.model == MODEL


def test_second_run_reads_the_cache_instead_of_calling_again(claude, db_session):
    game = tagged_hung_queen_game()
    db_session.add(game)
    generate_summary_for_game(game)
    db_session.commit()

    assert generate_summary_for_game(game) is False  # cached
    db_session.commit()

    assert claude.call_count == 1  # not called again
    assert len(db_session.scalars(select(CoachSummary)).all()) == 1


def test_disabled_env_makes_no_calls(monkeypatch, db_session):
    # conftest's autouse fixture already sets LEECHESS_EXPLANATIONS=off
    mock = Mock(return_value=TAKEAWAYS)
    monkeypatch.setattr("app.summaries._request_summary", mock)
    game = tagged_hung_queen_game()
    db_session.add(game)

    assert generate_summary_for_game(game) is False
    mock.assert_not_called()


def test_unanalyzed_game_is_skipped(claude, db_session):
    game = tagged_hung_queen_game()
    game.moves[3].classification = None  # analysis never finished
    db_session.add(game)

    assert generate_summary_for_game(game) is False
    claude.assert_not_called()


# --- failure handling: the analysis job must still complete ---


def test_api_failure_is_swallowed_and_retried_next_run(claude, db_session):
    claude.side_effect = RuntimeError("api down")
    game = tagged_hung_queen_game()
    db_session.add(game)

    assert generate_summary_for_game(game) is False  # no raise
    db_session.commit()
    assert db_session.scalars(select(CoachSummary)).all() == []

    # the next run (scripts/explain.py) picks it up
    claude.side_effect = None
    assert generate_summary_for_game(game) is True
    assert game.summary.text == TAKEAWAYS


# --- the digest: result + classification counts + phase CPL + flagged moves ---


def test_build_summary_prompt_contents():
    prompt = build_summary_prompt(tagged_hung_queen_game())

    assert "Result: 0-1 — local game" in prompt
    assert "Your 6 moves: 4 best, 1 inaccuracy, 1 blunder." in prompt
    # 850cp lost over 6 moves, all inside the opening plies
    assert "Average pawns lost per move: 1.4 overall (opening 1.4)." in prompt
    assert "- 3. Qxe5+ — blunder; engine preferred Nc3; motifs: hanging piece" in prompt
    assert "- 3... Nxe5 — best (the engine's own choice); motifs: hanging piece" in prompt
    assert "middlegame" not in prompt  # never reached


def test_engine_mode_digests_white_moves_only():
    game = tagged_hung_queen_game()
    game.mode = "engine"

    prompt = build_summary_prompt(game)

    assert "you played White against the engine" in prompt
    assert "Your 3 moves: 1 best, 1 inaccuracy, 1 blunder." in prompt
    assert "3. Qxe5+" in prompt
    assert "Nxe5" not in prompt  # the engine's punish isn't your move


# --- the API call itself: request shape + response parsing ---


def test_request_summary_calls_claude_and_extracts_text(monkeypatch):
    captured = {}

    class FakeMessages:
        def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                content=[
                    SimpleNamespace(type="thinking", thinking=""),
                    SimpleNamespace(type="text", text=f"  {TAKEAWAYS}  "),
                ]
            )

    monkeypatch.setattr(
        "anthropic.Anthropic",
        lambda: SimpleNamespace(messages=FakeMessages()),
    )
    from app.summaries import _request_summary

    assert _request_summary("the digest") == TAKEAWAYS  # text only, stripped
    assert captured["model"] == MODEL
    assert captured["system"] == SYSTEM_PROMPT
    assert captured["messages"] == [{"role": "user", "content": "the digest"}]


# --- the review endpoint serves the stored text ---


def test_review_endpoint_serves_summary(claude, client, db_session):
    game = tagged_hung_queen_game()
    db_session.add(game)
    generate_summary_for_game(game)
    db_session.commit()

    body = client.get(f"/games/{game.id}/review").json()
    assert body["summary"] == TAKEAWAYS


def test_review_endpoint_serves_null_before_generation(client):
    game_id = client.post("/games", json={}).json()["id"]
    assert client.get(f"/games/{game_id}/review").json()["summary"] is None
