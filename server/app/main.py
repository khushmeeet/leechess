import asyncio
import contextlib
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.analysis import reset_stale_analyses
from app.auth import router as auth_router
from app.auth.backend import fastapi_users
from app.auth.config import cookie_secure

# Imported for its side effect: registering the users table on Base.metadata
# before create_all runs below.
from app.auth import models as auth_models  # noqa: F401
from app.auth.schemas import UserRead, UserUpdate
from app.db import Base, engine
from app.endgame_drills import seed_catalog
from app.legacy_ownership import claim_legacy_rows
from app.limits import BodySizeLimit
from app.live import sweep_abandoned
from app.routers import endgames, games, live, progress, puzzles, testing, wikibook
from app.seeding import maybe_autoseed

logger = logging.getLogger(__name__)

# How often the abandoned-game sweep runs while the process is up. It used to
# run at boot and never again, which is fine for a machine fly.toml stops when
# idle and useless for one that stays up — the rows it exists to reclaim are
# created by anonymous callers, so "we restart often enough" is not a property
# to lean on.
SWEEP_EVERY_SECONDS = float(os.environ.get("LEECHESS_SWEEP_INTERVAL", str(6 * 60 * 60)))


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
    # Friend games are ephemeral: the ones worth keeping were already forked
    # into Game rows when they ended, so what is left is links nobody took up
    # and boards both players walked away from.
    sweep_abandoned()
    sweeper = asyncio.create_task(_sweep_periodically())
    try:
        yield
    finally:
        sweeper.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await sweeper


async def _sweep_periodically() -> None:
    """Keep sweeping for as long as the process lives.

    In a thread via run_in_executor, not on the loop: sweep_abandoned is
    blocking database work, and it can fork games into Game rows, which is not
    something to do on the one loop serving every live socket.
    """
    while True:
        await asyncio.sleep(SWEEP_EVERY_SECONDS)
        try:
            await asyncio.get_running_loop().run_in_executor(None, sweep_abandoned)
        except Exception:  # a failed sweep must not end the loop
            logger.exception("the abandoned-game sweep failed; will retry")


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

        # Playing without an account is a browser-side mode now, so nothing
        # creates the passwordless "guest" row this flag marked. Dropping it
        # is not housekeeping: it is NOT NULL with only a python-side default,
        # so once the model stops mapping it every insert into users fails —
        # the same trap _move_schedules_off_the_content_rows exists for. The
        # rows themselves are left alone; they are ordinary accounts that
        # happen to have no password, and authenticate already refuses those.
        if "is_guest" in columns_of("users"):
            conn.execute(text("ALTER TABLE users DROP COLUMN is_guest"))
            conn.commit()

        # The session cutoff a password change moves forward (app/auth/
        # backend.py). Added nullable because SQLite cannot ADD COLUMN with a
        # non-constant default, and NULL is the right value anyway: an existing
        # session was minted before any of this and should keep working until
        # its owner changes their password.
        if "sessions_valid_from" not in columns_of("users"):
            conn.execute(text("ALTER TABLE users ADD COLUMN sessions_valid_from DATETIME"))
            conn.commit()

        # Games used to be shown by row id, which counts everybody's games at
        # once. The per-account number replaces it; existing games are dealt
        # their numbers here, once, in the order they were played.
        if "number" not in columns_of("games"):
            conn.execute(text("ALTER TABLE games ADD COLUMN number INTEGER"))
            conn.commit()
            _number_the_saved_games(conn)

        _move_schedules_off_the_content_rows(conn, columns_of)


def _number_the_saved_games(conn) -> None:
    """Backfill Game.number: 1..N per account, oldest first.

    Unfinished games are skipped — they are numbered when they complete, and
    most of them never will be. Rows with no owner are numbered as one
    sequence of their own: pre-accounts data is all one person's, and
    adopt_orphaned_rows is what eventually hands it over (it renumbers what it
    adopts, so nothing here has to guess who that will be).
    """
    from sqlalchemy import text

    rows = conn.execute(
        text(
            "SELECT id, user_id FROM games WHERE analysis_status != 'pending' "
            "ORDER BY created_at, id"
        )
    ).all()
    counters: dict[object, int] = {}
    for game_id, user_id in rows:
        counters[user_id] = counters.get(user_id, 0) + 1
        conn.execute(
            text("UPDATE games SET number = :number WHERE id = :id"),
            {"number": counters[user_id], "id": game_id},
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


# One header, spelled out, because most of it is load-bearing and the one
# concession in it is worth being honest about.
#
# `script-src` has to carry 'unsafe-inline': app.html runs an inline script to
# set the theme before first paint, and SvelteKit's own bootstrap is inline and
# rebuilt (with a new hash) on every build, so neither a hash nor a nonce is
# available to a server that only hands out static files. What the directive
# still buys is that no *external* origin can be a script source, which is the
# half a stolen page tries to use.
#
# 'wasm-unsafe-eval' is stockfish.wasm; worker-src is the Web Worker it runs
# in. The rest is the part that actually holds: nothing may frame this app,
# no <base> may be injected, no plugin content, forms may only post here, and
# `connect-src 'self'` means script that does get in has nowhere to send what
# it finds.
CONTENT_SECURITY_POLICY = "; ".join(
    (
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "object-src 'none'",
        "form-action 'self'",
    )
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """COOP/COEP are required for SharedArrayBuffer, which multi-threaded
    stockfish.wasm depends on. The rest is the ordinary set this app was
    serving none of. Applied to every response so the static frontend mount
    (added at deploy time) is covered too."""
    response = await call_next(request)
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
    response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    response.headers["X-Content-Type-Options"] = "nosniff"
    # Review URLs carry a game id, and a friend link *is* the credential for a
    # game — neither belongs in a Referer sent to wikibooks.org.
    response.headers["Referrer-Policy"] = "no-referrer"
    # frame-ancestors covers this for anything current; kept for the browsers
    # that only understand the old spelling.
    response.headers["X-Frame-Options"] = "DENY"
    if cookie_secure():
        # Tied to the same switch as the session cookie, so `make dev` and the
        # browser suite — both plain http on localhost — are not told to pin
        # themselves to https for the next two years.
        response.headers["Strict-Transport-Security"] = (
            "max-age=63072000; includeSubDomains"
        )
    return response


# Added after the header middleware, which puts it *outside* it (Starlette
# builds the stack in reverse): an over-long body is refused before anything
# downstream has a chance to read it into memory.
app.add_middleware(BodySizeLimit)


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
app.include_router(live.router)
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


# GET /debug/engine used to live here: a Phase-0 check that native Stockfish
# worked, taking a caller-supplied FEN and search depth. It outlived its
# purpose (the analysis job is the real answer) and was a poor thing to leave
# reachable — no account needed, a native engine process spawned per call, and
# none of the concurrency ceiling app/analysis.py is careful to put around
# exactly that work. `make test` covers the engine, and GET /healthz covers
# "is it up".


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
