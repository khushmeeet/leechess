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
from app.db import Base, engine
from app.routers import games, progress, puzzles, wikibook
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
    yield


app = FastAPI(title="leechess", lifespan=lifespan)

Base.metadata.create_all(bind=engine)


def _migrate_existing_tables() -> None:
    """create_all never alters tables that already exist, and there is no
    alembic here — columns added after a database was first created get a
    hand-rolled ALTER, guarded so re-runs are no-ops."""
    from sqlalchemy import text

    with engine.connect() as conn:
        columns = {row[1] for row in conn.execute(text("PRAGMA table_info(games)"))}
        if "user_color" not in columns:
            conn.execute(
                text(
                    "ALTER TABLE games ADD COLUMN user_color VARCHAR "
                    "NOT NULL DEFAULT 'white'"
                )
            )
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


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(games.router)
app.include_router(puzzles.router)
app.include_router(progress.router)
app.include_router(wikibook.router)


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
