"""Phase 5: LLM "why" explanations. The Claude API is always mocked here —
the automated suite never depends on the live paid API (cross-phase testing
rule); one real exploratory call to judge prompt quality is a manual step.

Reuses the scripted hung-queen game: after tagging, exactly two moves are
explainable — ply 5 (Qxe5+?? blunder, hanging_piece allowed) and ply 6
(Nxe5 best, hanging_piece executed)."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import select

from app.explanations import (
    MODEL,
    SYSTEM_PROMPT,
    build_prompt,
    generate_explanations_for_game,
    needs_explanation,
)
from app.models import Explanation, Game, Move, MotifTag
from app.motifs import apply_rule_based_tags
from tests.test_motifs import analyzed_hung_queen_game

pytestmark = pytest.mark.unit

WHY = "The queen on e5 was only pretending to be safe: Nxe5 wins it for free."


@pytest.fixture()
def claude(monkeypatch):
    """Explanations on, the Claude call mocked. Returns the mock so tests
    can assert call counts and inspect prompts."""
    monkeypatch.setenv("LEECHESS_EXPLANATIONS", "on")
    mock = Mock(return_value=WHY)
    monkeypatch.setattr("app.explanations._request_explanation", mock)
    return mock


def tagged_hung_queen_game() -> Game:
    game = analyzed_hung_queen_game()
    apply_rule_based_tags(game)
    return game


# --- gating: only mistakes/blunders/tagged tactics trigger the prompt ---


@pytest.mark.parametrize(
    ("classification", "tags", "expected"),
    [
        ("mistake", [], True),
        ("blunder", [], True),
        ("best", ["fork"], True),  # executed tactic — "why your move worked"
        ("best", [], False),
        ("good", [], False),
        ("inaccuracy", [], False),
        (None, [], False),  # not analyzed yet
    ],
)
def test_needs_explanation_gate(classification, tags, expected):
    move = Move(classification=classification)
    move.motif_tags = [MotifTag(motif=name) for name in tags]
    assert needs_explanation(move) is expected


def test_only_flagged_moves_trigger_the_api(claude, db_session):
    game = tagged_hung_queen_game()
    db_session.add(game)

    assert generate_explanations_for_game(game) == 2
    db_session.commit()

    assert claude.call_count == 2  # plies 5 and 6, nothing else
    prompts = [call.args[0] for call in claude.call_args_list]
    assert game.moves[4].fen_before in prompts[0]
    assert game.moves[5].fen_before in prompts[1]
    assert game.moves[4].explanation.text == WHY
    assert game.moves[4].explanation.model == MODEL
    assert game.moves[0].explanation is None


def test_second_run_reads_the_cache_instead_of_calling_again(claude, db_session):
    game = tagged_hung_queen_game()
    db_session.add(game)
    generate_explanations_for_game(game)
    db_session.commit()
    assert claude.call_count == 2

    assert generate_explanations_for_game(game) == 0  # everything cached
    db_session.commit()

    assert claude.call_count == 2  # not called again
    assert len(db_session.scalars(select(Explanation)).all()) == 2


def test_disabled_env_makes_no_calls(monkeypatch, db_session):
    # conftest's autouse fixture already sets LEECHESS_EXPLANATIONS=off
    mock = Mock(return_value=WHY)
    monkeypatch.setattr("app.explanations._request_explanation", mock)
    game = tagged_hung_queen_game()
    db_session.add(game)

    assert generate_explanations_for_game(game) == 0
    mock.assert_not_called()


# --- failure handling: the analysis job must still complete ---


def test_api_failure_is_swallowed_and_stops_the_game(claude, db_session):
    claude.side_effect = RuntimeError("api down")
    game = tagged_hung_queen_game()
    db_session.add(game)

    assert generate_explanations_for_game(game) == 0  # no raise
    db_session.commit()

    assert claude.call_count == 1  # gave up after the first failure
    assert db_session.scalars(select(Explanation)).all() == []


def test_failure_keeps_explanations_generated_before_it(claude, db_session):
    claude.side_effect = [WHY, RuntimeError("api down")]
    game = tagged_hung_queen_game()
    db_session.add(game)

    assert generate_explanations_for_game(game) == 1
    db_session.commit()

    assert game.moves[4].explanation.text == WHY
    assert game.moves[5].explanation is None
    # the missed move is retried on the next run (scripts/explain.py)
    claude.side_effect = None
    assert generate_explanations_for_game(game) == 1
    assert game.moves[5].explanation.text == WHY


# --- the prompt: FEN + moves as SAN + eval loss + motifs ---


def test_build_prompt_contents():
    game = tagged_hung_queen_game()
    blunder, punish = game.moves[4], game.moves[5]
    blunder.eval_before, blunder.eval_after = 30.0, -820.0  # white blundered

    prompt = build_prompt(blunder, punish.best_move)

    assert blunder.fen_before in prompt
    assert "White played: Qxe5+" in prompt
    assert "Engine classification: blunder" in prompt
    assert "lost about 8.5 pawns" in prompt
    assert "Opponent's strongest reply to the played move: Nxe5" in prompt
    assert "hanging piece" in prompt  # humanized, not hanging_piece


def test_build_prompt_marks_an_executed_best_move():
    game = tagged_hung_queen_game()
    punish = game.moves[5]  # Nxe5, the engine's own best move
    prompt = build_prompt(punish, None)
    assert "Black played: Nxe5" in prompt
    assert "This was the engine's best move." in prompt
    assert "Engine's best move was" not in prompt


# --- the API call itself: request shape + response parsing ---


def test_request_explanation_calls_claude_and_extracts_text(monkeypatch):
    captured = {}

    class FakeMessages:
        def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                content=[
                    SimpleNamespace(type="thinking", thinking=""),
                    SimpleNamespace(type="text", text=f"  {WHY}  "),
                ]
            )

    monkeypatch.setattr(
        "anthropic.Anthropic",
        lambda: SimpleNamespace(messages=FakeMessages()),
    )
    from app.explanations import _request_explanation

    assert _request_explanation("the prompt") == WHY  # text only, stripped
    assert captured["model"] == MODEL
    assert captured["system"] == SYSTEM_PROMPT
    assert captured["messages"] == [{"role": "user", "content": "the prompt"}]


# --- the review endpoint serves the stored text ---


def test_review_endpoint_serves_explanations(claude, client, db_session):
    game = tagged_hung_queen_game()
    db_session.add(game)
    generate_explanations_for_game(game)
    db_session.commit()

    moves = client.get(f"/games/{game.id}/review").json()["moves"]
    assert moves[4]["explanation"] == WHY
    assert moves[0]["explanation"] is None
