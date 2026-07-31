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
cd server && make test          # pytest, full suite incl. engine tests
cd server && make test-fast     # pytest -m "not engine", fast loop
cd client && bun run test:unit  # vitest, the client unit suite
cd client && bun run test:e2e   # playwright (boots frontend + backend itself)
cd client && bun run test       # typecheck, then unit, then e2e
```

Every backend test carries exactly one of the `unit`/`engine` markers, and a
collection hook fails the run if one carries both or neither — so `-m unit`
means what it says (no Stockfish) and nothing quietly drops out of it.

Playwright starts its own preview server and backend and **never reuses one it
did not start**: the backend runs on `:8123` with a throwaway `data/e2e.db`,
and a busy port fails the run rather than adopting whatever is listening.
Ports `4173` and `8123` therefore need to be free. Each browser test truncates
and reseeds through `POST /testing/reset`, which only exists when
`LEECHESS_TEST_RESET=on` — so a spec pointed at a real server fails loudly
instead of mutating its database.

Cross-language behaviour lives in `shared/`: `motifs.json` (taxonomy plus 48
detector cases) and `classification-cases.json` are each run through both the
Python and the TypeScript implementation, so the two cannot drift.

The multi-threaded WASM engine needs `crossOriginIsolated === true`; the
COOP/COEP headers are set by a vite middleware in dev/preview and by FastAPI
middleware in production. The e2e smoke test asserts this stays true.

## Accounts

Username and password, and nothing else — no email column, no mail sender, no
third-party sign-in. That means **there is no password reset**: a forgotten
password is a lost account, which the sign-up form says out loud.

The username is the login identifier, so `users.username_canonical` holds the
lowercased form under a unique index and every lookup goes through it;
`users.username` keeps the casing you typed for display.

**Playing needs no account at all.** "Play now" on the welcome screen goes
straight to the board: no name to pick, no request, no row. That player is
called Anonymous, the game is theirs alone — the engine, the badges and the
hint ladder all run in the browser — and nothing about it is written to the
server, because there is no session to write it with. The one thing stored is
`leechess.anonymous` in localStorage, so a refresh does not drop them back on
the welcome screen mid-game.

An account is what makes anything persist, so Review, Puzzles, Endgames and
Progress ask for one (`AccountGate`) instead of rendering an empty version of
themselves — nothing played anonymously will ever arrive there. Signing up
mid-game keeps the game on the board: the play screen is remounted on the way
back from the welcome screen and syncs the whole move list at once.

Guests used to be passwordless rows in `users` with an `is_guest` flag, upgraded
in place by `POST /auth/upgrade`. Both endpoints and the column are gone; the
migration in `app/main.py` drops it, and any rows left behind are ordinary
accounts that happen to have no password (they cannot sign in — `authenticate`
already refused a NULL hash).

Two environment variables:

- `LEECHESS_AUTH_SECRET` — signs the session JWT. The server refuses to boot
  with the built-in default once `LEECHESS_STATIC_DIR` is set (i.e. in the
  deployed image), so set it with `fly secrets set`.
- `LEECHESS_AUTH_COOKIE_SECURE` — `on` unless set to `off`. `make dev` and the
  browser suite turn it off, because a browser will not send a `Secure` cookie
  back over plain-http localhost.

## Deploy

```sh
fly deploy --ha=false --remote-only
```

SQLite lives on the `leechess_data` volume mounted at `/data`. Before the
first deploy of an account-carrying build:

```sh
fly secrets set LEECHESS_AUTH_SECRET="$(openssl rand -hex 32)"
```
