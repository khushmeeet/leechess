# Chess Learning App — Architecture

## 1. Features

### Core loop (MVP)
- **Live play vs. engine or vs. a friend (local/online)** with a real board (drag/click to move, legal-move highlighting)
- **Pre-move nudges** (opt-in, toggleable): a lightweight prompt before you commit a move — "checks/captures/threats?", "anything hanging?" — not the answer, a cue to look
- **Post-move feedback**: classification (best/good/inaccuracy/mistake/blunder) + eval swing, shown immediately
- **Escalating hint ladder** for any position you're stuck on (see the hint-levels design below) — you pull the hint, it doesn't push itself
- **Motif tagging**: every tactical/strategic idea in the position gets a tag (fork, pin, outpost, weak back rank, etc.) pulled from a fixed taxonomy
- **Plain-language "why"**: one paragraph explaining why the best move works and why your move didn't — this is the part no existing tool (Lichess, Chess.com, Chessbase) does well
- **Post-game report**: accuracy, CPL graph, blunder/mistake/inaccuracy counts (you already have UI references for this), but layered with *recurring motif frequency* — "you've missed forks 6 times this month" instead of just raw accuracy

### V2 features
- **Spaced-repetition puzzle queue**, auto-populated from *your own* missed tactics (not generic puzzle sets) — this is the single highest-leverage feature and nobody does it well
- **Opening repertoire tracker**: tied to your actual games, flags when you left book and what the book move was
- **Endgame drill mode**: isolated K+P, K+R positions with the "why" narration
- **Thinking-process trainer**: a mode that forces you to write/select candidate moves before the engine reveals anything (trains CCT discipline instead of pattern memorization)
- **Progress dashboard**: motif mastery over time (e.g., a radar chart across fork/pin/skewer/back-rank/endgame-technique)

### Explicitly not building (v1)
- Multiplayer matchmaking / rating ladder — use Lichess API for actual games, focus your app on the learning layer
- Anti-cheat, tournaments, social features

## 2. Layout

Four primary screens, one shared board component.

```
┌─────────────────────────────────────────────┐
│  Nav: Play | Review | Puzzles | Progress     │
└─────────────────────────────────────────────┘

PLAY screen
┌───────────────────┬──────────────────────────┐
│                    │  Move list (scrollable)  │
│      Board         │  Eval bar (toggleable)   │
│   (drag/click)     │  Hint ladder panel:      │
│                    │   [Level 1] [Level 2]... │
│                    │  "Your move" prompt       │
└───────────────────┴──────────────────────────┘

REVIEW screen (post-game)
┌───────────────────┬──────────────────────────┐
│   Board + arrows   │  CPL graph (like your    │
│   for selected     │  screenshot) with click- │
│   move             │  through move list        │
│                    │  Motif tags per move       │
│                    │  "Why" explanation panel   │
└───────────────────┴──────────────────────────┘
Bottom: accuracy / blunder counts / "practice these misses"

PUZZLES screen
- Single board, hint ladder, sourced from your own
  missed tactics first, generic sets as filler

PROGRESS screen
- Motif radar/heatmap, CPL trend line, streaks
```

### Hint ladder (core UX primitive, used on Play/Review/Puzzles)
Reveal on request, one level at a time, never all at once:

| Level | Reveals |
|---|---|
| 0 | Generic prompt: "checks, captures, threats?" |
| 1 | Category: "there's a tactic" / "positional decision" |
| 2 | Motif: "look for a fork" |
| 3 | Squares/pieces highlighted, no move shown |
| 4 | The move + one-line reason |
| 5 | Full line + why alternatives fail |

## 3. Tech stack

### Web app — yes, correct call
Cross-platform for free, Stockfish compiles to WASM cleanly, no app-store friction for something you're iterating on constantly.

### Client vs. server split for Stockfish — hybrid, not either/or

**Client-side (Stockfish WASM, e.g. `stockfish.wasm` / `lila-stockfish-web`)**
Use for: live play, real-time hints while thinking, instant eval bar during Review scrubbing.
Why: zero server compute cost, zero latency, works at depth 16–20 fine on any modern laptop/phone in a few hundred ms. This is what Lichess itself does for local analysis.
Caveat: multi-threaded WASM needs `SharedArrayBuffer`, which needs `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers set on your responses — trivial in a Go server (`w.Header().Set(...)`) but easy to forget and silently fall back to single-threaded.

**Server-side (native Stockfish binary on the Fly machine)**
Use for: full-game batch analysis after a game ends (every move, higher depth, run once, cache forever), and as the thing your motif-tagging + LLM-explanation pipeline reads from.
Why: you don't want to burn a user's battery running 40 moves at depth 22 the moment a game ends, and you want the result cached in SQLite so it's a one-time cost, not recomputed every time they open Review.

So: **client WASM for anything interactive/real-time, server-side native binary for one-shot batch jobs whose output gets persisted.** This also matches your existing Fly.io + Go + SQLite pattern — a Go endpoint that shells out to a native `stockfish` process (much faster than WASM) as an async job after game completion, writes eval/motif/explanation rows to SQLite, and the client just reads cached results in Review.

### Suggested stack
- **Backend**: Python (FastAPI) — swapped from Go per decision to lean on Python's analysis ecosystem, deployed to Fly.io
- **DB**: SQLite (games, moves, evals, motif tags, hint-reveal state, user progress) — fine at this scale
- **Engine**:
  - Client: `stockfish.wasm` via a Web Worker, invoked through the standard UCI-over-postMessage pattern
  - Server: native Stockfish binary, driven via `python-chess`'s `chess.engine` module (clean async UCI wrapper, no need to hand-roll stdin/stdout protocol handling), orchestrated as an async job queue (FastAPI background tasks or a lightweight `arq`/`RQ` queue backed by the same SQLite/Redis-free setup — no need for Celery at this scale)
- **Motif tagging**: rule-based first pass using `python-chess` for board/attack-map queries (e.g., "does the best move's target square get attacked by two black pieces after the reply" → fork), same taxonomy as before, informed by Lichess's open-source puzzle-theme logic; this is where Python's ecosystem genuinely helps — `python-chess` is more complete than any Go chess library, and pandas makes the later motif-frequency/progress-analytics work (Progress screen, spaced-repetition selection) much less code than hand-rolled Go structs
- **LLM explanation pass**: Claude via API, fed FEN + eval line + rule-based tag, called only for flagged moves (mistakes/blunders/tagged tactics), cached in SQLite so it's a one-time cost per position
- **Frontend**: React or Svelte for real component/drag state; `chessground` (Lichess's own board library) or `react-chessboard` for the board itself — don't build board rendering/drag-drop from scratch
- **PGN/move parsing**: `chess.js` on the client (for instant legality feedback during play) + `python-chess` on the server (source of truth for stored games, batch analysis, and motif detection)

### Data flow for a finished game
```
Client plays game (client Stockfish for live hints)
   → PGN sent to Python backend on game end
   → Backend queues async job: native Stockfish (via python-chess) analyzes
     full game at depth
   → Rule-based motif tagger (python-chess board/attack queries) runs on
     each critical position
   → LLM call generates plain-language "why" for flagged moves only
     (not every move — just mistakes/blunders/tagged tactics, to control cost)
   → Results written to SQLite (per-move: eval, classification, motifs, explanation)
   → Client's Review screen reads from SQLite, renders instantly on repeat visits
```

This keeps your interactive path fast and free (client WASM), your expensive path (LLM calls, deep analysis) bounded to once-per-game and cached, and gives you `python-chess` + pandas for the analytics-heavy parts (motif stats, progress tracking, spaced-repetition selection) where Python's ecosystem is a real advantage over Go.
