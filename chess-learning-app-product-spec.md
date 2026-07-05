# Chess Learning App — Product Spec

*Based on: chess-learning-app-architecture.md*

## 1. Overview

A personal chess learning app that closes the loop existing tools leave open: Lichess/Chess.com puzzle trainers teach patterns in isolation, post-game analyzers dump eval graphs and blunder labels without explaining *why*, and neither builds a habit of disciplined move-selection thinking. This app plays, coaches, and reviews in one continuous loop, using your own games as the primary training data instead of generic puzzle sets.

**Primary user**: you, a sub-1400-ish improving player who knows the rules but not tactical pattern recognition or a structured thinking process.

**Frontend**: SvelteKit + Tailwind CSS, with `chessground` (Lichess's own board library) for the board itself — see the implementation plan for setup detail.

**Core hypothesis**: the highest-leverage learning loop is *play → get told what pattern you missed and why → drill that exact pattern via spaced repetition sourced from your own misses → replay*. Generic puzzle sets and raw accuracy percentages don't close this loop; personalized motif tracking does.

## 2. Goals / Non-goals

**Goals (v1)**
- Play a full game against an engine or a local opponent with optional real-time nudges
- Get an immediate, plain-language explanation of any mistake, not just an eval number
- Have every missed tactic automatically become a future puzzle
- See personal trend data by motif, not just aggregate accuracy

**Non-goals (v1)**
- Competitive rating ladder / matchmaking against strangers — use Lichess for that, this app is a coaching layer
- Mobile native apps — web-first, responsive is enough
- Anti-cheat, tournaments, social/sharing features
- Supporting other people's accounts/multi-tenancy in a serious way (build for yourself first)

## 3. User stories

1. As a player, while I'm mid-game, I want a *prompt to think*, not an answer, so I build the CCT habit instead of learning to wait for hints.
2. As a player, when I blunder, I want to know *which pattern I missed* (not just "−2.6") so I can recognize it next time.
3. As a player, after a game, I want my missed tactics automatically queued as future puzzles, so review isn't a separate chore I have to curate myself.
4. As a player, I want to see whether I'm getting better at *forks* specifically, not just whether my overall accuracy went from 78% to 82%.
5. As a player, I want the option to turn hints off entirely for a "real game" mode, so I can test whether the training is sticking.

## 4. Feature spec

### 4.1 Play screen

| Item | Detail |
|---|---|
| Modes | vs. Stockfish (adjustable strength), local 2-player (pass and play) |
| Hint toggle | Off / Nudge-only (Level 0-1) / Full ladder (Level 0-5) — set per game |
| Pre-move nudge | Non-blocking banner: "Checks, captures, threats?" appears after every opponent move, before you move — always shown, not time-boxed. It's a fixed part of the pre-move ritual, not a fallback for slow thinking. Dismissable, never auto-advances to a specific answer. |
| Move feedback | Immediately after you move: classification badge (Best/Good/Inaccuracy/Mistake/Blunder) computed from client-side Stockfish eval delta. No motif tag or explanation yet at this stage — that's deferred to post-game batch analysis to keep the live loop fast and cheap. |
| Eval bar | Toggleable, off by default in "training mode" so you're not just chasing the bar |
| Resign/draw/save | Standard controls; every game auto-saves as PGN + metadata on completion |

**Acceptance criteria**
- Nudge must appear within 200ms of opponent's move (client-side, no server round-trip)
- Move classification must appear within 500ms of your move (client Stockfish, depth ~16 minimum)
- Every completed game queues a server-side analysis job automatically, no user action required

### 4.2 Review screen

| Item | Detail |
|---|---|
| Board + move list | Click any move to jump; arrows show best move vs. played move when they differ |
| CPL graph | Same shape as Lichess's (opening/middlegame/endgame phases marked), click-through to the move |
| Motif tags | Per flagged move: one or more tags from the fixed taxonomy (§4.4), shown as chips |
| "Why" panel *(deferred, Phase 5)* | Plain-language paragraph, generated once and cached: why the best move works, why your move didn't. Only generated for mistakes/blunders/tagged-tactic moves — not every move, to control LLM cost. Not in v1 — motif tags alone are the initial "why" signal; add narrative text once you've seen whether tags are self-explanatory enough on their own. |
| "Practice these misses" button | Sends every mistake/blunder in this game into the spaced-repetition puzzle queue (§4.3) |

**Acceptance criteria**
- Review screen must load instantly from cached SQLite data on repeat visits (no re-running engine/LLM)
- If analysis job is still processing, show a clear "analyzing..." state, not a blank/broken screen

### 4.3 Puzzles screen (spaced repetition)

- Queue is populated **primarily from your own missed tactics**, tagged by motif, using a simple spaced-repetition schedule (e.g., Leitner-box style: miss it again soon, get it right and it moves further out)
- Falls back to a generic tagged puzzle set only when your personal queue is empty for a given motif — see "Generic puzzle source" below
- Same hint ladder UI as Play screen
- Correct/incorrect tracked per motif, feeding the Progress screen
- **Difficulty**: motif-focused, not ELO-adaptive, in v1. You select/drill by pattern, not by a target rating band — the goal is pattern recognition, not rating-matched difficulty curves. Revisit if motif-only selection ever surfaces puzzles that are trivially easy or too hard to be useful.

**Generic puzzle source**
Not a live Lichess API call — Lichess's `/api/puzzle/next` is tied to a logged-in Lichess account's own puzzle history, not something to piggyback for arbitrary theme lookups. Instead: one-time import of Lichess's public puzzle database dump (CC0-licensed CSV, millions of puzzles with FEN/solution/rating/theme columns) into a local `generic_puzzles` table, filtered by motif at query time. No API dependency, no rate limits, works offline.

**Acceptance criteria**
- A missed tactic from a live game must appear in the puzzle queue within one analysis-job cycle (i.e., as soon as post-game analysis finishes)
- Puzzle selection must prioritize motifs with the lowest recent success rate

### 4.4 Motif taxonomy (fixed list, v1)

Tactical: fork, pin, skewer, discovered attack, discovered check, double check, back-rank mate, removing the defender, overloading, deflection, x-ray attack, zwischenzug, trapped piece

Strategic: weak square/outpost, open file, bad bishop, pawn majority, isolated/doubled/backward pawn, king safety imbalance, piece activity imbalance, space advantage

This list is intentionally fixed and small in v1 — better to track 20 motifs well than 100 poorly. Extend only after v1 data shows gaps.

### 4.5 Progress screen

| Item | Detail |
|---|---|
| Motif radar/bar chart | Success rate per motif, last 30/90/all-time |
| CPL trend line | Across games over time, phase-segmented |
| Weakest motifs callout | Top 3 lowest-success motifs, linked directly to a puzzle drill |
| Streaks | Days played, puzzles solved — lightweight, not gamified to the point of distraction |

**Acceptance criteria**
- All charts computed from the same SQLite tables Review/Puzzles write to — no separate analytics pipeline in v1

## 5. Data model (high level)

```
games        (id, pgn, white, black, result, mode, created_at, analysis_status)
moves        (id, game_id, ply, san, fen_before, fen_after, eval_before,
              eval_after, classification, best_move)
motif_tags   (id, move_id, motif, source)              -- source: rule_based | manual
explanations (id, move_id, text, model, created_at)     -- cached LLM output
puzzles      (id, source_move_id NULLABLE, fen, solution, motif, difficulty)
puzzle_attempts (id, puzzle_id, correct, hint_level_used, attempted_at)
progress_snapshots (id, date, motif, success_rate, sample_size)  -- optional, can be computed on read instead
```

`source_move_id` on `puzzles` is what makes personal-mistake-sourced puzzles distinct from generic ones — nullable because generic Lichess-sourced puzzles won't have a source move.

## 6. API surface (FastAPI, indicative)

```
POST   /games                       start a new game
POST   /games/{id}/moves            submit a move, returns classification
POST   /games/{id}/complete         end game, triggers analysis job
GET    /games/{id}/review           full move list + tags + explanations (cached)
GET    /puzzles/next                next puzzle from personal queue (fallback generic)
POST   /puzzles/{id}/attempt        submit puzzle answer
GET    /progress                    motif success rates, CPL trend
```

Analysis jobs run as async background tasks (FastAPI `BackgroundTasks` or a lightweight `arq` queue) — no need for a heavyweight queue system at single-user scale.

## 7. Phased build plan

**Phase 1 — Play + basic Review**
Board, client Stockfish for live eval/classification, PGN save, server-side batch re-analysis, CPL graph. No motif tagging or LLM yet — validate the play loop and data pipeline first.

**Phase 2 — Motif tagging**
Rule-based tagger using `python-chess` attack-map queries against engine best-lines. Validate tags manually against a sample of your own games before trusting it. LLM-based tagging/explanation is explicitly deferred past v1 (see §8) — ship and lean on rule-based tags alone until there's a concrete reason to add the LLM layer.

**Phase 3 — Puzzles + spaced repetition**
Wire missed tactics into a queue (motif-focused selection, not ELO-adaptive), build the hint ladder as a shared component across Play/Review/Puzzles, one-time import of the Lichess puzzle CSV dump as the generic fallback pool.

**Phase 4 — Progress screen**
Once you have a few weeks of tagged data, build the motif trend views — this is the payoff feature but needs real data to be meaningful, so it's correctly last.

**Phase 5 — LLM explanations (deferred)**
Add the "why" panel once the rule-based tagging + puzzle loop is validated and you have a real sense of which moves actually need natural-language explanation vs. which are self-evident from the tag alone. Gated to flagged moves only, cached aggressively, revisit cost/value at that point.

## 8. Resolved decisions

- **Hint-ladder pacing**: Level 0 nudge is always shown after every opponent move — not time-boxed, not conditional on thinking time. It's a fixed ritual step, not a "you're stuck" fallback.
- **Motif tagger trust threshold**: not a v1 concern — LLM-assisted/fallback tagging is deferred (see Phase 5), so this only needs revisiting once rule-based tagging is live and its real-world false-positive rate is observable.
- **Puzzle difficulty**: motif-focused selection, not ELO-adaptive, for v1. Generic fallback puzzles sourced from a one-time import of Lichess's public puzzle CSV dump (CC0), not a live API call.
