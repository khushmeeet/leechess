# leechess

A personal guided chess learning app: play → get told what pattern you missed
and why → drill that exact pattern via spaced repetition sourced from your own
misses → replay.

Docs: [product spec](chess-learning-app-product-spec.md) ·
[architecture](chess-learning-app-architecture.md) ·
[implementation plan](chess-learning-app-implementation-plan.md)

## Layout

- `client/` — SvelteKit SPA (Svelte 5 + Tailwind 4), chessground board,
  chess.js for legality, stockfish.wasm in a Web Worker for live evals
- `server/` — FastAPI + SQLite (SQLAlchemy), python-chess as source of truth
  for stored games, native Stockfish for batch analysis
- `Dockerfile` / `fly.toml` — single Fly.io machine serving the built SPA and
  the API from one FastAPI process

## Dev

Prereqs: `bun`, `uv`, `stockfish` in PATH (`brew install stockfish`).

```sh
# backend on :8000
cd server && make dev

# frontend on :5173 (proxies API calls to :8000)
cd client && bun run dev
```

## Tests

```sh
cd server && make test        # pytest, full suite incl. engine tests
cd server && make test-fast   # pytest -m "not engine", fast loop
cd client && bun run test:e2e # playwright (boots frontend + backend itself)
```

The multi-threaded WASM engine needs `crossOriginIsolated === true`; the
COOP/COEP headers are set by a vite middleware in dev/preview and by FastAPI
middleware in production. The e2e smoke test asserts this stays true.

## Deploy

```sh
fly deploy --ha=false --remote-only
```

SQLite lives on the `leechess_data` volume mounted at `/data`.
