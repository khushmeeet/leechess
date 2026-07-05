# leechess — Progress Log

Tracks build progress against [chess-learning-app-implementation-plan.md](chess-learning-app-implementation-plan.md).
One entry per phase; newest first. Update this doc when a phase's exit criteria are verified.

| Phase | Status | Completed |
|---|---|---|
| 0 — Scaffolding | ✅ Done | 2026-07-04 |
| 1 — Play + basic Review | Not started | — |
| 2 — Motif tagging (rule-based) | Not started | — |
| 3 — Puzzles + spaced repetition | Not started | — |
| 4 — Progress screen | Not started | — |
| 5 — LLM explanations (deferred) | Not started | — |

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
- vs-Stockfish play mode, live move classification, eval bar — all Phase 1
- Review screen is a raw move dump; board/CPL graph/classifications land in Phase 1

## Next: Phase 1 — Play + basic Review

Per the plan: `POST /games/{id}/moves` with server-side legality validation, `POST /games/{id}/complete` + background analysis job (server Stockfish depth 18–20, classification thresholds), `GET /games/{id}/review`, live client-side classification badges, CPL graph, "analyzing…" state, `play.spec.ts`/`review.spec.ts`, classification threshold unit tests.
