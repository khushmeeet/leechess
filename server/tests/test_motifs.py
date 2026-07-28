"""Rule-based motif detector tests — game-level wiring on top of the detector.

The detector's own (position, move) → exact-motif-set table lives in
shared/motifs.json and runs through BOTH this implementation and the client's
chess.js port; see test_motif_parity.py. Kept here: which (position, move)
pairs the analysis job actually asks about, and how the tags get stored.

When manual game validation finds a false positive/negative, add it to the
shared fixture as a regression case BEFORE fixing the rule — that way the
client port has to agree with the fix too.
"""

import chess
import pytest
from sqlalchemy import select

from app.models import Game, MotifTag, Move
from app.motifs import apply_rule_based_tags, tags_for_move

pytestmark = pytest.mark.unit


# --- tags_for_move: which (position, move) pairs get stored tags ---

# 3.Qxe5+?? hangs the queen to 3...Nxe5 — the same scripted game as
# test_analysis_job.py and the Playwright review spec's motif test.
HUNG_QUEEN_SANS = ["e4", "e5", "Qh5", "Nc6", "Qxe5+", "Nxe5"]


def hung_queen_rows() -> list[dict]:
    """(fen_before, san, uci, fen_after) for each ply of the scripted game."""
    board = chess.Board()
    rows = []
    for san in HUNG_QUEEN_SANS:
        move = board.parse_san(san)
        row = {"fen_before": board.fen(), "san": san, "uci": move.uci()}
        board.push(move)
        row["fen_after"] = board.fen()
        rows.append(row)
    return rows


def test_blunder_is_tagged_with_the_tactic_it_allowed():
    qxe5 = hung_queen_rows()[4]
    tags = tags_for_move(
        fen_before=qxe5["fen_before"],
        fen_after=qxe5["fen_after"],
        played_san="Qxe5+",
        best_move_uci="b1c3",  # engine preferred a quiet move
        classification="blunder",
        opponent_best_uci="c6e5",  # ...which now wins the queen
    )
    assert tags == ["hanging_piece"]


def test_unflagged_move_gets_no_allowed_tactic_tags():
    qxe5 = hung_queen_rows()[4]
    tags = tags_for_move(
        fen_before=qxe5["fen_before"],
        fen_after=qxe5["fen_after"],
        played_san="Qxe5+",
        best_move_uci="b1c3",
        classification="good",  # hypothetical: not flagged → nothing stored
        opponent_best_uci="c6e5",
    )
    assert tags == []


def test_playing_the_best_tactical_move_is_tagged_as_executed():
    nxe5 = hung_queen_rows()[5]
    tags = tags_for_move(
        fen_before=nxe5["fen_before"],
        fen_after=nxe5["fen_after"],
        played_san="Nxe5",
        best_move_uci="c6e5",  # played == best, and it wins the hung queen
        classification="best",
        opponent_best_uci="g1f3",
    )
    assert tags == ["hanging_piece"]


def test_unanalyzed_move_gets_no_tags():
    e4 = hung_queen_rows()[0]
    tags = tags_for_move(
        fen_before=e4["fen_before"],
        fen_after=e4["fen_after"],
        played_san="e4",
        best_move_uci=None,
        classification=None,
        opponent_best_uci=None,
    )
    assert tags == []


# --- apply_rule_based_tags: game-level wiring, re-runnable, keeps manual ---

ANALYSIS_BY_PLY = {
    1: ("e2e4", "best"),
    2: ("e7e5", "best"),
    3: ("g1f3", "inaccuracy"),  # Qh5 wasn't best but isn't flagged either
    4: ("b8c6", "best"),
    5: ("b1c3", "blunder"),  # Qxe5+?? — best was a quiet move
    6: ("c6e5", "best"),  # Nxe5 takes the hung queen
}


def analyzed_hung_queen_game() -> Game:
    game = Game(pgn="", white="w", black="b", analysis_status="complete")
    for ply, row in enumerate(hung_queen_rows(), start=1):
        best, classification = ANALYSIS_BY_PLY[ply]
        game.moves.append(
            Move(
                ply=ply,
                san=row["san"],
                fen_before=row["fen_before"],
                fen_after=row["fen_after"],
                best_move=best,
                classification=classification,
            )
        )
    return game


def test_apply_rule_based_tags_tags_blunder_and_punish(db_session):
    game = analyzed_hung_queen_game()
    db_session.add(game)
    apply_rule_based_tags(game)
    db_session.commit()

    by_ply = {move.ply: move.motifs for move in game.moves}
    assert by_ply == {1: [], 2: [], 3: [], 4: [], 5: ["hanging_piece"], 6: ["hanging_piece"]}


def test_apply_rule_based_tags_is_idempotent_and_keeps_manual_tags(db_session):
    game = analyzed_hung_queen_game()
    db_session.add(game)
    apply_rule_based_tags(game)
    game.moves[4].motif_tags.append(MotifTag(motif="pin", source="manual"))
    db_session.commit()

    apply_rule_based_tags(game)  # re-run, as scripts/retag.py would
    db_session.commit()

    blunder = game.moves[4]
    assert blunder.motifs == ["hanging_piece", "pin"]  # no duplicates
    assert {tag.motif: tag.source for tag in blunder.motif_tags} == {
        "hanging_piece": "rule_based",
        "pin": "manual",
    }
    # tags survive in the database, not just on the in-memory objects
    stored = db_session.scalars(
        select(MotifTag).join(Move).where(Move.game_id == game.id)
    ).all()
    assert sorted(tag.motif for tag in stored) == ["hanging_piece", "hanging_piece", "pin"]


def test_review_endpoint_exposes_motifs(client, db_session):
    game_id = client.post("/games", json={}).json()["id"]
    client.post(f"/games/{game_id}/moves", json={"san": "e4"})
    move = db_session.scalars(select(Move).where(Move.game_id == game_id)).one()
    move.motif_tags.append(MotifTag(motif="fork"))
    db_session.commit()

    body = client.get(f"/games/{game_id}/review").json()
    assert body["moves"][0]["motifs"] == ["fork"]
