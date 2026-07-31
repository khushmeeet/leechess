import os
from contextlib import asynccontextmanager
from pathlib import Path

import chess
import chess.engine
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.analysis import reset_stale_analyses, stockfish_binary
from app.auth import router as auth_router
from app.auth.backend import fastapi_users

# Imported for its side effect: registering the users table on Base.metadata
# before create_all runs below.
from app.auth import models as auth_models  # noqa: F401
from app.auth.schemas import UserRead, UserUpdate
from app.db import Base, engine
from app.endgame_drills import seed_catalog
from app.legacy_ownership import claim_legacy_rows
from app.routers import endgames, games, progress, puzzles, testing, wikibook
from app.seeding import maybe_autoseed


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Analysis jobs run via BackgroundTasks and die with the process (the Fly
    # machine auto-stops) — sweep any rows they orphaned mid-"analyzing".
    reset_stale_analyses()
    # Seed the generic puzzle pool from the Lichess dump (background
    # thread; gated on LEECHESS_AUTO_SEED=on) until a run has completed —
    # an interrupted run resumes on the next restart.
    maybe_autoseed()
    # The endgame-drill catalog is a fixed dozen rows — insert the ones this
    # database doesn't have yet, leaving the Leitner state of the rest alone.
    seed_catalog()
    # Data written before accounts existed has no owner. If the sole account
    # is already there (a restart after signing up), hand it over; otherwise
    # the same call runs again when that account is created.
    claim_legacy_rows()
    yield


app = FastAPI(title="leechess", lifespan=lifespan)

Base.metadata.create_all(bind=engine)


def _migrate_existing_tables(bind=None) -> None:
    """create_all never alters tables that already exist, and there is no
    alembic here — columns added after a database was first created get a
    hand-rolled ALTER, guarded so re-runs are no-ops.

    Takes a bind so tests can run it against a database built with an older
    schema; the suite otherwise only ever sees a fresh create_all, where none
    of this has anything to do.
    """
    from sqlalchemy import text

    with (bind or engine).connect() as conn:

        def columns_of(table: str) -> set[str]:
            return {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}

        if "user_color" not in columns_of("games"):
            conn.execute(
                text(
                    "ALTER TABLE games ADD COLUMN user_color VARCHAR "
                    "NOT NULL DEFAULT 'white'"
                )
            )
            conn.commit()

        # Ownership. SQLite only allows ADD COLUMN with a NULL default when a
        # REFERENCES clause is attached, which is what we want anyway: rows
        # written before accounts existed have no owner, and the routers treat
        # NULL as "not yours" — an un-adopted row is invisible, never public.
        for table in ("games", "puzzles", "puzzle_attempts", "endgame_drill_attempts"):
            if "user_id" not in columns_of(table):
                conn.execute(
                    text(
                        f"ALTER TABLE {table} ADD COLUMN user_id CHAR(36) "
                        "REFERENCES users(id)"
                    )
                )
                conn.commit()

        _move_schedules_off_the_content_rows(conn, columns_of)
        _leave_guests_out_of_the_username_index(conn)


_USERNAME_INDEX = "ix_users_username_canonical"


def _leave_guests_out_of_the_username_index(conn) -> None:
    """The unique index on username_canonical used to cover every row. Guest
    names are labels now — several browsers can be playing as `guest1` — so it
    covers only the accounts that can be signed in to.

    create_all builds the partial index on a fresh database and ignores a
    users table that already exists, so a database with history is the only
    one that reaches the rewrite below. Existing rows cannot conflict with the
    narrower index: they were unique under the wider one.
    """
    from sqlalchemy import text

    existing = conn.execute(
        text("SELECT sql FROM sqlite_master WHERE type='index' AND name=:name"),
        {"name": _USERNAME_INDEX},
    ).scalar()
    if existing is not None and "is_guest" in existing:
        return  # already narrowed
    if existing is not None:
        conn.execute(text(f"DROP INDEX {_USERNAME_INDEX}"))
    conn.execute(
        text(
            f"CREATE UNIQUE INDEX {_USERNAME_INDEX} "
            "ON users (username_canonical) WHERE is_guest = 0"
        )
    )
    conn.commit()


# (content table, state table, foreign key, attempts table, attempts FK)
_SCHEDULE_MOVES = (
    ("puzzles", "puzzle_states", "puzzle_id", "puzzle_attempts", "puzzle_id"),
    (
        "endgame_drills",
        "endgame_drill_states",
        "drill_id",
        "endgame_drill_attempts",
        "drill_id",
    ),
)


def _move_schedules_off_the_content_rows(conn, columns_of) -> None:
    """Leitner state used to live on the puzzle and drill rows; it is per
    account now, so those columns have to go.

    Dropping them is not optional housekeeping. They are NOT NULL with only a
    python-side default, so once the models stop mapping them SQLAlchemy sends
    no value and *every* insert fails — which on a database with history means
    no new puzzle can ever be generated again.

    The existing schedule is real progress, so it is lifted into state rows
    first, with no owner: there may well be no account yet at this point (a
    deploy happens before anyone signs up), and adopt_orphaned_rows claims
    these along with everything else. Only rows with attempt history are
    carried — for the rest, "no state row" already means box 1, due now.
    """
    from sqlalchemy import text

    for content, state, fk, attempts, attempts_fk in _SCHEDULE_MOVES:
        if "box" not in columns_of(content):
            continue  # already migrated, or a database created after this
        conn.execute(
            text(
                f"INSERT INTO {state} (user_id, {fk}, box, due_at) "
                f"SELECT NULL, c.id, c.box, c.due_at FROM {content} AS c "
                f"WHERE c.id IN (SELECT DISTINCT {attempts_fk} FROM {attempts})"
            )
        )
        for column in ("box", "due_at"):
            conn.execute(text(f"ALTER TABLE {content} DROP COLUMN {column}"))
        conn.commit()


_migrate_existing_tables()


@app.middleware("http")
async def cross_origin_isolation_headers(request: Request, call_next):
    """Required for SharedArrayBuffer, which multi-threaded stockfish.wasm
    depends on. Applies to every response so the static frontend mount
    (added at deploy time) is covered too."""
    response = await call_next(request)
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
    return response


# Only the dev SPA and the preview server the browser suite builds. A deploy
# serves the SPA from this same process (see the mount at the bottom), so it
# has no cross-origin caller and gets an empty list: shipping localhost
# origins alongside allow_credentials would leave a page on a developer's own
# machine able to read a signed-in user's data, if SameSite ever loosened.
_DEV_ORIGINS = ["http://localhost:5173", "http://localhost:4173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[] if os.environ.get("LEECHESS_STATIC_DIR") else _DEV_ORIGINS,
    # The session cookie: in dev the SPA is a different origin to this API, so
    # without this the browser sends no credentials and every request looks
    # signed out. Safe alongside an explicit origin list — Starlette echoes the
    # matching origin and never pairs credentials with a wildcard.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

auth_router.register_error_handlers(app)
app.include_router(auth_router.router)
# PATCH /users/me, which is how a username gets changed. The register, reset
# and verify routers are deliberately not mounted: all three are built around
# an email address, and this app has neither the column nor a way to send mail.
app.include_router(
    fastapi_users.get_users_router(UserRead, UserUpdate), prefix="/users", tags=["users"]
)

app.include_router(games.router)
app.include_router(puzzles.router)
app.include_router(progress.router)
app.include_router(endgames.router)
app.include_router(wikibook.router)

# Test-support only: the truncate endpoint the browser suite uses to give each
# spec a clean database. Off by default, so these paths simply do not exist in
# a normal dev run or a deploy.
if testing.enabled():
    app.include_router(testing.router)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/debug/engine")
def debug_engine(fen: str = chess.STARTING_FEN, depth: int = 12) -> dict:
    """Confirms native Stockfish works via python-chess wherever the server
    runs (Phase 0 plumbing check — becomes the analysis job in Phase 1)."""
    binary = stockfish_binary()
    if binary is None:
        raise HTTPException(status_code=500, detail="stockfish not in PATH")
    try:
        board = chess.Board(fen)
    except ValueError:
        raise HTTPException(status_code=422, detail="invalid FEN")
    with chess.engine.SimpleEngine.popen_uci(binary) as sf:
        info = sf.analyse(board, chess.engine.Limit(depth=min(depth, 20)))
    score = info["score"].white()
    return {
        "binary": binary,
        "depth": info.get("depth"),
        "score_white": str(score),
        "cp": score.score(mate_score=100_000),
        "best_move": str(info["pv"][0]) if info.get("pv") else None,
    }


# In production the SvelteKit SPA build is served from here (one Fly machine,
# one process). Routes above take priority; anything else falls back to
# index.html so client-side routes like /review/3 deep-link correctly.
class SpaStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise
        if response.status_code == 404:
            return await super().get_response("index.html", scope)
        return response


static_dir = Path(os.environ.get("LEECHESS_STATIC_DIR", "static"))
if static_dir.is_dir():
    app.mount("/", SpaStaticFiles(directory=static_dir, html=True), name="spa")
