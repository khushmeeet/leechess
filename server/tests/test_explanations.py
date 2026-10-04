"""Phase 5: LLM "why" explanations. The Claude API is always mocked here —
the automated suite never depends on the live paid API (cross-phase testing
rule); one real exploratory call to judge prompt quality is a manual step.

Reuses the scripted hung-queen game: after tagging, exactly two moves are
explainable — ply 5 (Qxe5+?? blunder, hanging_piece allowed) and ply 6
(Nxe5 best, hanging_piece executed)."""

from types import SimpleNamespace
from unittest.mock import Mock

import chess
import pytest
from sqlalchemy import select

from app.explanations import (
    MODEL,
    SYSTEM_PROMPT,
    build_prompt,
    generate_explanations_for_game,
    misplaced_pieces,
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
    assert "White played 3. Qxe5+." in prompts[0]
    assert "Black played 3... Nxe5." in prompts[1]
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


# --- the prompt: facts in words, not a FEN for the model to misread ---


def test_build_prompt_states_the_facts_instead_of_a_fen():
    game = tagged_hung_queen_game()
    blunder, punish = game.moves[4], game.moves[5]
    blunder.eval_before, blunder.eval_after = 30.0, -820.0  # white blundered
    blunder.mistake_cause = "hung_piece"

    prompt = build_prompt(blunder, punish.best_move)

    assert blunder.fen_before not in prompt
    assert "- White: King e1, Queen h5," in prompt
    assert "Knights c6 g8" in prompt  # Black's pieces, by square
    assert "White played 3. Qxe5+." in prompt
    assert "Engine classification: blunder" in prompt
    assert "White's winning chances went from 53% to 5%." in prompt
    assert "After the move played: 3. Qxe5+ Nxe5" in prompt
    assert "these can be taken: the queen on e5 (the knight on c6 takes it)" in prompt
    assert "What went wrong: this move left a piece where it can be taken" in prompt
    assert "The opponent's reply Nxe5 wins material: it takes the queen on e5." in prompt


def test_build_prompt_gives_whole_lines_and_the_threat():
    """Scholar's mate, 3...Nf6??: the stored lines go in as numbered move
    notation, and the threat the move ignored is named."""
    board = chess.Board()
    for san in ["e4", "e5", "Bc4", "Nc6", "Qh5"]:
        board.push_san(san)
    fen_before = board.fen()
    board.push_san("Nf6")
    move = Move(
        ply=6, san="Nf6", fen_before=fen_before, fen_after=board.fen(),
        eval_before=-30.0, eval_after=1000.0, mate_after=1,
        classification="blunder", best_move="g7g6",
        best_line="g7g6 h5f3 g8f6", reply_line="h5f7",
        threat_move="h5f7", threat_mate=1, mistake_cause="missed_threat",
    )  # fmt: skip

    prompt = build_prompt(move, "h5f7")

    assert "The engine's line: 3... g6 4. Qf3 Nf6" in prompt
    assert "After the move played: 3... Nf6 4. Qxf7#" in prompt
    assert "White was threatening a forced mate starting with Qxf7#." in prompt
    assert "Black's winning chances went from 53% to 0%." in prompt


def test_build_prompt_marks_an_executed_best_move():
    game = tagged_hung_queen_game()
    punish = game.moves[5]  # Nxe5, the engine's own best move
    prompt = build_prompt(punish, None)
    assert "Black played 3... Nxe5." in prompt
    assert "This was the engine's best move." in prompt
    assert "After the move played" not in prompt
    assert "The engine's move Nxe5 wins material: it takes the queen on e5." in prompt


# --- what comes back: a piece on a wrong square means an invented board ---


def test_misplaced_pieces_checks_every_position_along_the_lines():
    game = tagged_hung_queen_game()
    blunder, punish = game.moves[4], game.moves[5]
    # the queen stands on e5 after the move; the knight lands there after
    # the reply — both real
    assert misplaced_pieces(WHY, blunder, punish.best_move) == []
    assert misplaced_pieces("The knight on e5 wins it.", blunder, punish.best_move) == []
    # nothing ever stands there
    assert misplaced_pieces(
        "The bishop on e5 and the Rook on d4 are loose.", blunder, punish.best_move
    ) == ["bishop on e5", "Rook on d4"]


def test_an_explanation_that_invents_a_piece_is_not_stored(claude, db_session):
    claude.side_effect = ["Your knight on d5 was pinned.", WHY]
    game = tagged_hung_queen_game()
    db_session.add(game)

    assert generate_explanations_for_game(game) == 1
    assert game.moves[4].explanation is None  # rejected — no knight on d5
    assert game.moves[5].explanation.text == WHY


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


def test_review_endpoint_serves_explanations(
    claude, client, db_session, signed_in_user
):
    game = tagged_hung_queen_game()
    game.user_id = signed_in_user.id
    db_session.add(game)
    generate_explanations_for_game(game)
    db_session.commit()

    moves = client.get(f"/games/{game.id}/review").json()["moves"]
    assert moves[4]["explanation"] == WHY
    assert moves[0]["explanation"] is None
