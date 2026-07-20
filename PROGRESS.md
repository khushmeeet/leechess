# leechess — Progress Log

Tracks build progress against [chess-learning-app-implementation-plan.md](chess-learning-app-implementation-plan.md).
One entry per phase; newest first. Update this doc when a phase's exit criteria are verified.

| Phase | Status | Completed |
|---|---|---|
| 0 — Scaffolding | ✅ Done | 2026-07-04 |
| 1 — Play + basic Review | ✅ Done (one manual check pending, see below) | 2026-07-04 |
| 2 — Motif tagging (rule-based) | 🔶 Code complete; manual validation vs 15–20 real games pending | 2026-07-05 |
| 3 — Puzzles + spaced repetition | 🔶 Code complete; two manual checks pending (see below) | 2026-07-06 |
| 4 — Progress screen | ✅ Done (meaningful once Phases 2–3 manual validations feed it real data) | 2026-07-07 |
| 5 — LLM explanations | 🔶 Code complete; one manual check pending (real-API prompt-quality run) | 2026-07-07 |

---

## Phase 5 — LLM explanations (code complete 2026-07-07)

**Goal:** the Review "why" panel — a plain-language paragraph on why the best move
works and why the played move didn't, Claude via API, gated to flagged moves only,
cached forever. (The plan framed Phase 5 as a judgment gate — "only build if tags
alone aren't jogging recognition" — built now on explicit request.)

### Backend

- **`explanations` table** (`app/models.py`): `(id, move_id UNIQUE, text, model,
  created_at)` per spec §5, one-to-one `Move.explanation`. A new table, so
  `Base.metadata.create_all` adds it to the existing dev/prod DBs at startup — no
  migration step
- **`app/explanations.py`** — the whole Phase 5 pipeline:
  - *Gate* (`needs_explanation`): classification mistake/blunder OR any motif tag —
    tagged "executed tactic" moves get a "why your move worked" text; never every
    move (spec §4.2 cost control)
  - *Prompt*: FEN + played SAN + classification + "lost about N.N pawns" (from the
    mover's side) + engine best move as SAN (or "this was the engine's best move")
    + opponent's strongest reply (move N+1's stored `best_move`, same convention as
    the tagger) + humanized motif names. System prompt: chess coach for a ~1400
    player, 2–4 sentences, concrete squares, no engine jargon
  - *Model*: `claude-opus-4-8`, adaptive thinking, generous `max_tokens` so
    thinking never truncates the answer
  - *Caching*: one row per move, generated once, an existing row is never re-sent;
    wired into `run_game_analysis` after tagging (the gate reads `motif_tags`)
  - *Fail-soft*: any API error (no key, outage) logs, abandons that game's
    remaining moves, and analysis still completes — `scripts/explain.py` backfills
    later (also covers games analyzed pre-Phase-5; commits per game so paid calls
    aren't lost)
  - `LEECHESS_EXPLANATIONS=off` disables the pass entirely — **both automated
    suites set it** (pytest autouse fixture in `conftest.py`, Playwright webServer
    env) so tests can never hit the real paid API
- `GET /games/{id}/review` now serves `explanation` (text or null) per move

### Frontend

- Review page: amber **Why** panel under the motif chips for the selected move
  (`data-testid="why-panel"`), hidden when the move has no explanation;
  `MoveRecord.explanation` added to the API client
- Level 4 hint text stays templated — the plan's "optionally upgrade" is deferred
  until prompt quality is validated against real games

### Testing

- **pytest: 136 passed** (131 unit ~1s, 5 engine). New `test_explanations.py`
  (16): gate table (incl. executed-tactic and unanalyzed cases), only flagged
  moves trigger the API (mock call count on the tagged hung-queen game), second
  run reads the cache (mock called exactly once per move across two runs),
  disabled env makes zero calls, API failure swallowed + earlier texts kept +
  missed moves retried on the next run, prompt contents (FEN, SANs, pawns lost,
  humanized motifs), request shape + thinking/text block parsing against a fake
  anthropic client, review endpoint serves the stored text
- **Playwright: 12 passed** (~19s, unchanged — e2e runs the real analysis job with
  explanations off)
- **Manual browser check**: seeded an explanation row into a scratch DB, drove the
  built SPA headlessly — Why panel renders on Qxe5+ and hides on unexplained
  moves (screenshot-verified)

### Exit criteria — status

| Criterion | Result |
|---|---|
| Mock-only suite: flagged-only trigger, cache hit on second call, retrievable via Review | ✅ 136/136 full pytest |
| Full Playwright before phase close | ✅ 12/12 |
| One real (unmocked) exploratory call to judge prompt quality | ⚠️ **Pending manual step** — no Anthropic credentials on this machine; set `ANTHROPIC_API_KEY` and run `uv run python scripts/explain.py` against a real analyzed game, then read the texts in Review |

### Notes / conventions

- The server needs Anthropic credentials for generation (`ANTHROPIC_API_KEY` or an
  `ant auth login` profile); on Fly: `fly secrets set ANTHROPIC_API_KEY=…`.
  Without them analysis still completes — explanations are just skipped
- Cost shape: one API call per flagged move, ever. A typical casual game has a
  handful of flagged moves; `scripts/explain.py` is the only thing that re-visits
  old games and it skips moves that already have a row

## Phase 4 — Progress screen (completed 2026-07-07)

**Goal:** trend views by motif and overall, computed on read from the tables Phases 1–3
already write — no snapshot pipeline. All exit criteria met.

### Backend

- **`GET /progress`** (`app/routers/progress.py`): everything computed on read, optional
  `?days=30|90` window (default all-time) for the spec's 30/90/all-time views
  - *Motif success rates* from `puzzle_attempts ⋈ puzzles`, all attempts in the window
    (distinct from the puzzle queue's recent-20 "weakest" — that drives scheduling, this
    reports totals), returned weakest-first
  - *Weakest-motif callout*: ≤3 motifs, gated by `MIN_CALLOUT_ATTEMPTS = 3` (a 0% motif
    attempted once isn't a trend) **and `success_rate < 1.0`** — a perfect record, however
    the small pool ranks it, isn't a weakness to drill (found via screenshot eyeballing:
    "100% · weakest — drill these" is a contradiction)
  - *CPL trend*: per analyzed game, average centipawn loss **from the player's side** —
    engine games count White's moves only (you always play White vs Stockfish), local
    pass-and-play counts both sides. Phase-segmented at plies 20/60, same boundaries the
    Review CPL graph draws; `None` for phases a game never reached. Games with
    `analysis_status != complete` (or holes in the evals) are skipped, not crashed on
  - *Streaks*: consecutive UTC days with activity (game played or puzzle attempted),
    alive if yesterday had activity but today doesn't yet; ignores the window. Plus
    `puzzles_solved` (correct attempts, windowed)

### Frontend

- **Progress page** (`/progress`): 30/90/all-time segmented control, streak + solved stat
  tiles, weakest-motif callout cards linking to `/puzzles?motif=…` (Phase 3's filter),
  motif success bar chart (every motif also links to its drill), CPL trend, empty state
- **`CplTrend.svelte`**: hand-rolled SVG like `CplGraph` — Overall (ink) + Opening/
  Middlegame/Endgame lines (sky/amber/violet, CVD-validated ≥3:1 contrast on white),
  legend limited to series with data, direct end-labels with collision nudging, pen-up
  line breaks + lone-point dots for games that skip a phase, hover tooltip with per-phase
  values, click-through to that game's Review, `<details>` table fallback, y-max rounded
  to 50s so gridline labels stay whole

### Testing

- **pytest: 120 passed** (115 unit, 5 engine, ~2.4s). New `test_progress_api.py` (18):
  exact hand-calculated aggregates, weakest-first ordering, min-sample + perfect-score
  callout gates, callout cap at 3, `?days` window on attempts/solved/trend, engine-mode
  White-only CPL, phase splits at plies 20/60 (61-ply synthetic game), pending/analyzing/
  failed games excluded, null-eval hole skipped, streak transitions (consecutive, gap,
  games-count-too, alive-from-yesterday), empty DB returns zeroes
- **Playwright: 12 passed** (~19s). New `progress.e2e.ts`: seeds the hung-queen game via
  API + 3 attempts (1/3 correct) so the motif clears the callout gate, asserts stat
  tiles, motif chart row, CPL trend + table view containing the seeded game, then clicks
  the weakest-motif card → `/puzzles?motif=…` and the filter chip renders. Runs between
  `play` and `puzzles` specs — never assumes which puzzle `/puzzles/next` serves

### Exit criteria — status

| Criterion | Result |
|---|---|
| Cross-check a motif's displayed rate vs raw `puzzle_attempts` rows | ✅ seeded 4 pin attempts (1 correct) render as "1/4 · 25%" (screenshot-verified); exact aggregates also pinned by unit tests |
| `pytest` passes `test_progress_api.py` incl. min-sample edge case | ✅ 120/120 full suite |
| Full Playwright suite before phase close | ✅ 12/12 |

### Notes / conventions

- eslint's `svelte/no-navigation-without-resolve` can't see `resolve()` inside a helper
  function — build query-string hrefs inline: `href="{resolve('/puzzles')}?motif=…"`
- CPL "player side" is a heuristic (engine = White only). If color choice vs the engine
  ever lands (deferred since Phase 1), games need to record which side the user played
- Streak days are UTC — a late-evening local session can straddle two "days"

## Phase 3 — Puzzles + spaced repetition (code complete 2026-07-06)

**Goal:** missed tactics become a personal puzzle queue with Leitner-box scheduling;
generic Lichess puzzles fill gaps; the full hint ladder (Levels 1–5) ships as the shared
component. All automatable exit criteria met; two manual checks gate calling it fully done.

### Backend

- **Tables** (`app/models.py`): `puzzles` `(id, source_move_id NULLABLE→moves, fen,
  solution, motif, difficulty)` per the spec's data model, plus Leitner state on the row
  (`box` 1–5, `due_at`; new puzzles start box 1, due immediately). `puzzle_attempts`
  `(id, puzzle_id, correct, hint_level_used, attempted_at)`. `solution` is stored as one
  space-separated UCI string (solver first, opponent replies interleaved), served as a list
- **`app/spaced_repetition.py`** — Leitner boxes, deliberately not SM-2: correct → box+1
  (max 5), wrong → box 1; intervals 10min / 1d / 3d / 7d / 21d. Extra rule: "correct" with
  the move already revealed (hint level ≥ 4) keeps the box — recognizing ≠ retrieving,
  but using the ladder isn't punished either
- **`app/puzzle_generation.py`** — pure python-chess over stored analysis (re-runnable, no
  engine), ≤1 puzzle per flagged move: *missed tactic* (best move from the position faced
  executes a motif → drill that position) else *allowed tactic* (opponent's punishing best
  reply has a motif → drill the position after the mistake, Lichess-style). Wired into
  `run_game_analysis` after tagging; `scripts/retag.py` now also backfills puzzles for
  games analyzed pre-Phase-3 (idempotent — moves that already have a puzzle are skipped)
- **`app/lichess_import.py` + `scripts/import_lichess_puzzles.py`** — one-time CSV import
  (CC0 dump, decompress with zstd; no live API). Handles the dump's convention that FEN is
  *before* the opponent's setup move (`Moves[0]` applied, solution = `Moves[1:]`); maps 12
  Lichess themes onto the fixed taxonomy and drops the rest; dedups by FEN (re-run safe);
  `--max-per-motif` (default 500) keeps the pool bounded; malformed rows logged + skipped
- **`app/routers/puzzles.py`** — `GET /puzzles/next` (read-only: due personal puzzles
  first ordered by weakest motif then due date; generic fallback with the same weak-motif
  priority, easiest first; optional `?motif=` filter for Phase 4's drill links; 404 when
  nothing is due). "Weakest" = success rate over the ≤20 most recent attempts per motif;
  no attempts counts as 0. `POST /puzzles/{id}/attempt` records + reschedules,
  `GET /puzzles/{id}` returns attempt history. `POST /games/{id}/practice` (Review's
  button): creates any missing puzzles and makes the game's puzzles due now (box kept)

### Frontend

- **`HintLadder.svelte`** — full ladder: Level 0 nudge unchanged, Levels 1–5 reveal one
  rung at a time (category → motif chip → board highlight → move + templated reason →
  full line). Parent owns `level` (bindable) for board highlights + attempt reporting;
  `hint` content prop omitted = nudge-only (Play unchanged — see deferred)
- **Puzzles screen** — `PuzzleSession` store (`stores/puzzle.svelte.ts`): solver plays the
  FEN's side to move, board flipped accordingly; scripted opponent replies auto-play;
  alternate checkmates count as solved (Lichess convention); first wrong try records the
  incorrect attempt immediately, then retries are free; reveal-answer jumps to Level 5.
  Level 3 = circles, Level 4+ = arrow via chessground autoShapes. `?motif=` filter chip,
  session counter, personal-vs-Lichess source line. Templated reasons in `lib/motifs.ts`
- **Review** — "Practice these misses" button (analysis-complete games) → queued count +
  link to /puzzles. `Board.svelte` grew a `syncKey` prop (see gotchas)

### Testing

- **pytest: 102 passed** (97 unit ~0.5s, 5 engine, ~2s total). New: `test_spaced_repetition.py`
  (14 — transitions incl. max box, first attempt, reveal gate, interval monotonicity),
  `test_puzzle_generation.py` (8 — punish vs missed branch, untaggable blunder → no puzzle,
  idempotency, practice endpoint incl. backfill + 409, engine-marked job E2E),
  `test_lichess_import.py` (7 — mapping/drop, setup-move convention, first-theme-wins,
  per-motif cap, idempotent re-import, taxonomy guard, illegal-row skip),
  `test_puzzle_selection.py` (13 — every priority rule separately + attempt scheduling
  through the API)
- **Playwright: 11 passed** (~15s). New `hint-ladder.e2e.ts` (Levels 0→5 click-through on
  Puzzles: content per rung, board shapes at 3, no skip/reset), `puzzles.e2e.ts` (solve
  correct → attempt recorded + box advances + queue moves on; wrong move → retry banner,
  incorrect recorded immediately, reveal answer, solution still playable after snap-back).
  `review.e2e.ts` extended with the practice button. Helpers: orientation-aware `move()`,
  shared `seedGame`/`waitForAnalysis`

### Exit criteria — status

| Criterion | Result |
|---|---|
| Deliberate blunders show up in the queue within one analysis cycle | ✅ automated (engine test + e2e assert the exact position/solution); ⚠️ confirm once with a real played game |
| Missed puzzles resurface sooner than correct ones across sessions | ✅ scheduling pinned by unit tests (wrong → 10min, correct → 1d+); ⚠️ **pending manual multi-session check** |
| `pytest` passes for all four new test files | ✅ 102/102 full suite |
| Full Playwright suite before phase close | ✅ 11/11 |

### Gotchas hit (so they aren't re-hit)

- **SQLite round-trips datetimes naive**: we store aware-UTC, but the SQLAlchemy sqlite
  dialect drops the offset on read. Keep every stored datetime aware-UTC, do due-date
  filtering in SQL (`Puzzle.due_at <= utcnow()`), and only compare loaded values with
  other loaded values — tests compare against `datetime.now(utc).replace(tzinfo=None)`.
- **chessground doesn't snap back a legal-but-rejected move**: on a wrong puzzle answer the
  FEN state is unchanged, so no prop changes and the piece stays visually moved. Fixed
  with a `syncKey` prop on `Board.svelte` — bump it to force `api.set()` re-sync.
- **Lichess dump FEN is pre-setup-move** — importing FEN+Moves verbatim produces puzzles
  where the *opponent* is to move. Apply `Moves[0]` first; solution is `Moves[1:]`.
- **e2e determinism with a shared queue**: `hint-ladder.e2e.ts` runs first alphabetically,
  so its seeded hung-queen puzzle is the only one due → motif assertions are safe there.
  `puzzles.e2e.ts` never assumes which puzzle is served — it reads `/puzzles/next`
  (read-only) and drives the board from the response.

### Not done yet / deferred

- Play screen still nudge-only: the spec's "Full ladder" in-game hint toggle needs hint
  *content* client-side (motif detection or a server hint endpoint) — the component is
  ready, feed it `hint` data when that exists
- ~~Generic pool not imported into the dev/prod DB yet~~ — the server now seeds
  itself (2026-07-20, `app/seeding.py`): first startup with an empty pool streams
  the dump straight off the network when `LEECHESS_AUTO_SEED=on` (set in fly.toml;
  off by default so dev/test runs never surprise-download), and
  `POST /puzzles/seed` / `GET /puzzles/seed` trigger and report a run manually.
  `scripts/import_lichess_puzzles.py` (the manual CSV-on-disk path) is removed —
  seeding covers every case it served
- Underpromotion solutions auto-queen on the puzzle board (same limitation as Play)
- Remaining Phase 2 motif detectors (discovered attack, overloading, deflection, x-ray,
  zwischenzug, trapped piece, strategic set) still deferred — puzzles inherit whatever
  the tagger can detect

## Next: manual checks, then the Phase 5 decision

1. Phase 2's pending step: play/import 15–20 real games, validate tags (add regression
   cases to `test_motifs.py` for anything wrong before fixing rules)
2. Phase 3's pending step: confirm a real game's misses land in the queue, and solve
   puzzles across a few sessions to feel the Leitner scheduling work
3. ~~Optionally run the Lichess import for the generic pool~~ — automatic since
   2026-07-20: production self-seeds on first startup (`LEECHESS_AUTO_SEED=on` in
   fly.toml), or hit `POST /puzzles/seed`
4. Phase 4 is built ✅ (2026-07-07, see above) — it becomes genuinely meaningful once
   steps 1–2 feed it a few weeks of real data
5. Phase 5 is built ✅ (2026-07-07, see above) — its own pending step: one real
   (unmocked) API run to judge prompt quality (`scripts/explain.py` with
   `ANTHROPIC_API_KEY` set), folded into the same play-real-games session as 1–2

---

## Phase 2 — Motif tagging, rule-based (code complete 2026-07-05)

**Goal:** every flagged move gets motif tags from the fixed taxonomy, rule-based only, no
LLM. All automatable exit criteria met; the human validation step (below) gates calling the
phase fully done.

### Backend

- `motif_tags` table (`app/models.py`): `(id, move_id, motif, source)` per the spec's data
  model, `source` = `rule_based | manual`; `Move.motifs` property exposes sorted tag names,
  `MoveOut.motifs` serializes them through every game/review endpoint
- `app/motifs.py` — **standalone tagger module**, pure python-chess over already-stored
  FENs/best moves: re-runnable without touching Stockfish. Tagging semantics — two
  best-line passes per move:
  - *missed/executed*: motifs of the engine's best move from the position the player faced —
    stored when the move is flagged (mistake/blunder) or the player played exactly the best
    move (executed the tactic; feeds "you found it" data)
  - *allowed*: for mistakes/blunders only, motifs of the opponent's best reply to the played
    move (the tactic the blunder walked into). Re-derivable offline because move N+1's stored
    `best_move` *is* the best reply to move N
- Detectors implemented (7 of the taxonomy's tactical motifs): **fork** (destination attacks
  ≥2 of king/higher-value/undefended-minor+, forking square must be "safe": no cheaper
  attacker, defended if attacked at all), **pin** / **skewer** (first-two-pieces ray walk from
  the moved slider; pinned pawns and pawn-behind-king "skewers" rejected as noise),
  **back_rank_mate** (checkmate + mated king on its back rank + R/Q checker on that rank),
  **hanging_piece** (capture of an undefended piece ≥ minor, or a defended one taken by
  something cheaper; pawn grabs excluded), **discovered_check** (a checker other than the
  moved piece; castling rook counted as "moved" so O-O rook checks don't false-positive),
  **double_check** (≥2 checkers)
- Wired into `run_game_analysis` after `_analyze`, before `analysis_status = "complete"`;
  `scripts/retag.py` re-runs tagging over all analyzed games (`uv run python scripts/retag.py`)
  after rule refinements — deletes/rebuilds `rule_based` tags, preserves `manual` ones
- Deferred (per plan, implement one at a time with tests): discovered attack (non-check),
  overloading, deflection, x-ray, zwischenzug, trapped piece, and all strategic motifs

### Frontend

- Review screen: violet motif chips for the selected move (`data-testid="motif-tags"`,
  underscores humanized), violet dot next to move-list entries that carry tags (hover shows
  the names)

### Testing

- **pytest: 60 passed** (56 unit ~1s, 4 engine). New `test_motifs.py` (25 tests): exact-set
  detector table with positives AND near-miss negatives per motif (fork square attacked by a
  pawn, Ruy-Lopez lookalike where only a pawn is behind the "pinned" knight, mate that isn't
  on the back rank, defended equal trade, plain pawn grab, castling rook check…), gating
  tests for `tags_for_move`, and `apply_rule_based_tags` DB tests (blunder + punish tagged,
  idempotent re-run, manual tags survive). New engine test: hung-queen game
  (1.e4 e5 2.Qh5 Nc6 3.Qxe5+?? Nxe5) through the real job → blunder classified + tagged
- **Playwright: 8 passed.** `review.e2e.ts` extended with a motif test seeding the same
  hung-queen game via the API: analysis completes, clicking Qxe5 shows the "hanging piece"
  chip

### Exit criteria — status

| Criterion | Result |
|---|---|
| `pytest` passes for `test_motifs.py` incl. near-miss negatives | ✅ 60/60 full suite (~1.5s) |
| Playwright full suite before phase close | ✅ 8/8 in ~11s |
| Manual spot-check of tags vs 15–20 real games | ⚠️ **Pending manual step** — needs real games played through the app; add every false positive/negative found as a `test_motifs.py` regression case before fixing the rule |

### Notes / conventions

- Test scripted game for tactics is the **hung-queen game** (`Qxe5+??`/`Nxe5`) — used
  identically in `test_motifs.py`, `test_analysis_job.py`, and `review.e2e.ts`. Scholar's
  mate deliberately yields *no* tags (Qxf7# is neither back-rank nor a detectable fork) —
  it stays the mate-lifecycle fixture
- Games analyzed before this phase have no tags — run `scripts/retag.py` once to backfill
  (needs `analysis_status = complete`; evals/best moves are already stored). As of Phase 3
  the same script also backfills the personal puzzle queue

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
