"""Endgame drills: catalog integrity, seeding, selection, Leitner wiring.

The engine-marked test at the bottom is the important one — it is what stops a
mistyped FEN from shipping a "win" drill that is actually drawn.
"""

import shutil
from datetime import timedelta

import chess
import chess.engine
import pytest

from app.endgame_drills import CATALOG, FAMILY_NAMES, seed_drills
from app.models import EndgameDrill, utcnow
from app.spaced_repetition import BOX_INTERVALS

pytestmark = pytest.mark.unit

# Same lookup test_engine.py uses; Debian installs the binary into /usr/games,
# which the Dockerfile adds to PATH.
STOCKFISH = shutil.which("stockfish")


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


def test_seed_preserves_leitner_state_of_existing_rows(db_session):
    seed_drills(db_session)
    drill = db_session.query(EndgameDrill).first()
    drill.box = 4
    later = utcnow() + timedelta(days=7)
    drill.due_at = later
    db_session.commit()

    seed_drills(db_session)

    db_session.refresh(drill)
    assert drill.box == 4
    # SQLite's DateTime column drops the tzinfo utcnow() attaches, so compare
    # against the naive value that actually round-trips.
    assert drill.due_at == later.replace(tzinfo=None)


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
    assert client.get(f"/endgames/{drill['id']}").json()["box"] > 1

    body = client.post(
        f"/endgames/{drill['id']}/attempt",
        json={"success": False, "outcome": "pawn-lost"},
    ).json()
    assert body["box"] == 1

    detail = client.get(f"/endgames/{drill['id']}").json()
    assert len(detail["attempts"]) == 4
    # box 1 means due again within the hour, not tomorrow
    assert BOX_INTERVALS[1] < timedelta(hours=1)


# --- engine verification --------------------------------------------------

# Deep enough that these simple endings are read exactly; shallower searches
# can still call a theoretically drawn K+P position "winning".
VERIFY_DEPTH = 30
# This is a typo detector, not a precision instrument: a mistyped FEN reads
# near zero (or negative), nowhere near three pawns. Some drills only resolve
# to a mate score several plies deeper than VERIFY_DEPTH — rook-pawn-cut-off
# is mate-in-31 but reads ~+490 here — so don't demand a mate score.
WINNING_CP = 300
# A "draw" drill must sit on the drawn line, not "nearly holdable".
DRAWN_CP = 60


@pytest.mark.engine
@pytest.mark.skipif(STOCKFISH is None, reason="stockfish binary not in PATH")
@pytest.mark.parametrize("drill", CATALOG, ids=lambda d: d.key)
def test_catalog_position_matches_its_goal(drill):
    """Every drill's stated goal must be the position's actual truth.

    Without this, a transposed FEN character ships a drill nobody can pass and
    the Leitner box just keeps resetting to 1.
    """
    board = chess.Board(drill.fen)
    player = chess.WHITE if drill.player_color == "white" else chess.BLACK
    with chess.engine.SimpleEngine.popen_uci(STOCKFISH) as engine:
        info = engine.analyse(board, chess.engine.Limit(depth=VERIFY_DEPTH))
    score = info["score"].pov(player)

    if drill.goal == "win":
        assert score.is_mate() or (score.score() or 0) > WINNING_CP, (
            f"{drill.key} is declared winning but evaluates {score}"
        )
        assert not score.is_mate() or score.mate() > 0, (
            f"{drill.key} is declared winning but the player is getting mated"
        )
    else:
        assert not score.is_mate(), f"{drill.key} is declared drawn but evaluates {score}"
        assert abs(score.score() or 0) <= DRAWN_CP, (
            f"{drill.key} is declared drawn but evaluates {score}"
        )
