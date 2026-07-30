"""Adopting the data that predates accounts.

leechess was single-user, so the deployed database is full of rows with no
owner. The ownership columns were added nullable, and the routers treat NULL
as "not yours" — safe, but it means the existing history is invisible until
somebody claims it. This is what claims it, and what stops it claiming too
much.
"""

import chess
import pytest
from sqlalchemy import select

from app.auth.models import User
from app.legacy_ownership import adopt_orphaned_rows
from app.models import (
    EndgameDrill,
    EndgameDrillAttempt,
    Game,
    Move,
    Puzzle,
    PuzzleAttempt,
)

pytestmark = pytest.mark.unit

FEN = chess.STARTING_FEN


@pytest.fixture()
def orphans(db_session):
    """One of everything, as a pre-accounts database would have it."""
    game = Game(pgn="", analysis_status="complete")
    move = Move(ply=1, san="e4", fen_before=FEN, fen_after=FEN)
    game.moves.append(move)
    personal = Puzzle(source_move=move, fen=FEN, solution="e2e4", motif="fork")
    shared = Puzzle(fen=FEN, solution="e2e4", motif="pin", difficulty=1200)
    drill = EndgameDrill(
        key="legacy", family="philidor", name="Legacy", fen=FEN,
        player_color="white", goal="draw", technique="",
    )  # fmt: skip
    db_session.add_all([game, personal, shared, drill])
    db_session.flush()
    db_session.add_all(
        [
            PuzzleAttempt(puzzle_id=shared.id, correct=True),
            EndgameDrillAttempt(drill_id=drill.id, success=True, outcome="held"),
        ]
    )
    db_session.commit()
    return {"game": game, "personal": personal, "shared": shared}


def _make_user(db_session, username: str) -> User:
    user = User(username=username, hashed_password="x", is_verified=True)
    db_session.add(user)
    db_session.commit()
    return user


def test_nothing_is_adopted_when_there_are_no_accounts(db_session, orphans):
    assert adopt_orphaned_rows(db_session) is False
    assert db_session.scalars(select(Game)).one().user_id is None


def test_the_sole_account_adopts_everything_personal(db_session, orphans):
    owner = _make_user(db_session, "owner")

    assert adopt_orphaned_rows(db_session) is True

    db_session.expire_all()
    assert db_session.get(Game, orphans["game"].id).user_id == owner.id
    assert db_session.get(Puzzle, orphans["personal"].id).user_id == owner.id
    assert db_session.scalars(select(PuzzleAttempt)).one().user_id == owner.id
    assert db_session.scalars(select(EndgameDrillAttempt)).one().user_id == owner.id


def test_the_shared_pool_is_never_adopted(db_session, orphans):
    """A generic Lichess import belongs to nobody — claiming it would take it
    out of everyone else's queue."""
    _make_user(db_session, "owner")

    adopt_orphaned_rows(db_session)

    db_session.expire_all()
    assert db_session.get(Puzzle, orphans["shared"].id).user_id is None


def test_nothing_is_adopted_once_there_are_two_accounts(db_session, orphans):
    """No way to tell whose is whose, so the rows stay hidden rather than
    being handed to a guess."""
    _make_user(db_session, "owner")
    _make_user(db_session, "someone-else")

    assert adopt_orphaned_rows(db_session) is False
    assert db_session.scalars(select(Game)).one().user_id is None


def test_adoption_is_idempotent(db_session, orphans):
    owner = _make_user(db_session, "owner")

    assert adopt_orphaned_rows(db_session) is True
    assert adopt_orphaned_rows(db_session) is False  # nothing left to claim

    db_session.expire_all()
    assert db_session.get(Game, orphans["game"].id).user_id == owner.id


def test_registering_claims_the_legacy_rows(anon_client, db_session, orphans):
    """The realistic sequence: deploy the new build first, sign up second.
    Doing this only at boot would leave the owner staring at an empty app
    until the next restart."""
    assert anon_client.get("/games").status_code == 401

    anon_client.post("/auth/register", json={"username": "owner", "password": "correct-horse"})

    listed = anon_client.get("/games").json()
    assert [game["id"] for game in listed] == [orphans["game"].id]


def test_a_second_account_does_not_inherit_the_first_accounts_history(
    anon_client, db_session, orphans
):
    anon_client.post("/auth/register", json={"username": "owner", "password": "correct-horse"})
    anon_client.post("/auth/logout")
    anon_client.post("/auth/register", json={"username": "later", "password": "correct-horse"})

    assert anon_client.get("/games").json() == []
