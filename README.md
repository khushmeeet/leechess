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

## Playing a friend

One link, no lobby: "Play with a friend" (welcome screen, or Settings) opens a
game and hands you a `/play/<token>` URL. Whoever opens it first takes the
other seat and the game starts; anyone after that watches. Neither side needs
an account, and the person you send it to is never asked for anything.

Moves run over a WebSocket (`/live/{token}/ws`) with the server authoritative
for legality, turn order and the result — a seat token, kept in localStorage,
is what authorizes a move, never the session cookie. That token never appears
in a URL: REST sends it in `X-Live-Seat` and the socket names it as a
subprotocol (`["leechess.seat", "<token>"]`), because a credential in a query
string is a credential in every access log and `Referer` that touches it. The
`?seat=` parameter is still read so a browser holding the previous bundle
keeps its seat across a deploy. Signing out drops every stored seat.
Connections live in a
module-level dict in `app/live.py`, which is right for one machine and one
uvicorn worker and would silently split two players apart on a second of
either; the database is the source of truth, so a dropped socket reconnects by
replaying the move list and needs no catch-up path.

**What is kept depends on the seat, not the game.** A live game is its own
`live_games` row, never a `Game`. When it ends it is forked into an ordinary
`Game` per *signed-in* seat, each with its own `user_color` — so Review,
Puzzles, Progress and the analysis job carry on knowing nothing about a second
player. A seat with no account gets the game and nothing else, which is the
same bargain "Play now" already makes. Two accounts means two rows and two
analyses of the same moves.

A friend game is a bare board. The coach line, the ideas row and the hint
ladder are absent rather than hidden: all three read out what Stockfish would
play, and beside a live opponent that is not a display preference. The eval
bar, the live badges and the move list are toggles of their own under
Settings → Play with a friend, defaulting to a board and a move list.

**If your opponent walks off**, you can claim the game rather than resign to
an empty chair. The waits follow Lichess: 10 seconds when they left on purpose
(a closed tab sends a clean close frame), 40 when the connection dropped on
its own, since that usually comes back by itself. Both are overridable via
`LEECHESS_LEAVE_GRACE` / `LEECHESS_DISCONNECT_GRACE`, which is how the browser
suite drives the flow in a second. There is no scaling by material and no
penalty for repeat offenders — those protect a rating ladder, and there isn't
one here. A game with no moves cannot be claimed at all: an unplayed game is
aborted rather than won, which is what the sweep does with it.

Untouched live games are swept after two days (`app/live.py`), on startup —
but a game with moves in it is forked to its signed-in seats first. Both
players walking away is not a reason to destroy what they played.

Guests used to be passwordless rows in `users` with an `is_guest` flag, upgraded
in place by `POST /auth/upgrade`. Both endpoints and the column are gone; the
migration in `app/main.py` drops it, and any rows left behind are ordinary
accounts that happen to have no password (they cannot sign in — `authenticate`
already refused a NULL hash).

Changing a password needs the password it replaces (`current_password` on
`PATCH /users/me`), and doing it ends every session opened before it —
including the one making the request. Sessions are stateless JWTs, so there is
no server-side record to delete: each token carries when it was signed and
each account carries a cutoff (`users.sessions_valid_from`), and a token older
than the cutoff is refused. Without that, a password changed because a cookie
was compromised would leave that cookie signed in for the rest of its thirty
days — and with no reset here, an account taken that way is gone.

Two environment variables:

- `LEECHESS_AUTH_SECRET` — signs the session JWT. The server refuses to boot
  with the built-in default once `LEECHESS_STATIC_DIR` is set (i.e. in the
  deployed image), so set it with `fly secrets set`.
- `LEECHESS_AUTH_COOKIE_SECURE` — `on` unless set to `off`. `make dev` and the
  browser suite turn it off, because a browser will not send a `Secure` cookie
  back over plain-http localhost.

## Limits

Playing a friend, signing up and signing in all work without an account
already existing, so they are the routes a stranger can reach — and this runs
on one 512mb machine. Everything below is in-process (`app/rate_limit.py`),
bounded on both key count and window, and sized for one machine rather than
for correctness across several; a second worker would need shared state, the
same caveat `app/live.py` carries about its connection hub.

- **Sign-in** is limited three ways: per address per account (the anti-guessing
  one), per account across addresses (a high backstop), and per address for
  *every* attempt regardless of outcome. The last exists because verifying a
  password is a 64mb argon2 hash paid even for a username that does not exist,
  so rotating names would otherwise buy unlimited work. The per-account limit
  is deliberately not the strict one: keyed on the name alone, ten failures
  from a stranger locked the owner out of their own account.
- **Hashing itself** is capped at `LEECHESS_PASSWORD_HASH_CONCURRENCY` (2) at
  once and runs off the event loop, so peak memory is bounded and a sign-in no
  longer stalls every live game while it hashes.
- **Sign-up**, **friend-game creation** and **WebSocket messages** are capped
  per address, per address, and per socket. One game holds a bounded number of
  sockets, and the process a bounded number overall.
- **Request bodies** stop at `LEECHESS_MAX_BODY_BYTES` (512kb), refused before
  they are read rather than after.
- **Wikibooks lookups** need an account and spend at most four uncached
  upstream fetches per request; a line fills in over a few visits and is then
  served from SQLite.

Rate limits key on `request.client.host`, which is only the caller if uvicorn
trusts the proxy in front of it — hence `--forwarded-allow-ips` in the
Dockerfile. Without it every request behind Fly's proxy wears the proxy's
address and every per-caller limit becomes one global bucket.

Responses carry a CSP plus `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options` and (when the cookie is `Secure`) HSTS, alongside the
COOP/COEP pair stockfish.wasm needs. The CSP has to allow inline script —
app.html sets the theme before first paint and SvelteKit's bootstrap is inline
and rebuilt each time, so there is no stable hash for a static file server to
use — but it still forbids foreign script origins, framing, `<base>`
injection, and `connect-src` anywhere but this origin.

## Deploy

```sh
fly deploy --ha=false --remote-only
```

SQLite lives on the `leechess_data` volume mounted at `/data`. Before the
first deploy of an account-carrying build:

```sh
fly secrets set LEECHESS_AUTH_SECRET="$(openssl rand -hex 32)"
```
