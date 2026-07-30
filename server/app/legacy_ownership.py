"""Hand the pre-accounts data to its owner, once there is exactly one.

leechess was single-user before accounts: whoever's games are in the database,
they are all the same person's. The ownership columns were added nullable
(app/main.py's migration), so those rows arrive with user_id NULL — and the
routers treat NULL as "not yours", which means an un-adopted row is invisible
rather than public. Safe, but only useful if it eventually finds its owner.

This runs at boot and again when an account is created, because neither alone
covers the real sequence: deploying the new build leaves nobody to adopt into,
and the owner signing up afterwards would otherwise find an empty app until
the next restart.

With no accounts there is nobody to adopt into; with two or more there is no
way to tell whose is whose. In both cases the rows stay NULL rather than being
handed to a guess.
"""

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.auth.models import User
from app.db import SessionLocal
from app.models import EndgameDrillAttempt, Game, Puzzle, PuzzleAttempt

# Module-level alias, patched by tests/conftest.py the same way analysis,
# seeding and endgame_drills are — anything that opens its own session outside
# a request has to be redirectable at the throwaway engine, and
# tests/test_isolation.py fails the run if a new one is missed.
session_factory = SessionLocal


def adopt_orphaned_rows(db: Session) -> bool:
    """True if anything was adopted. Idempotent — a second run matches no rows."""
    if db.scalar(select(func.count()).select_from(User)) != 1:
        return False
    owner = db.scalars(select(User.id)).one()

    adopted = 0
    for model in (Game, PuzzleAttempt, EndgameDrillAttempt):
        result = db.execute(
            update(model).where(model.user_id.is_(None)).values(user_id=owner)
        )
        adopted += result.rowcount or 0

    # Generic Lichess imports are the shared pool and must stay unowned;
    # only puzzles generated from a game get adopted.
    result = db.execute(
        update(Puzzle)
        .where(Puzzle.user_id.is_(None), Puzzle.source_move_id.is_not(None))
        .values(user_id=owner)
    )
    adopted += result.rowcount or 0

    if adopted:
        db.commit()
    return adopted > 0


def claim_legacy_rows() -> bool:
    """adopt_orphaned_rows on a session of its own, for the app lifespan."""
    with session_factory() as db:
        return adopt_orphaned_rows(db)
