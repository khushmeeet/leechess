# Chess Learning App — Implementation Plan

*Based on: chess-learning-app-product-spec.md*

Each phase has a goal, concrete tasks, deliverables, and exit criteria. Don't start a phase until the previous one's exit criteria are met — the spec's ordering exists specifically so each phase produces the data/plumbing the next one depends on.

---

## Phase 0 — Scaffolding (pre-work, ~2-3 days)

**Goal**: a working skeleton with no chess intelligence yet — just the shape of the system.

**Tasks**
- Repo setup: FastAPI backend, SQLite via SQLAlchemy (or raw `sqlite3` if you want to stay minimal), Alembic for migrations if you want schema evolution tracked
- Frontend scaffold: SvelteKit (with `adapter-static`, TypeScript) + Tailwind CSS, `chessground` wired up rendering a static starting position. `chessground` is plain JS/TS, not a component library, so wrap it in a thin `Board.svelte` component that instantiates it in `onMount` and forwards its move callback into a Svelte store — simpler than fighting a prop-driven React board wrapper against chessground's imperative API
  - `npm create svelte@latest chess-app` → SvelteKit + TS
  - `npx svelte-add@latest tailwindcss` (or manual Tailwind + PostCSS config) for styling
  - Suggested structure: `src/lib/components/` (Board, HintLadder, EvalBar, CplGraph), `src/lib/stores/` (game state, stockfish worker wrapper), `src/lib/api/` (fetch wrappers for FastAPI), `src/routes/` mapping 1:1 to the four screens (Play at `/`, Review at `/review/[gameId]`, Puzzles at `/puzzles`, Progress at `/progress`)
  - Build the `HintLadder.svelte` component as shared/reusable from the start (per Phase 3 below) even though only Level 0 exists yet — avoids rebuilding it later
- `chess.js` on the client for move legality/SAN, `python-chess` on the server — confirm both can parse the same PGN round-trip cleanly (write one test: play a short game, export PGN from client, import server-side, assert FEN matches at every ply)
- Fly.io app created, deploy a "hello world" FastAPI response to confirm the pipeline works end to end
- Stockfish binary: download and confirm it runs on the Fly.io machine (`stockfish` in PATH, test via `python-chess`'s `chess.engine.popen_uci`)
- Stockfish WASM: get `stockfish.wasm` loading in a Web Worker, confirm you can send a FEN and get an eval back in the browser console
- Set `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers on the FastAPI static/app responses — verify `SharedArrayBuffer` is actually available in the browser (check `crossOriginIsolated === true` in devtools), otherwise WASM silently falls back to single-threaded and you won't notice until performance is bad
- Core tables from the data model: `games`, `moves` (no `motif_tags`/`explanations`/`puzzles` yet — those come in later phases)
- **Playwright setup** (E2E testing for the SvelteKit app):
  - `npm init playwright@latest` from the frontend project root — choose TypeScript, and let it install browsers (`npx playwright install`)
  - This scaffolds `playwright.config.ts` and a `tests/` (or `e2e/`) directory — point `webServer` in the config at your dev server (`npm run dev`, default port 5173) so `npx playwright test` boots the app automatically rather than requiring it to already be running
  - Write one smoke test now, before any real features exist: navigate to `/`, assert the board renders (chessground renders an `<cg-board>` element you can target), assert no console errors. This confirms the harness itself works before you start relying on it
  - Use `npx playwright codegen http://localhost:5173` whenever you want to record a test interactively instead of hand-writing selectors — click through the flow once, copy the generated locators into your test file, then clean it up
  - Prefer Playwright's role/text-based locators (`getByRole`, `getByText`) over CSS selectors where possible — more resilient to Tailwind class changes, which will happen a lot as you iterate on styling
  - Add a package.json script: `"test:e2e": "playwright test"`, and `"test:e2e:ui": "playwright test --ui"` for the interactive test-debugging mode (very useful for chessboard interactions, since you can watch it click through moves)
- **pytest setup** (backend testing for the FastAPI app):
  - `pip install pytest pytest-asyncio httpx` — `httpx.AsyncClient` (or FastAPI's `TestClient`, which wraps `httpx` synchronously) is how you call your endpoints in tests without spinning up a real server process
  - Structure: `backend/tests/conftest.py` for shared fixtures — a `client` fixture wrapping `TestClient(app)`, and a `db` fixture pointing at a throwaway SQLite file (or `:memory:`) per test session so tests never touch your real dev database
  - Split tests into two tiers with `pytest` markers from the start: `@pytest.mark.unit` for anything that doesn't touch Stockfish (endpoint validation, motif logic once it exists, spaced-repetition math) and `@pytest.mark.engine` for anything that shells out to the real Stockfish binary (slower, and depth-dependent results can vary slightly by machine). Add `pytest.ini` config so `pytest -m "not engine"` gives you a fast loop for everyday iteration, and the full suite (`pytest`) runs before considering a phase done
  - Write the PGN round-trip test mentioned above as an actual pytest test now (`test_pgn_roundtrip.py`) rather than a one-off script — export a short PGN from a `python-chess` board, re-import it, assert FEN matches at every ply
  - Add a package.json-equivalent for Python: a `Makefile` or `pyproject.toml` script entry like `test = "pytest"` so both frontend and backend have a one-word test command

**Deliverables**
- A board you can click-move pieces on, locally, no backend involved yet
- A FastAPI endpoint that accepts a PGN and stores it in SQLite
- Confirmed working Stockfish in both places (client WASM, server native)
- A working Playwright harness with one passing smoke test
- A working pytest harness with the PGN round-trip test passing

**Exit criteria**
- You can play a full legal game on the board, submit it, and see a row in the `games`/`moves` tables
- Client WASM returns an eval for a test FEN in under 1s at depth 16
- Server native Stockfish returns an eval for the same FEN — evals should roughly match (confirms both are wired correctly, not confirms accuracy)
- `npx playwright test` runs and passes the smoke test against the dev server with zero manual setup steps
- `pytest` runs and passes the PGN round-trip test with zero manual setup steps

---

## Phase 1 — Play + basic Review

*(Product spec Phase 1)*

**Goal**: the full live-play loop with real-time classification, plus a Review screen reading from real (non-tagged) analysis data.

**Backend tasks**
- `POST /games` — start a game, returns game id + initial FEN
- `POST /games/{id}/moves` — accept a move (SAN or UCI), validate legality server-side via `python-chess` (don't trust client-side-only validation), store `fen_before`/`fen_after`, return updated state
- `POST /games/{id}/complete` — mark game finished, enqueue analysis job
- Analysis job (background task): for every move, run server Stockfish at a fixed depth (start with depth 18-20, tune for speed/accuracy tradeoff once you see run times), store `eval_before`, `eval_after`, `best_move`, and derive `classification` from eval delta thresholds (define these once: e.g. <10cp = best, 10-25 = good, 25-50 = inaccuracy, 50-100 = mistake, >100 = blunder — these are illustrative, tune against a few known games)
- `GET /games/{id}/review` — return full move list with classification + eval, plus `analysis_status` so the frontend can show "analyzing..." if not done yet

**Backend testing (pytest)**
- `test_games_api.py` (`@pytest.mark.unit`): `POST /games` returns a valid game id and starting FEN; `POST /games/{id}/moves` accepts a legal move and rejects an illegal one (assert the right HTTP status/error, since this is the "don't trust the client" validation path — it's worth a dedicated test specifically trying to submit an illegal move and confirming the server actually rejects it rather than trusting client-side `chess.js` alone)
- `test_classification.py` (`@pytest.mark.unit`): unit-test the eval-delta → classification function directly (not through the API) with a table of `(eval_before, eval_after, expected_classification)` cases covering each threshold boundary — this is pure logic, no engine needed, and it's the function most likely to silently drift out of sync between client and server if you're not careful, so pin it down with tests early
- `test_analysis_job.py` (`@pytest.mark.engine`, slower): run the real analysis job against a short known game (same scripted PGN used in the Playwright `review.spec.ts`, so both suites exercise identical data), assert every move gets an eval, a best move, and a classification, and that `analysis_status` ends at `complete`
- `test_pgn_roundtrip.py` from Phase 0 continues to run here as a regression check whenever move-storage logic changes

**Frontend tasks**
- Play screen (`src/routes/+page.svelte`): board via `Board.svelte`, move input, mode selector (vs. Stockfish / local 2-player), hint toggle (wire the toggle now even though only Level 0 exists — see Phase 3 for full ladder). Style with Tailwind utility classes directly; no separate CSS files needed for a project this size
- Level 0 nudge banner: fixed non-blocking prompt shown after every opponent move ("Checks, captures, threats?"), dismissable, always shown per the resolved decision — no conditional logic on time elapsed
- Client-side move classification: run client Stockfish (via the Web Worker wrapper in `src/lib/stores/stockfish.ts`) immediately after your move, compare to pre-move eval, show a badge (Best/Good/Inaccuracy/Mistake/Blunder) using the same thresholds as the server job, so live feedback and post-game review don't disagree
- Review screen (`src/routes/review/[gameId]/+page.svelte`): move list, click-to-jump, `CplGraph.svelte` (a simple line chart is enough — eval per ply, phase boundaries marked at rough move-count heuristics for now, refine later; a lightweight charting lib like `layerchart` or even hand-rolled SVG works fine at this scale), best-move arrows when they differ from the played move (chessground supports drawing arrows natively)
- "Analyzing..." state handling when `analysis_status != complete`

**Frontend testing (Playwright)**
- `tests/play.spec.ts`: navigate to `/`, make a legal move via the board (drag or click-click depending on how you wire chessground's input), assert the move badge (Best/Good/Inaccuracy/Mistake/Blunder) appears within 500ms — use `expect(locator).toBeVisible({ timeout: 500 })` rather than a hard `waitForTimeout`, since the latter tests "did it eventually work" not "did it meet the real requirement"
- `tests/play.spec.ts`: assert the Level 0 nudge banner is visible after the opponent's (or Stockfish's) move — this is the one place a fixed, always-shown UI element is easy to accidentally regress into "only shows sometimes," so a test here is worth it
- `tests/review.spec.ts`: play a short scripted game (a fixed sequence of moves so the test is deterministic), complete it, navigate to its Review URL, and poll (`expect.poll` or `toPass`) until `analysis_status` flips to complete and the move list renders with classifications — this also exercises the backend analysis job end-to-end, not just the frontend
- Run `npx playwright codegen` against the Play screen once it's built to quickly generate the initial move-input interaction rather than hand-writing chessground's drag events

**Deliverables**
- End-to-end: play a game, see live classifications, complete the game, revisit it later and see the full analyzed review

**Exit criteria**
- Nudge appears within 200ms of opponent's move (measure it, don't eyeball it)
- Live move classification appears within 500ms of your move
- Play 3-5 real games against yourself/Stockfish and confirm the CPL graph and classifications look sane compared to manually checking a couple of moves in a separate tool (e.g. cross-check one game against Lichess's own analysis to sanity-check your classification thresholds)
- `npx playwright test` passes for `play.spec.ts` and `review.spec.ts` — these two become your regression safety net for every later phase, since Play/Review are touched again and again as new features layer on top
- `pytest -m "not engine"` passes fast (a few seconds); the full `pytest` including the engine-marked tests passes before closing the phase — running both matters, since the fast subset won't catch a real Stockfish integration break

---

## Phase 2 — Motif tagging (rule-based only)

*(Product spec Phase 2 — LLM explicitly deferred)*

**Goal**: every flagged move (mistake/blunder, or a move where the best line involves a tactic) gets one or more motif tags from the fixed taxonomy, with no LLM involved.

**Tasks**
- Add `motif_tags` table
- Build the rule-based tagger as a standalone module (not baked into the analysis job — you'll want to re-run it independently as you refine rules without re-running Stockfish)
- Implement detection rules one motif at a time, starting with the highest-frequency/easiest to detect reliably:
  1. **Fork** — best move's destination square attacks ≥2 enemy pieces of value ≥ some threshold, using `python-chess`'s `board.attacks()`
  2. **Pin** — a piece is pinned to a more valuable piece/king along a shared line (`python-chess` has no built-in pin detector, but you can check: does removing the piece expose the king/more-valuable-piece to attack from the pinning piece's line)
  3. **Back-rank mate/weakness** — king on back rank, escape squares blocked by own pawns, attacked by a rook/queen on that rank
  4. **Skewer** — same line-attack logic as pin, but higher-value piece in front
  5. **Hanging piece / removing the defender** — simplest of all: is a piece undefended and attacked
  6. Remaining tactical motifs (discovered attack, discovered check, overloading, deflection, x-ray, zwischenzug, trapped piece) — implement incrementally, lowest priority ones can wait past this phase if time-boxed
  7. Strategic motifs (weak square, open file, bad bishop, pawn structure issues, king safety, space) — these are pattern-match-on-static-features rather than tactic-on-a-line, different logic shape, can be a second pass within this phase
- Wire the tagger into the same analysis job pipeline from Phase 1 (runs after Stockfish eval, before marking `analysis_status = complete`)
- Validation step (important, don't skip): manually review tags against 15-20 of your own real games. For each tag, confirm it's actually correct. Track a rough false-positive rate per motif informally — you don't need a formal metric yet since LLM fallback is deferred, but you do want to know if a specific motif's detector is unreliable before you start trusting the data it feeds into Phase 3's puzzle queue

**Backend testing (pytest)**
- This is the highest-value place to invest in unit tests in the whole project, since motif detection is pure logic against a FEN — no engine call, no network, fast and fully deterministic. `test_motifs.py` (`@pytest.mark.unit`): for each motif, build a small table of hand-constructed FENs with a known correct answer:
  - a handful of positions where the motif is clearly present → assert the tagger detects it
  - a handful of "near-miss" positions that look similar but the motif is *not* actually present (e.g. a piece that looks pinned but the line is blocked, a knight move that attacks two pieces but one is defended enough that it's not really a fork) → assert the tagger correctly does NOT tag these. These negative cases matter as much as the positive ones — a tagger validated only on positive examples will over-tag
  - Use real positions pulled from your own games where possible (the ones you'll manually validate anyway) rather than only synthetic ones, so the test suite and the manual validation step reinforce each other
- Keep this test file growing as you validate more games manually in this phase — every time manual review finds a false positive/negative, add it as a regression test case before fixing the rule, so it can't silently reappear later

**Frontend tasks**
- Show motif tag chips on flagged moves in the Review screen

**Frontend testing (Playwright)**
- Extend `tests/review.spec.ts` (don't create a new file — this is the same screen, just asserting more of it) with an assertion that at least one motif tag chip renders on a known-flagged move from the scripted game used in Phase 1's test. Since tagger correctness itself is validated manually per this phase's exit criteria, the Playwright assertion only needs to check "a tag renders when one is expected to exist," not "the tag is the right one"

**Deliverables**
- Every mistake/blunder in a completed game shows at least an attempted motif tag (or none, if genuinely untaggable — that's fine, don't force a tag)

**Exit criteria**
- Manual spot-check of 15-20 games shows tags are correct often enough to trust as input to the puzzle queue (no hard numeric bar since LLM fallback isn't in scope yet — this is a judgment call: if a specific motif is clearly unreliable, fix the rule or drop that motif from auto-tagging rather than shipping bad data downstream)
- `pytest` passes for `test_motifs.py`, including every regression case added while manually validating games this phase

---

## Phase 3 — Puzzles + spaced repetition

*(Product spec Phase 3)*

**Goal**: missed tactics from your games become a personal puzzle queue; generic Lichess puzzles fill gaps.

**Tasks**
- Add `puzzles` and `puzzle_attempts` tables
- One-time import script: download Lichess's public puzzle CSV dump, load `FEN`, `Moves` (solution), `Rating`, `Themes` columns into a `generic_puzzles` table (or the same `puzzles` table with `source_move_id = NULL`), filtering/mapping their theme names to your fixed motif taxonomy where they overlap (their theme list is larger than yours — map or drop, don't try to import 1:1)
- On analysis job completion (extends Phase 1/2's job): for every flagged move with a motif tag, create a `puzzles` row with `source_move_id` pointing back to it
- Spaced repetition logic: simplest workable version is a Leitner-box style scheme — track a `box` number per puzzle attempt history, wrong answer resets to box 1 (due again soon), correct answer advances box (due further out). Don't over-engineer this into a full SM-2 algorithm for v1
- `GET /puzzles/next` — selection logic: prioritize (a) personal puzzles due per the spaced-repetition schedule, (b) motifs with lowest recent success rate, (c) fall back to `generic_puzzles` filtered by the same weak motif when personal queue is empty for it
- `POST /puzzles/{id}/attempt` — record correct/incorrect and hint level used, update spaced-repetition state

**Backend testing (pytest)**
- `test_spaced_repetition.py` (`@pytest.mark.unit`): pure logic, no engine or DB needed beyond simple fixtures — test the Leitner-box transition function directly: correct answer advances box N→N+1 and pushes the due date out; incorrect answer resets to box 1. Cover edge cases: box already at max, first-ever attempt on a puzzle with no history
- `test_puzzle_selection.py` (`@pytest.mark.unit`, seeded DB fixture): seed a small set of personal + generic puzzles across a few motifs with varying due dates and success rates, then assert `GET /puzzles/next`'s selection logic actually prioritizes correctly — due personal puzzles first, then lowest-success-rate motifs, then generic fallback only when the personal queue for that motif is empty. This endpoint has several priority rules stacked on each other, which is exactly the kind of logic that's easy to get subtly wrong and hard to notice by eye
- `test_lichess_import.py` (`@pytest.mark.unit`, run once/rarely): test the import script against a small sample CSV (not the full multi-million-row dump) checked into the test fixtures — assert FEN/solution/rating parse correctly and theme names map to your fixed taxonomy as expected, including at least one theme that should correctly be dropped rather than mapped
- `test_puzzle_generation.py` (`@pytest.mark.engine`, extends Phase 1/2's analysis job tests): confirm that completing a game with a known flagged move produces a corresponding row in `puzzles` with `source_move_id` set correctly

**Frontend tasks**
- Puzzles screen: single board, same hint ladder component as Play (this is also when you build out the full Level 1-5 ladder, not just Level 0 — see below)
- "Practice these misses" button on Review screen — sends the game's flagged moves into the puzzle queue explicitly (even though they're auto-added by the analysis job, this gives an explicit "drill this game now" action)

**Hint ladder (full implementation, this phase)**
`HintLadder.svelte` was scaffolded as a shared component back in Phase 0 with only Level 0 wired up — this phase fills in Levels 1-5, since Puzzles is the first screen that needs the full ladder:
- Level 1: category label ("there's a tactic here" / "positional decision")
- Level 2: motif name ("look for a fork")
- Level 3: highlight relevant squares/pieces on the board (chessground's `select`/highlight API), no move shown
- Level 4: show the move + one-line reason (reason text can be templated from the motif tag for now — e.g. "Nc7 forks the king and rook" — since full LLM narration is deferred)
- Level 5: full solution line
Since it's the same component already used on Play, no separate integration work needed there — Play automatically gets the full ladder once this component is extended.

**Frontend testing (Playwright)**
- `tests/hint-ladder.spec.ts`: since `HintLadder.svelte` is shared, test it once against the Puzzles screen (simplest context) rather than duplicating the same assertions on Play — click through Level 0 → 1 → 2 → 3 → 4 → 5 sequentially, asserting each level's expected content appears (category text, motif name, highlighted squares, move text, full line) and that levels don't skip or reset unexpectedly
- `tests/puzzles.spec.ts`: solve a puzzle correctly, assert the "correct" state renders and the attempt is recorded (can assert via a subsequent API call in the test, or via a UI element like an updated streak count); solve one incorrectly, assert the "try again"/reveal-answer flow behaves as expected
- These two specs plus `play.spec.ts`/`review.spec.ts` from Phase 1 are your core regression suite going into Phase 4 — run the full suite (`npx playwright test`) before starting Phase 4, not just the new specs, since Puzzles reuses `HintLadder.svelte` which Play also depends on

**Deliverables**
- Puzzles screen pulling from a real, growing personal queue plus generic fallback
- Full hint ladder usable in both Play and Puzzles

**Exit criteria**
- Play a game with a couple of deliberate/natural blunders, complete it, confirm those exact positions show up in the puzzle queue within one analysis cycle
- Solve puzzles across multiple sessions and confirm previously-missed ones resurface sooner than previously-correct ones
- `pytest` passes for `test_spaced_repetition.py`, `test_puzzle_selection.py`, `test_lichess_import.py`, and `test_puzzle_generation.py`

---

## Phase 4 — Progress screen

*(Product spec Phase 4)*

**Goal**: visual trend data by motif and overall, sourced entirely from tables already populated by Phases 1-3.

**Tasks**
- `GET /progress` — aggregate queries: success rate per motif (from `puzzle_attempts` joined to `motif_tags`/`puzzles`), CPL trend over time (from `moves`/`games`), computed on read rather than via a separate snapshot pipeline (per the spec's note — don't build `progress_snapshots` unless read-time aggregation genuinely becomes slow)
- Weakest-motif callout: simple query, lowest success rate motifs with sample size above some minimum threshold (avoid surfacing a "0% success" motif that's only been attempted once)

**Backend testing (pytest)**
- `test_progress_api.py` (`@pytest.mark.unit`, seeded DB fixture): seed a known set of `puzzle_attempts`/`moves` rows with hand-calculated expected aggregates, then assert `GET /progress` returns exactly those numbers — this is the same cross-check the frontend exit criteria asks you to do manually, but automated so it doesn't need re-doing by hand every time the query changes
- Specifically test the minimum-sample-size threshold for the weakest-motif callout: seed a motif with only 1 attempt at 0% success and assert it's correctly excluded from the callout despite technically having the lowest rate

**Frontend tasks**
- Motif bar/radar chart, CPL trend line, weakest-motifs callout linking directly into a filtered Puzzles session for that motif, lightweight streak counter

**Frontend testing (Playwright)**
- `tests/progress.spec.ts`: navigate to `/progress`, assert the motif chart and CPL trend render without error against seeded test data (seed a handful of `puzzle_attempts`/`moves` rows directly via a test fixture or a test-only API endpoint rather than playing real games through the UI — much faster and more deterministic for a data-heavy screen like this)
- Assert clicking a weakest-motif callout navigates to `/puzzles` filtered to that motif (`expect(page).toHaveURL(...)`)

**Deliverables**
- A dashboard that's actually meaningful because it's reading a few weeks of real Phase 1-3 data by the time you build it

**Exit criteria**
- Cross-check one motif's displayed success rate manually against the raw `puzzle_attempts` rows to confirm the aggregation query is correct before trusting the dashboard
- `pytest` passes for `test_progress_api.py`, including the minimum-sample-size edge case

---

## Phase 5 — LLM explanations (deferred, build only if still wanted)

*(Product spec Phase 5)*

**Goal**: replace the templated Level 4 hint text and add a full "why" narrative panel on Review, using Claude via API.

**Tasks**
- Add `explanations` table
- Build the prompt: feed FEN, engine best line, your rule-based motif tag(s), and the player's actual move — ask for a short plain-language explanation of why the best move works and why the played move fails, in your own established voice/format (keep it short, 2-4 sentences)
- Gate generation to flagged moves only (mistakes/blunders/tagged tactics) — never every move, to control cost
- Cache aggressively: generate once per move, store in `explanations`, never regenerate for the same move
- Wire into Review screen "why" panel, and optionally upgrade Level 4 hint text from templated to LLM-generated

**Backend testing (pytest)**
- `test_explanations.py` (`@pytest.mark.unit`): mock the Claude API call (don't hit the real API in tests — costs money and adds network flakiness to the suite) and assert: the prompt is only triggered for flagged moves, not every move; a second call for the same move reads from the `explanations` cache instead of calling the API again (assert the mock was called exactly once across two requests); the stored explanation is retrievable via the Review endpoint
- One real (unmocked) manual/exploratory test against the actual API is worth doing once by hand to validate prompt quality — but keep that out of the automated suite, since prompt-quality is a judgment call, not a pass/fail assertion

**Deliverables**
- Full "why" panel live on Review

**Exit criteria**
- Before building: revisit whether this is still needed — re-read the motif tags across a few weeks of Phase 2-4 data and judge honestly whether the tag name alone ("fork") is enough to jog recognition, or whether you're actually finding yourself wanting the extra sentence of explanation. Only build this phase if the answer is genuinely the latter.

---

## Cross-phase notes

- **Don't skip validation steps.** Phases 2 and 3 in particular produce data that feeds later phases (puzzle queue, progress dashboard) — bad motif tags silently poison everything downstream, and you won't notice until the progress dashboard looks wrong in Phase 4.
- **Keep the classification thresholds (Phase 1) consistent** between client-side live feedback and server-side batch analysis — if they drift, live badges and post-game review will disagree, which undermines trust in both.
- **Re-run the CSS/COOP/COEP header check** any time you touch static asset serving or add a CDN/reverse proxy in front of Fly.io — this is the kind of thing that silently regresses.
- **Deployment**: build the SvelteKit frontend with `adapter-static` and serve the output as static files from the same FastAPI app (mount via `StaticFiles` on a catch-all route) — one Fly.io machine, one deployment, no separate frontend hosting to manage.
- **Playwright practices across phases**: run `npx playwright test` before considering any phase's exit criteria met, not just when writing new tests — regressions in earlier phases (especially Play/Review, since almost everything builds on them) are easy to introduce silently while working on later features. Keep test data deterministic (scripted move sequences, seeded fixtures) rather than relying on live Stockfish/random game outcomes, since flaky engine timing is the most likely source of flaky tests. If a test becomes flaky specifically due to engine response time, prefer polling assertions (`expect.poll`, `toPass`) over fixed `waitForTimeout` calls.
- **pytest practices across phases**: same "run the full suite before closing a phase" rule applies backend-side. Keep the `unit`/`engine` marker split maintained as you add tests — the fast unit subset is what you'll run constantly while iterating, the engine-marked subset (and Playwright) are what you run before calling a phase done. Use the same scripted PGN/known FENs across pytest and Playwright tests where the two overlap (e.g. the Phase 1 scripted game) so a discrepancy between "backend says X" and "frontend shows Y" surfaces as a test failure on identical input, not as two suites quietly testing slightly different things. Mock any external network call (Claude API in Phase 5; avoid this pattern issue arising again if you add other third-party calls later) — never let the automated suite depend on a live paid API or the real Lichess CSV dump download.
