"""Lichess puzzle CSV import — against a small checked-in sample, never the
real multi-million-row dump (no network, no giant files in the suite).

The sample covers: theme mapping, a row whose themes should all be dropped
(skipped entirely), a row with several mappable themes (first one wins),
the opponent-setup-move convention, and one unparseable row."""

import chess
import pytest
from sqlalchemy import select

from app.lichess_import import (
    THEME_TO_MOTIF,
    import_csv,
    import_rows,
    puzzle_from_row,
)
from app.models import Puzzle
from tests.conftest import FIXTURES

pytestmark = pytest.mark.unit

SAMPLE = FIXTURES / "lichess_puzzles_sample.csv"


def test_import_maps_themes_and_drops_the_rest(db_session):
    counts = import_csv(SAMPLE, db_session)

    # DROPPED (no mappable theme) and BADFEN (unparseable) are both skipped
    assert counts == {"fork": 2, "back_rank_mate": 1, "hanging_piece": 1}
    puzzles = db_session.scalars(select(Puzzle)).all()
    assert len(puzzles) == 4
    assert all(p.source_move_id is None for p in puzzles)  # generic pool


def test_fen_is_the_position_after_the_opponents_setup_move(db_session):
    """Lichess's FEN column is one move BEFORE the puzzle: Moves[0] is the
    opponent playing into it, the stored solution starts at Moves[1]."""
    import_csv(SAMPLE, db_session)
    puzzle = db_session.scalars(
        select(Puzzle).where(Puzzle.motif == "back_rank_mate")
    ).one()

    board = chess.Board("6k1/5ppp/8/8/8/8/8/4R1K1 b - - 0 1")
    board.push_uci("g8h8")
    assert puzzle.fen == board.fen()
    assert puzzle.solution == "e1e8"
    assert puzzle.difficulty == 900  # Rating column


def test_first_mappable_theme_wins_when_several_map(db_session):
    import_csv(SAMPLE, db_session)
    multi = db_session.scalars(select(Puzzle).where(Puzzle.fen.contains("3q4"))).all()
    # MULTI row lists "hangingPiece fork ..." — hangingPiece maps first
    queen_hang = db_session.scalars(
        select(Puzzle).where(Puzzle.motif == "hanging_piece")
    ).one()
    assert queen_hang.solution == "d1d4"
    assert multi is not None  # row imported exactly once overall


def test_max_per_motif_caps_the_pool(db_session):
    counts = import_csv(SAMPLE, db_session, max_per_motif=1)
    assert counts["fork"] == 1


def test_cap_counts_puzzles_already_in_the_pool(db_session):
    """Re-runs top a motif up to the cap, not add another cap's worth."""
    db_session.add(Puzzle(fen="pre-existing", solution="a1a2", motif="fork"))
    db_session.commit()

    counts = import_csv(SAMPLE, db_session, max_per_motif=1)
    # fork is already full; the sample's two fork rows are both skipped
    assert counts == {"back_rank_mate": 1, "hanging_piece": 1}


def test_import_stops_reading_once_every_motif_is_full(db_session):
    """Streamed callers (app/seeding.py) rely on this to abort the network
    download early instead of scanning millions of leftover rows."""
    for i, motif in enumerate(sorted(set(THEME_TO_MOTIF.values()))):
        if motif != "fork":
            db_session.add(Puzzle(fen=f"fen-{i}", solution="a1a2", motif=motif))
    db_session.commit()

    def rows():
        yield {
            "PuzzleId": "F",
            "FEN": "r3k3/1p6/8/1N6/8/8/8/4K3 b - - 0 1",
            "Moves": "b7b6 b5c7",
            "Rating": "1200",
            "Themes": "fork",
        }
        raise AssertionError("kept reading after every motif was capped")

    counts = import_rows(rows(), db_session, max_per_motif=1)
    assert counts == {"fork": 1}


def test_reimport_is_idempotent(db_session):
    import_csv(SAMPLE, db_session)
    counts = import_csv(SAMPLE, db_session)
    assert counts == {}
    assert len(db_session.scalars(select(Puzzle)).all()) == 4


def test_every_mapped_motif_is_in_the_fixed_taxonomy():
    taxonomy = {
        "fork", "pin", "skewer", "discovered_attack", "discovered_check",
        "double_check", "back_rank_mate", "removing_the_defender",
        "overloading", "deflection", "x_ray_attack", "zwischenzug",
        "trapped_piece", "hanging_piece",
    }  # fmt: skip
    assert set(THEME_TO_MOTIF.values()) <= taxonomy


def test_row_with_illegal_setup_move_is_skipped():
    row = {
        "PuzzleId": "X",
        "FEN": chess.STARTING_FEN,
        "Moves": "e2e5 e7e5",  # e2e5 is not a legal pawn move
        "Rating": "1000",
        "Themes": "fork",
    }
    assert puzzle_from_row(row) is None
