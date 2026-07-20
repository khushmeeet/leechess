"""app.cpl is the single copy of the centipawn-loss math — these tests pin
its edge cases directly, plus the GameDetail.cpl_summary field the review
sidebar reads (hand-calculated per-side numbers, same cross-check style as
test_progress_api)."""

from types import SimpleNamespace

import chess
import pytest

from app.cpl import aggregate_cpl, move_loss, player_moves
from app.models import Game, Move

pytestmark = pytest.mark.unit

FEN = chess.STARTING_FEN


def mv(ply: int, before: float | None, after: float | None) -> SimpleNamespace:
    """A bare EvaluatedMove — the math must not need the ORM."""
    return SimpleNamespace(ply=ply, eval_before=before, eval_after=after)


def test_move_loss_is_from_the_movers_perspective():
    # Evals are White-perspective: a drop hurts White, a rise hurts Black.
    assert move_loss(mv(1, 20.0, -40.0)) == 60.0
    assert move_loss(mv(2, -40.0, -10.0)) == 30.0


def test_move_loss_clamps_improvement_to_zero():
    # The engine deepening its eval can make a move "gain" — never negative.
    assert move_loss(mv(1, 10.0, 50.0)) == 0.0
    assert move_loss(mv(2, 50.0, 10.0)) == 0.0


def test_move_loss_none_when_analysis_missing():
    assert move_loss(mv(1, None, 30.0)) is None
    assert move_loss(mv(1, 30.0, None)) is None


def test_aggregate_none_for_empty_or_incomplete():
    assert aggregate_cpl([]) is None
    assert aggregate_cpl([mv(1, 20.0, 0.0), mv(2, None, 0.0)]) is None


def test_aggregate_buckets_phases_by_ply():
    # Plies 9/30/71 land in opening/middlegame/endgame; mind the parity —
    # ply 30 is Black's move, so its loss is the eval *rising*.
    agg = aggregate_cpl([mv(9, 100.0, 40.0), mv(30, 80.0, 100.0), mv(71, 50.0, 40.0)])
    assert agg is not None
    assert agg.avg_cpl == (60.0 + 20.0 + 10.0) / 3
    assert agg.opening_cpl == 60.0
    assert agg.middlegame_cpl == 20.0
    assert agg.endgame_cpl == 10.0


def test_aggregate_phase_is_none_when_never_reached():
    agg = aggregate_cpl([mv(1, 100.0, 40.0)])
    assert agg is not None
    assert agg.middlegame_cpl is None
    assert agg.endgame_cpl is None


def make_game(mode: str, user_color: str, plies: int) -> Game:
    game = Game(pgn="", mode=mode, user_color=user_color)
    for ply in range(1, plies + 1):
        game.moves.append(
            Move(ply=ply, san="e4", fen_before=FEN, fen_after=FEN)
        )
    return game


def test_player_moves_engine_games_keep_only_the_users_side():
    as_black = make_game("engine", "black", plies=4)
    assert [move.ply for move in player_moves(as_black)] == [2, 4]
    as_white = make_game("engine", "white", plies=4)
    assert [move.ply for move in player_moves(as_white)] == [1, 3]


def test_player_moves_local_games_count_both_sides():
    game = make_game("local", "white", plies=4)
    assert [move.ply for move in player_moves(game)] == [1, 2, 3, 4]


@pytest.fixture()
def seeded_game(db_session):
    """An analyzed local game with hand-set evals and classifications.
    White: losses 60 and 0 → avg 30, one mistake.
    Black: losses 30 and 110 → avg 70, one inaccuracy and one blunder."""
    game = Game(pgn="", mode="local", analysis_status="complete")
    rows = [
        (1, 20.0, -40.0, "mistake"),
        (2, -40.0, -10.0, "inaccuracy"),
        (3, -10.0, -10.0, "good"),
        (4, -10.0, 100.0, "blunder"),
    ]
    for ply, before, after, classification in rows:
        game.moves.append(
            Move(
                ply=ply, san="e4", fen_before=FEN, fen_after=FEN,
                eval_before=before, eval_after=after,
                classification=classification, best_move="e2e4",
            )  # fmt: skip
        )
    db_session.add(game)
    db_session.commit()
    return game


def test_game_detail_serves_the_per_side_summary(client, seeded_game):
    body = client.get(f"/games/{seeded_game.id}").json()
    assert body["cpl_summary"] == {
        "white": {"avg_cpl": 30.0, "inaccuracy": 0, "mistake": 1, "blunder": 0},
        "black": {"avg_cpl": 70.0, "inaccuracy": 1, "mistake": 0, "blunder": 1},
    }


def test_game_detail_summary_null_until_analyzed(client, db_session):
    game = Game(pgn="", mode="local")
    game.moves.append(Move(ply=1, san="e4", fen_before=FEN, fen_after=FEN))
    db_session.add(game)
    db_session.commit()

    body = client.get(f"/games/{game.id}").json()
    assert body["cpl_summary"] is None
