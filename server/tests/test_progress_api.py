"""GET /progress returns hand-calculated aggregates from seeded rows — the
same cross-check the exit criteria asks for manually, automated so it holds
every time the queries change."""

from datetime import date, datetime, timedelta, timezone

import chess
import pytest

from app.models import Game, Move, Puzzle, PuzzleAttempt
from app.routers.progress import day_streak, game_cpl

pytestmark = pytest.mark.unit

FEN = chess.STARTING_FEN


def days_ago(n: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=n)


@pytest.fixture()
def seed(db_session):
    """Factories for attempt history and analyzed games with hand-set evals."""

    class Seed:
        def puzzle(self, motif: str) -> Puzzle:
            puzzle = Puzzle(fen=FEN, solution="e2e4", motif=motif)
            db_session.add(puzzle)
            db_session.commit()
            return puzzle

        def attempts(
            self, puzzle: Puzzle, *results: bool, at: datetime | None = None
        ) -> None:
            for correct in results:
                puzzle.attempts.append(
                    PuzzleAttempt(correct=correct, attempted_at=at or days_ago(0))
                )
            db_session.commit()

        def game(
            self,
            evals: list[tuple[float, float]],
            mode: str = "local",
            status: str = "complete",
            created_at: datetime | None = None,
        ) -> Game:
            """One move per (eval_before, eval_after) pair, white first."""
            game = Game(
                pgn="", mode=mode, analysis_status=status,
                created_at=created_at or days_ago(0),
            )  # fmt: skip
            for ply, (before, after) in enumerate(evals, start=1):
                game.moves.append(
                    Move(
                        ply=ply, san="e4", fen_before=FEN, fen_after=FEN,
                        eval_before=before, eval_after=after,
                        classification="good", best_move="e2e4",
                    )  # fmt: skip
                )
            db_session.add(game)
            db_session.commit()
            return game

    return Seed()


def get(client, **params) -> dict:
    response = client.get("/progress", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_empty_database_returns_zeroes_not_errors(client):
    body = get(client)
    assert body == {
        "days": None,
        "motifs": [],
        "weakest_motifs": [],
        "cpl_trend": [],
        "streak_days": 0,
        "puzzles_solved": 0,
    }


def test_motif_success_rates_are_exact(client, seed):
    fork = seed.puzzle("fork")
    pin = seed.puzzle("pin")
    seed.attempts(fork, True, True, False)  # 2/3
    seed.attempts(pin, False, True, False, False)  # 1/4

    motifs = {m["motif"]: m for m in get(client)["motifs"]}
    assert motifs["fork"] == {
        "motif": "fork", "attempts": 3, "correct": 2, "success_rate": 2 / 3,
    }  # fmt: skip
    assert motifs["pin"] == {
        "motif": "pin", "attempts": 4, "correct": 1, "success_rate": 0.25,
    }  # fmt: skip


def test_motifs_ordered_weakest_first(client, seed):
    strong = seed.puzzle("fork")
    weak = seed.puzzle("pin")
    seed.attempts(strong, True, True, True)
    seed.attempts(weak, False, False, True)

    assert [m["motif"] for m in get(client)["motifs"]] == ["pin", "fork"]


def test_weakest_callout_excludes_small_samples(client, seed):
    once = seed.puzzle("skewer")
    seed.attempts(once, False)  # 0% but only 1 attempt — not a trend
    steady = seed.puzzle("fork")
    seed.attempts(steady, True, True, False)  # 67% over 3 — callout-worthy

    body = get(client)
    assert [m["motif"] for m in body["weakest_motifs"]] == ["fork"]
    # ...but the small sample still shows in the full table, at the top
    assert [m["motif"] for m in body["motifs"]] == ["skewer", "fork"]


def test_weakest_callout_excludes_perfect_motifs(client, seed):
    aced = seed.puzzle("fork")
    seed.attempts(aced, True, True, True)  # enough attempts, but 100%

    body = get(client)
    assert body["weakest_motifs"] == []
    assert body["motifs"][0]["motif"] == "fork"  # still in the full table


def test_weakest_callout_caps_at_three(client, seed):
    for i, motif in enumerate(["fork", "pin", "skewer", "back_rank_mate"]):
        puzzle = seed.puzzle(motif)
        # success rates 0/3, 1/3, 2/3, 3/3 in listed order
        seed.attempts(puzzle, *(j < i for j in range(3)))

    assert [m["motif"] for m in get(client)["weakest_motifs"]] == [
        "fork", "pin", "skewer",
    ]  # fmt: skip


def test_days_window_filters_attempts_and_solved_count(client, seed):
    fork = seed.puzzle("fork")
    seed.attempts(fork, True, at=days_ago(40))  # outside a 30-day window
    seed.attempts(fork, False, True)

    body = get(client, days=30)
    assert body["days"] == 30
    assert body["motifs"] == [
        {"motif": "fork", "attempts": 2, "correct": 1, "success_rate": 0.5}
    ]
    assert body["puzzles_solved"] == 1

    all_time = get(client)
    assert all_time["motifs"][0]["attempts"] == 3
    assert all_time["puzzles_solved"] == 2


# --- CPL trend ---


def test_cpl_trend_averages_are_exact_for_local_games(client, seed):
    # Losses per ply: white 30, black 50, white 0 (eval improved 40→80 —
    # clamps at 0, never negative), black 20.
    game = seed.game([(20, -10), (-10, 40), (40, 80), (80, 100)])

    (point,) = get(client)["cpl_trend"]
    assert point["game_id"] == game.id
    assert point["mode"] == "local"
    # all four plies are the player's in local mode: (30 + 50 + 0 + 20) / 4
    assert point["avg_cpl"] == pytest.approx(25.0)
    assert point["opening_cpl"] == pytest.approx(25.0)
    assert point["middlegame_cpl"] is None
    assert point["endgame_cpl"] is None


def test_engine_games_count_only_whites_moves(client, seed):
    # vs Stockfish you play White: plies 1 and 3 (losses 30 and 50) are
    # yours; Black's reply losses must not dilute the average.
    seed.game([(20, -10), (-10, 40), (40, -10), (-10, 100)], mode="engine")

    (point,) = get(client)["cpl_trend"]
    assert point["avg_cpl"] == pytest.approx(40.0)


def test_cpl_phases_split_at_plies_20_and_60(client, seed):
    # 61 plies of a constant 10cp white loss / 0cp black loss shape:
    # eval drops 10 on odd plies, stays put on even ones.
    evals, current = [], 0.0
    for ply in range(1, 62):
        after = current - 10 if ply % 2 == 1 else current
        evals.append((current, after))
        current = after
    seed.game(evals)

    (point,) = get(client)["cpl_trend"]
    assert point["opening_cpl"] == pytest.approx(5.0)  # plies 1-20: half lose 10
    assert point["middlegame_cpl"] == pytest.approx(5.0)  # plies 21-60
    assert point["endgame_cpl"] == pytest.approx(10.0)  # ply 61 only (white)


def test_unanalyzed_and_failed_games_are_excluded(client, seed):
    seed.game([(0, -30)], status="pending")
    seed.game([(0, -30)], status="analyzing")
    seed.game([(0, -30)], status="failed")
    done = seed.game([(0, -30)])

    trend = get(client)["cpl_trend"]
    assert [p["game_id"] for p in trend] == [done.id]


def test_cpl_trend_is_oldest_first_and_windowed(client, seed):
    old = seed.game([(0, -30)], created_at=days_ago(40))
    recent = seed.game([(0, -20)], created_at=days_ago(1))

    assert [p["game_id"] for p in get(client)["cpl_trend"]] == [old.id, recent.id]
    assert [p["game_id"] for p in get(client, days=30)["cpl_trend"]] == [recent.id]


def test_game_with_null_evals_is_skipped_not_crashed(client, seed, db_session):
    game = seed.game([(0, -30)])
    game.moves[0].eval_after = None  # complete status but a hole in the data
    db_session.commit()

    assert get(client)["cpl_trend"] == []


# --- streaks ---


def test_streak_counts_consecutive_activity_days(client, seed):
    fork = seed.puzzle("fork")
    seed.attempts(fork, True, at=days_ago(2))
    seed.attempts(fork, False, at=days_ago(1))
    seed.attempts(fork, True, at=days_ago(0))

    assert get(client)["streak_days"] == 3


def test_streak_gap_resets(client, seed):
    fork = seed.puzzle("fork")
    seed.attempts(fork, True, at=days_ago(3))  # gap at day 1 breaks the chain
    seed.attempts(fork, True, at=days_ago(0))

    assert get(client)["streak_days"] == 1


def test_games_count_as_activity_too(client, seed):
    seed.game([(0, -30)], created_at=days_ago(1))
    fork = seed.puzzle("fork")
    seed.attempts(fork, True, at=days_ago(0))

    assert get(client)["streak_days"] == 2


def test_streak_alive_with_activity_only_yesterday():
    today = date(2026, 7, 7)
    assert day_streak({date(2026, 7, 6), date(2026, 7, 5)}, today) == 2
    assert day_streak({date(2026, 7, 5)}, today) == 0  # two days silent
    assert day_streak(set(), today) == 0


def test_game_cpl_returns_none_without_moves():
    assert game_cpl(Game(pgn="", analysis_status="complete")) is None
