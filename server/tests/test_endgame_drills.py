"""Endgame drills: catalog integrity, seeding, selection, Leitner wiring.

Everything here is pure logic or SQLite. The Stockfish verification of the
catalog — the check that stops a mistyped FEN from shipping a "win" drill
that is actually drawn — lives in test_endgame_catalog_engine.py so that this
module's `unit` mark keeps its registered meaning ("no Stockfish involved").
"""

from datetime import datetime, timedelta, timezone

import chess
import pytest

from app.endgame_drills import CATALOG, FAMILY_NAMES, seed_drills
from app.models import EndgameDrill, EndgameDrillState, utcnow
from app.spaced_repetition import BOX_INTERVALS

pytestmark = pytest.mark.unit


def _parse_due(stamp: str) -> datetime:
    """SQLite drops the tzinfo utcnow() attaches, so the API serves a naive
    stamp; read it back as the UTC it actually is (the same thing the client's
    parseUtc does)."""
    parsed = datetime.fromisoformat(stamp)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# --- catalog integrity ----------------------------------------------------


def test_catalog_keys_are_unique():
    keys = [drill.key for drill in CATALOG]
    assert len(keys) == len(set(keys))


def test_every_family_is_represented():
    families = {drill.family for drill in CATALOG}
    assert families == set(FAMILY_NAMES)


@pytest.mark.parametrize("drill", CATALOG, ids=lambda d: d.key)
def test_catalog_position_is_legal_and_consistent(drill):
    board = chess.Board(drill.fen)
    assert board.status() == chess.STATUS_VALID, drill.key
    assert not board.is_game_over(), "a drill must start from a playable position"
    assert drill.player_color in {"white", "black"}
    assert drill.goal in {"win", "draw"}
    # The player must actually own a pawn to promote in a "win" drill, and the
    # opponent must own the pawn being held back in a "draw" drill.
    player = chess.WHITE if drill.player_color == "white" else chess.BLACK
    pawn_owner = player if drill.goal == "win" else not player
    assert board.pieces(chess.PAWN, pawn_owner), drill.key


# --- seeding --------------------------------------------------------------


def test_seed_inserts_the_catalog_once(db_session):
    added = seed_drills(db_session)
    assert added == len(CATALOG)
    assert db_session.query(EndgameDrill).count() == len(CATALOG)

    # re-running is a no-op, not a duplicate
    assert seed_drills(db_session) == 0
    assert db_session.query(EndgameDrill).count() == len(CATALOG)


def test_seed_preserves_leitner_state_of_existing_rows(db_session, signed_in_user):
    """Re-seeding must not disturb the per-account scheduling that hangs off a
    catalog row — the state lives in endgame_drill_states now, keyed on the
    drill id, so it only survives if seeding leaves the row itself alone."""
    seed_drills(db_session)
    drill = db_session.query(EndgameDrill).first()
    later = utcnow() + timedelta(days=7)
    state = EndgameDrillState(
        user_id=signed_in_user.id, drill_id=drill.id, box=4, due_at=later
    )
    db_session.add(state)
    db_session.commit()

    seed_drills(db_session)

    db_session.refresh(state)
    assert state.box == 4
    # SQLite's DateTime column drops the tzinfo utcnow() attaches, so compare
    # against the naive value that actually round-trips.
    assert state.due_at == later.replace(tzinfo=None)


def test_startup_seeds_the_catalog(client):
    response = client.get("/endgames/drills")
    assert response.status_code == 200
    assert len(response.json()) == len(CATALOG)


# --- selection ------------------------------------------------------------


def test_next_drill_prefers_the_weakest_family(client):
    drills = client.get("/endgames/drills").json()
    weak = "philidor"

    # Give every family a record — an untouched family counts as 0% and would
    # otherwise outrank the one we're deliberately failing. Only the first
    # drill of each family is attempted, so the rest stay due for selection.
    seen: set[str] = set()
    for drill in drills:
        if drill["family"] in seen:
            continue
        seen.add(drill["family"])
        client.post(
            f"/endgames/{drill['id']}/attempt",
            json={"success": drill["family"] != weak},
        )

    assert len(seen) > 1, "this test needs more than one family"
    assert client.get("/endgames/next").json()["family"] == weak


def test_next_drill_honours_the_family_filter(client):
    family = client.get("/endgames/drills").json()[0]["family"]
    assert client.get(f"/endgames/next?family={family}").json()["family"] == family


def test_next_drill_404s_when_nothing_is_due(client):
    for drill in client.get("/endgames/drills").json():
        client.post(f"/endgames/{drill['id']}/attempt", json={"success": True})
    assert client.get("/endgames/next").status_code == 404


def test_unknown_drill_404s(client):
    assert client.get("/endgames/99999").status_code == 404
    assert (
        client.post("/endgames/99999/attempt", json={"success": True}).status_code == 404
    )


# --- Leitner wiring -------------------------------------------------------


def test_success_advances_the_box(client):
    drill = client.get("/endgames/next").json()
    response = client.post(
        f"/endgames/{drill['id']}/attempt",
        json={"success": True, "moves_played": 12, "outcome": "promoted"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["success"] is True
    assert body["moves_played"] == 12
    assert body["outcome"] == "promoted"
    assert body["box"] == drill["box"] + 1


def test_failure_resets_the_box_and_comes_back_soon(client):
    drill = client.get("/endgames/next").json()
    for _ in range(3):  # climb a few boxes first
        client.post(f"/endgames/{drill['id']}/attempt", json={"success": True})
    climbed = client.get(f"/endgames/{drill['id']}").json()
    assert climbed["box"] > 1
    # the schedule really did stretch out with the box, so the reset below has
    # something to undo
    assert _parse_due(climbed["due_at"]) - utcnow() > timedelta(hours=1)

    before = utcnow()
    body = client.post(
        f"/endgames/{drill['id']}/attempt",
        json={"success": False, "outcome": "pawn-lost"},
    ).json()
    after = utcnow()
    assert body["box"] == 1

    detail = client.get(f"/endgames/{drill['id']}").json()
    assert len(detail["attempts"]) == 4
    assert detail["box"] == 1

    # The response and the persisted row must both say "due again in ten
    # minutes" — the reset is worthless if the drill stays scheduled for next
    # week. Bracketed by the call's own clock readings rather than compared to
    # a constant, so this fails if the endpoint stops applying BOX_INTERVALS.
    for due in (_parse_due(body["due_at"]), _parse_due(detail["due_at"])):
        assert before + BOX_INTERVALS[1] <= due <= after + BOX_INTERVALS[1]
