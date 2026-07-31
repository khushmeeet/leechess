"""The hand-rolled migration, against a database built the way the old one was.

Every other test starts from create_all, where the current models are the only
schema that has ever existed — so nothing else in the suite can see what
happens to the database already sitting on the volume. That gap is how the
dropped box/due_at columns got missed: they are NOT NULL with a python-side
default, so the moment the models stopped mapping them, every insert on a
pre-existing database failed.
"""

import sqlite3

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.legacy_ownership import adopt_orphaned_rows
from app.main import _migrate_existing_tables
from app.auth.models import User
from app.db import Base
from app.models import EndgameDrillState, Puzzle, PuzzleState

pytestmark = pytest.mark.unit

# The pre-accounts schema, as of the commit before ownership landed: no
# user_id anywhere, and Leitner state on the content rows.
OLD_SCHEMA = """
CREATE TABLE games (
    id INTEGER NOT NULL PRIMARY KEY, pgn TEXT NOT NULL,
    white VARCHAR NOT NULL, black VARCHAR NOT NULL, result VARCHAR NOT NULL,
    mode VARCHAR NOT NULL, created_at DATETIME NOT NULL,
    analysis_status VARCHAR NOT NULL
);
CREATE TABLE moves (
    id INTEGER NOT NULL PRIMARY KEY, game_id INTEGER NOT NULL,
    ply INTEGER NOT NULL, san VARCHAR NOT NULL,
    fen_before VARCHAR NOT NULL, fen_after VARCHAR NOT NULL
);
CREATE TABLE puzzles (
    id INTEGER NOT NULL PRIMARY KEY, source_move_id INTEGER,
    fen VARCHAR NOT NULL, solution VARCHAR NOT NULL, motif VARCHAR NOT NULL,
    difficulty INTEGER, box INTEGER NOT NULL, due_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL
);
CREATE TABLE puzzle_attempts (
    id INTEGER NOT NULL PRIMARY KEY, puzzle_id INTEGER NOT NULL,
    correct BOOLEAN NOT NULL, hint_level_used INTEGER NOT NULL,
    attempted_at DATETIME NOT NULL
);
CREATE TABLE endgame_drills (
    id INTEGER NOT NULL PRIMARY KEY, key VARCHAR NOT NULL UNIQUE,
    family VARCHAR NOT NULL, name VARCHAR NOT NULL, fen VARCHAR NOT NULL,
    player_color VARCHAR NOT NULL, goal VARCHAR NOT NULL, technique TEXT NOT NULL,
    box INTEGER NOT NULL, due_at DATETIME NOT NULL, created_at DATETIME NOT NULL
);
CREATE TABLE endgame_drill_attempts (
    id INTEGER NOT NULL PRIMARY KEY, drill_id INTEGER NOT NULL,
    success BOOLEAN NOT NULL, moves_played INTEGER NOT NULL,
    outcome VARCHAR NOT NULL, attempted_at DATETIME NOT NULL
);

INSERT INTO games VALUES (1, '', 'me', 'Stockfish', '1-0', 'engine', '2026-01-01', 'complete');
INSERT INTO moves VALUES (1, 1, 1, 'e4', '8/8/8/8/8/8/8/K6k w - - 0 1', '8/8/8/8/8/8/8/K6k b - - 0 1');

-- one drilled personal puzzle (box 4), one untouched generic import
INSERT INTO puzzles VALUES (1, 1, 'f1', 'e2e4', 'fork', NULL, 4, '2030-01-01', '2026-01-01');
INSERT INTO puzzles VALUES (2, NULL, 'f2', 'e2e4', 'pin', 1200, 1, '2026-01-01', '2026-01-01');
INSERT INTO puzzle_attempts VALUES (1, 1, 1, 0, '2026-01-02');

INSERT INTO endgame_drills VALUES (1, 'lucena', 'lucena', 'Lucena', 'f3', 'white', 'win', '', 3, '2030-02-01', '2026-01-01');
INSERT INTO endgame_drill_attempts VALUES (1, 1, 1, 12, 'promoted', '2026-01-02');
"""


@pytest.fixture()
def legacy_engine(tmp_path):
    """A database as it exists on the volume today, then brought forward."""
    path = tmp_path / "legacy.db"
    con = sqlite3.connect(path)
    con.executescript(OLD_SCHEMA)
    con.commit()
    con.close()

    engine = create_engine(
        f"sqlite:///{path}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(bind=engine)  # adds users, the state tables, …
    _migrate_existing_tables(bind=engine)
    try:
        yield engine
    finally:
        engine.dispose()


def _columns(engine, table: str) -> set[str]:
    with engine.connect() as conn:
        return {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}


def test_ownership_columns_are_added(legacy_engine):
    for table in ("games", "puzzles", "puzzle_attempts", "endgame_drill_attempts"):
        assert "user_id" in _columns(legacy_engine, table), table


def test_the_scheduling_columns_are_gone(legacy_engine):
    """They are NOT NULL with no server default, so leaving them behind makes
    every insert fail — see the next test."""
    for table in ("puzzles", "endgame_drills"):
        assert "box" not in _columns(legacy_engine, table), table
        assert "due_at" not in _columns(legacy_engine, table), table


def test_a_new_puzzle_can_still_be_inserted(legacy_engine):
    """The regression that started all this. On the deployed database this
    raised NOT NULL constraint failed: puzzles.box, which would have broken
    puzzle generation for every game played after the upgrade."""
    with Session(legacy_engine) as db:
        db.add(Puzzle(fen="f3", solution="e2e4", motif="skewer"))
        db.commit()
        assert len(db.scalars(select(Puzzle)).all()) == 3


def test_the_existing_schedule_is_carried_over_unowned(legacy_engine):
    """Box 4 on a puzzle is weeks of spaced repetition; resetting it to 1
    would quietly throw that away."""
    with Session(legacy_engine) as db:
        state = db.scalars(select(PuzzleState)).one()
        assert (state.puzzle_id, state.box) == (1, 4)
        assert state.user_id is None  # nobody to own it yet

        drill_state = db.scalars(select(EndgameDrillState)).one()
        assert (drill_state.drill_id, drill_state.box) == (1, 3)


def test_untouched_puzzles_get_no_state_row(legacy_engine):
    """Puzzle 2 was never attempted, and "no row" already means box 1 due now
    — carrying 6000 default rows across would just be noise."""
    with Session(legacy_engine) as db:
        assert [s.puzzle_id for s in db.scalars(select(PuzzleState))] == [1]


def test_the_first_account_adopts_the_carried_schedule(legacy_engine):
    with Session(legacy_engine) as db:
        owner = User(username="owner", hashed_password="x", is_verified=True)
        db.add(owner)
        db.commit()

        assert adopt_orphaned_rows(db) is True

        db.expire_all()
        assert db.scalars(select(PuzzleState)).one().user_id == owner.id
        assert db.scalars(select(EndgameDrillState)).one().user_id == owner.id


def test_running_the_migration_twice_is_a_no_op(legacy_engine):
    _migrate_existing_tables(bind=legacy_engine)

    with Session(legacy_engine) as db:
        # not duplicated, and nothing blew up on the second pass
        assert len(db.scalars(select(PuzzleState)).all()) == 1


# --- the username index, when guest names stopped being identifiers ---------


@pytest.fixture()
def wide_index_engine(tmp_path):
    """A database from before guests dropped out of the username index: the
    unique index covers every row, guests included.

    Built by create_all and then put back the old way, rather than by hand —
    the users table has a dozen columns from the fastapi-users mixin, and a
    transcribed copy of them would only ever test the transcription.
    """
    path = tmp_path / "wide.db"
    engine = create_engine(
        f"sqlite:///{path}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        conn.execute(text("DROP INDEX ix_users_username_canonical"))
        conn.execute(
            text(
                "CREATE UNIQUE INDEX ix_users_username_canonical "
                "ON users (username_canonical)"
            )
        )
        conn.commit()
    try:
        yield engine
    finally:
        engine.dispose()


def _add_user(engine, username: str, *, guest: bool) -> None:
    with Session(engine) as db:
        db.add(
            User(
                username=username,
                hashed_password=None if guest else "x",
                is_guest=guest,
                is_verified=True,
            )
        )
        db.commit()


def test_two_guests_could_not_share_a_name_before(wide_index_engine):
    """The fixture really is the old world — otherwise the test below proves
    nothing about the migration."""
    _add_user(wide_index_engine, "guest1", guest=True)

    with pytest.raises(IntegrityError):
        _add_user(wide_index_engine, "guest1", guest=True)


def test_two_guests_can_share_a_name_after_migrating(wide_index_engine):
    _migrate_existing_tables(bind=wide_index_engine)

    _add_user(wide_index_engine, "guest1", guest=True)
    _add_user(wide_index_engine, "guest1", guest=True)

    with Session(wide_index_engine) as db:
        assert len(db.scalars(select(User)).all()) == 2


def test_registered_names_are_still_kept_apart(wide_index_engine):
    _migrate_existing_tables(bind=wide_index_engine)
    _add_user(wide_index_engine, "ada", guest=False)

    with pytest.raises(IntegrityError):
        _add_user(wide_index_engine, "ADA", guest=False)


def test_narrowing_the_index_twice_is_a_no_op(wide_index_engine):
    _migrate_existing_tables(bind=wide_index_engine)
    _migrate_existing_tables(bind=wide_index_engine)

    with wide_index_engine.connect() as conn:
        sql = conn.execute(
            text(
                "SELECT sql FROM sqlite_master WHERE type='index' "
                "AND name='ix_users_username_canonical'"
            )
        ).scalar()
    assert "is_guest" in sql
