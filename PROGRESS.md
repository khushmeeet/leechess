# leechess — Progress Log

Tracks build progress against [chess-learning-app-implementation-plan.md](chess-learning-app-implementation-plan.md).
One entry per phase; newest first. Update this doc when a phase's exit criteria are verified.

| Phase | Status | Completed |
|---|---|---|
| 0 — Scaffolding | ✅ Done | 2026-07-04 |
| 1 — Play + basic Review | ✅ Done (one manual check pending, see below) | 2026-07-04 |
| 2 — Motif tagging (rule-based) | Not started | — |
| 3 — Puzzles + spaced repetition | Not started | — |
| 4 — Progress screen | Not started | — |
| 5 — LLM explanations (deferred) | Not started | — |

---

## Phase 1 — Play + basic Review (completed 2026-07-04)

**Goal:** the full live-play loop with real-time classification, plus a Review screen reading
from real analysis data. All automatable exit criteria met and verified; one manual
sanity-check remains (below).

### Backend

- `app/analysis.py` — **single source of truth for classification thresholds** (cp loss from
  the mover's perspective: <10 best, <25 good, <50 inaccuracy, <100 mistake, ≥100 blunder;
  playing the engine's own best move always classifies "best"). Evals stored as centipawns
  from white's perspective, clamped ±1000 (mate → clamp). `run_game_analysis(game_id)`
  background job: one native-Stockfish search per *position* (eval after ply N is reused as
  eval before ply N+1), terminal positions eval'd without the engine, statuses
  `pending → analyzing → complete|failed`. Depth via `LEECHESS_ANALYSIS_DEPTH` (default 18,
  ~300ms/position locally → ~18s for a 60-ply game); binary via `LEECHESS_STOCKFISH` or PATH
- `app/routers/games.py` — live-game lifecycle: `POST /games` (no pgn → start empty game,
  returns id + starting FEN; with pgn → Phase-0 import path), `POST /games/{id}/moves`
  (SAN or UCI, python-chess legality validation server-side, 422 on illegal, 409 after
  completion), `POST /games/{id}/complete` (derives checkmate/stalemate result from the
  board, accepts explicit result for resignations/draws, rebuilds PGN from stored moves,
  enqueues the analysis job via `BackgroundTasks`), `GET /games/{id}/review`,
  `GET /games` (list, newest first)

### Frontend

- `src/lib/classification.ts` — mirrors the server thresholds exactly (cross-referenced
  comments both sides; `test_classification.py` pins the canonical values)
- `src/lib/stores/stockfish.ts` — engine requests now serialized through a promise queue
  (no more busy-throw); `play(fen, skill, movetime)` added for the engine opponent
  (Stockfish "Skill Level" 0–20), `evaluate()` stays full-strength for classification
- `src/lib/stores/play.svelte.ts` — `PlaySession`: mode (local pass-and-play / vs Stockfish
  with 5 strength presets), hint toggle (off / nudge-only) and eval bar toggle (off by
  default per spec), engine warmup + starting baseline eval, live badge per move (eval chain:
  each ply's depth-16 eval is the next ply's baseline, engine-best-move detection), lazy
  server game creation on first move, every move POSTed in order via a separate sync chain
  (fail-soft: server errors stop sync, play continues locally), auto-complete on game end,
  resign/draw controls
- Play screen rebuilt around `PlaySession`; Review screen (`/review/[gameId]`): board shows
  the position *before* the selected move with played-vs-best arrows (red/green via
  chessground `autoShapes`), click-to-jump move list with badge chips, prev/next, hand-rolled
  SVG CPL graph (click-through, phase boundaries at plies 20/60), per-side summary (avg CPL +
  inaccuracy/mistake/blunder counts), "analyzing…" banner with 1.5s polling, failed-analysis
  state; `/review` games list added to the nav

### Testing

- **pytest: 34 passed** (31 unit ~1s, 3 engine). New: `test_classification.py` (threshold
  boundary table), `test_analysis_job.py` (engine marker, depth 8: full job on the shared
  20-ply fixture — every move gets eval/best/classification, eval chain continuous, status
  transitions; Scholar's mate game → mating move eval pinned at clamp), `test_games_api.py`
  extended (start game, legal/illegal SAN+UCI submission, derived vs explicit results,
  double-complete 409, review endpoint, list ordering; unit tests stub the analysis job)
- **Playwright: 7 passed.** `play.e2e.ts`: badge within **500ms** and nudge within **200ms**
  asserted with real timeouts (not waitForTimeout), auto-save/complete flow, vs-Stockfish
  reply; `review.e2e.ts`: API-seeded Scholar's mate → real analysis job at depth 12 → poll
  to `complete` → classifications render (6…Nf6 asserted as blunder), CPL graph + summary,
  click-to-jump + best-move hint; `smoke.e2e.ts` updated for the Review nav link

### Exit criteria — measured results

| Criterion | Result |
|---|---|
| Nudge within 200ms of opponent's move | ✅ asserted `toBeVisible({timeout: 200})` |
| Live classification within 500ms of your move | ✅ asserted `toBeVisible({timeout: 500})` (depth-16 eval, engine pre-warmed on page load) |
| `playwright test` passes, no manual setup | ✅ 7/7 in ~8s |
| `pytest -m "not engine"` fast; full suite before close | ✅ 31 in ~1s; 34/34 full |
| Play 3–5 real games, cross-check vs Lichess analysis | ⚠️ **Pending manual step** — automated proxies pass (known blunder detected, eval chain continuous), but the human sanity-check of CPL graph + thresholds against Lichess hasn't been done yet |

### Gotchas hit (so they aren't re-hit)

- **SQLAlchemy identity-map staleness in tests**: sharing one Session across all requests in
  a test made `db.get(Game, id)` return a cached object that masked the analysis job's
  committed writes — *flakily*, because the identity map is weakly referenced (GC timing).
  Fixed by giving each request its own session in the test fixture, exactly like production
  `get_db`. If a status write ever "disappears" again, suspect a shared session first.
- **npm's `stockfish` package shadows the native binary**: when Playwright spawns uvicorn
  from `bun run`, `client/node_modules/.bin` is on PATH and `shutil.which("stockfish")` finds
  a JS stub ("Could not find stockfish.js") instead of the native engine. Fixed twice over:
  the Playwright webServer env strips node_modules from PATH, and `LEECHESS_STOCKFISH` can
  pin an explicit binary path.
- **Playwright `reuseExistingServer` must be set explicitly** with multiple webServer
  entries, otherwise a manually-running dev server on the same port errors the run.
- `workers: 1` in the Playwright config — the 500ms-badge assertion shares CPU with the
  WASM engine and flakes under parallel spec execution.

### Not done yet / deferred

- Manual Lichess cross-check of one analyzed game (last Phase-1 exit criterion) — do this
  after playing a few real games
- Promotion picker (still auto-queens), color choice vs engine (always White), engine-mode
  draw offers
- If the analysis job dies mid-run (server restart), a game can stick at `analyzing` — fine
  single-user, revisit if it ever happens
- Depth 18 on the Fly shared-cpu-1x will be ~3–5× slower than local (~1–2 min/game) — tune
  `LEECHESS_ANALYSIS_DEPTH` on Fly if that's annoying

## Next: Phase 2 — Motif tagging (rule-based)

Per the plan: `motif_tags` table, standalone rule-based tagger module (re-runnable without
re-running Stockfish), detection rules one motif at a time (fork → pin → back-rank → skewer →
hanging piece → the rest), wire into the analysis job before `analysis_status = complete`,
`test_motifs.py` with positive AND near-miss negative FEN cases, motif chips on Review,
manual validation against 15–20 real games.

---

## Phase 0 — Scaffolding (completed 2026-07-04)

**Goal:** a working skeleton with no chess intelligence — just the shape of the system. All exit criteria met and verified.

### Backend (`server/` — FastAPI + SQLAlchemy + python-chess, Python 3.14 via uv)

- `app/db.py` — SQLite via SQLAlchemy 2.0; DB path overridable with `LEECHESS_DB_URL` (used by tests and Fly)
- `app/models.py` — `games` and `moves` tables per the spec's data model. Analysis columns (`eval_before`, `eval_after`, `classification`, `best_move`) exist but stay `NULL` until Phase 1's analysis job
- `app/routers/games.py` — `POST /games` (accepts PGN, parses/validates with python-chess, stores one `moves` row per ply), `GET /games/{id}`
- `app/main.py` — COOP/COEP middleware on every response, CORS for dev ports, `GET /healthz`, `GET /debug/engine` (native Stockfish eval via `chess.engine.popen_uci` — the plumbing Phase 1's analysis job will reuse), and an SPA static mount (`SpaStaticFiles`) so one FastAPI process serves the built frontend in production

### Frontend (`client/` — SvelteKit SPA, Svelte 5 runes, Tailwind 4, bun)

- `adapter-static` with `fallback: 'index.html'` (pure SPA; `ssr = false`), served by FastAPI in production
- `src/lib/components/Board.svelte` — thin imperative chessground wrapper: instantiate in `onMount`, push state changes via `api.set()` in an `$effect`, forward moves to the store
- `src/lib/stores/game.svelte.ts` — `GameStore` class; chess.js is the source of truth for legality/SAN/dests; auto-queen promotion for now
- `src/lib/components/HintLadder.svelte` — shared component scaffolded with Level 0 only (the "Checks, captures, threats?" nudge, dismissable, re-shown after every move). Levels 1–5 come in Phase 3
- `src/lib/stores/stockfish.ts` — Stockfish 18 **lite** WASM (7MB) in a Web Worker, UCI over postMessage. Multi-threaded build when `crossOriginIsolated`, single-threaded fallback otherwise; `flavor` field exposes which one loaded
- `scripts/copy-stockfish.js` — copies WASM builds from node_modules into `static/stockfish/` before every dev/build (gitignored)
- Routes: `/` (Play: board, move list, nudge, save-to-server, engine-check panel), `/review/[gameId]` (raw stored moves from SQLite; real review UI is Phase 1), `/puzzles` + `/progress` (stubs)
- `scripts/generate-pgn-fixture.ts` — exports a 20-ply game from chess.js with per-ply FENs into `server/tests/fixtures/`, so the server round-trip test checks **cross-library** agreement, not python-chess against itself

### Testing

- **pytest** (`server/tests/`, run via `make test` / `make test-fast`): 7 tests, `unit`/`engine` markers split
  - `test_pgn_roundtrip.py` — chess.js-exported PGN re-imported by python-chess, SAN + FEN asserted at every ply; plus a server-side export→import round trip
  - `test_games_api.py` — stores game + moves, rejects invalid/illegal-move PGNs (422), 404 on missing game
  - `test_engine.py` (`engine` marker) — native Stockfish depth-16 eval on a fixed test FEN
- **Playwright** (`client/e2e/`, run via `bun run test:e2e`): 3 tests, zero manual setup — the config boots **both** the preview server and uvicorn (throwaway `data/e2e.db`)
  - `smoke.e2e.ts` — board renders, nav + nudge visible, `crossOriginIsolated === true`, zero console errors
  - `play-submit.e2e.ts` — plays Scholar's mate by clicking board squares, saves, asserts the stored rows via the API; plus a WASM depth-16-under-1s eval test

### Exit criteria — measured results

| Criterion | Result |
|---|---|
| Full legal game → submit → rows in `games`/`moves` | ✅ Automated in `play-submit.e2e.ts`; also confirmed directly in SQLite |
| Client WASM eval < 1s at depth 16 | ✅ ~210ms search / ~443ms wall, multi-threaded |
| Server native eval roughly matches same FEN | ✅ WASM **+42cp** vs native **+41cp** at depth 16 |
| `playwright test` passes, no manual setup | ✅ 3/3 |
| `pytest` passes, no manual setup | ✅ 7/7 in ~0.5s |

### Deployment (Fly.io)

- App **`leechess`** (personal org), live at **https://leechess.fly.dev**
- Single shared-cpu-1x machine in `iad`, 512MB, scale-to-zero; deploy with `fly deploy --ha=false --remote-only` from repo root
- 1GB volume `leechess_data` mounted at `/data` for SQLite (survives redeploys)
- Multi-stage Dockerfile: bun builds the SPA (`VITE_API_URL=""` → same-origin), python:3.14-slim runs FastAPI + native Stockfish
- Verified in production: `/healthz` ok, SPA served with COOP/COEP headers, `/debug/engine` returns evals from native Stockfish, `POST /games` writes to the volume-backed DB

### Gotchas hit (so they aren't re-hit)

- **SvelteKit dev/preview ignores vite's `server.headers`/`preview.headers`** — its own middleware serves pages without them. Fixed with a small vite plugin (`crossOriginIsolation()` in `vite.config.ts`) that sets COOP/COEP via connect middleware in both `configureServer` and `configurePreviewServer`.
- **Debian installs stockfish into `/usr/games`**, which isn't on a container's default PATH — added to `PATH` in the Dockerfile.
- **Clicks during chessground's move animation are dropped** — e2e tests must assert each SAN appears in the move list before playing the next move (polling assertion, not `waitForTimeout`).
- With **multiple Playwright `webServer` entries**, `baseURL` is no longer inferred from the port — set `use.baseURL` explicitly.

### Not done yet / deferred

- No commits yet — repo has no git history
- Promotion picker (auto-queens for now)
- vs-Stockfish play mode, live move classification, eval bar — all Phase 1 ✅ (see above)
- Review screen is a raw move dump; board/CPL graph/classifications land in Phase 1 ✅ (see above)
