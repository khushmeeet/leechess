"""Guess the move runs: kept per account as they go, summarized per game."""

from datetime import timedelta

import pytest

from app.models import GuessRun, utcnow

pytestmark = pytest.mark.unit


def totals(**overrides):
    return {
        "game_id": "immortal-1851",
        "side": "white",
        "points": 7,
        "max_points": 10,
        "matched": 1,
        "guessed": 2,
        **overrides,
    }


def start(client, **overrides):
    return client.post("/guess/runs", json=totals(**overrides))


def test_a_run_is_kept_for_the_account_and_updated_as_it_goes(
    client, db_session, signed_in_user
):
    response = start(client)
    assert response.status_code == 201
    run_id = response.json()["id"]

    update = client.put(
        f"/guess/runs/{run_id}",
        json=totals(points=12, max_points=15, guessed=3, finished=True),
    )
    assert update.status_code == 200

    run = db_session.get(GuessRun, run_id)
    db_session.refresh(run)
    assert run.user_id == signed_in_user.id
    assert (run.points, run.max_points, run.guessed, run.finished) == (12, 15, 3, True)


def test_nobody_records_without_an_account(anon_client):
    assert start(anon_client).status_code == 401


@pytest.mark.parametrize(
    "bad",
    [
        {"max_points": 11},  # 5 per guess, exactly
        {"points": 11},  # more than the most there was
        {"matched": 3},  # more exact than guessed
        {"guessed": 0, "max_points": 0, "points": 0, "matched": 0},
        {"side": "red"},
        {"game_id": "../etc"},
    ],
)
def test_totals_that_cannot_be_are_refused(client, bad):
    assert start(client, **bad).status_code == 422


def test_a_run_keeps_its_game_side_and_guesses(client):
    run_id = start(client).json()["id"]
    assert client.put(f"/guess/runs/{run_id}", json=totals(side="black")).status_code == 409
    assert (
        client.put(f"/guess/runs/{run_id}", json=totals(game_id="opera-1858")).status_code
        == 409
    )
    fewer = totals(guessed=1, max_points=5, points=5, matched=1)
    assert client.put(f"/guess/runs/{run_id}", json=fewer).status_code == 409


def test_another_accounts_run_cannot_be_touched(client, second_client):
    run_id = start(client).json()["id"]
    assert second_client.put(f"/guess/runs/{run_id}", json=totals()).status_code == 404
    assert client.put("/guess/runs/99999", json=totals()).status_code == 404


def test_summary_has_the_best_finished_run_and_the_latest(client):
    # finished at 60%, finished at 80%, then a run left halfway
    start(client, points=6, finished=True)
    start(client, points=8, finished=True)
    start(client, points=2)

    (summary,) = client.get("/guess/summary").json()
    assert summary["game_id"] == "immortal-1851"
    assert summary["side"] == "white"
    assert summary["runs"] == 3
    assert (summary["best"]["points"], summary["best"]["finished"]) == (8, True)
    assert (summary["latest"]["points"], summary["latest"]["finished"]) == (2, False)


def test_no_best_until_a_run_is_finished_and_sides_are_apart(client):
    start(client)
    start(client, side="black", points=10, finished=True)

    summaries = {s["side"]: s for s in client.get("/guess/summary").json()}
    assert summaries["white"]["best"] is None
    assert summaries["black"]["best"]["points"] == 10


def test_summary_is_most_recent_first_and_windowed(client, db_session):
    old = start(client, game_id="opera-1858").json()["id"]
    start(client, game_id="century-1956")
    run = db_session.get(GuessRun, old)
    run.updated_at = utcnow() - timedelta(days=40)
    db_session.commit()

    assert [s["game_id"] for s in client.get("/guess/summary").json()] == [
        "century-1956",
        "opera-1858",
    ]
    assert [s["game_id"] for s in client.get("/guess/summary?days=30").json()] == [
        "century-1956"
    ]
    # Progress carries the same summary for its own window
    assert [s["game_id"] for s in client.get("/progress?days=30").json()["guessing"]] == [
        "century-1956"
    ]


def test_summary_is_per_account(client, second_client):
    start(client)
    assert second_client.get("/guess/summary").json() == []
