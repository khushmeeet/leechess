---
name: verify
description: Build, launch, and drive leechess (FastAPI + SvelteKit SPA) to observe a change working end-to-end at the browser/API surface.
---

# Verifying leechess changes

Two processes: FastAPI backend (`server/`) and SvelteKit SPA (`client/`).

## Launch (isolated from dev data)

```bash
# backend — throwaway DB, cheap analysis, no paid/external APIs
cd server && LEECHESS_DB_URL="sqlite:////tmp/verify.db" \
  LEECHESS_ANALYSIS_DEPTH=10 LEECHESS_EXPLANATIONS=off \
  uv run uvicorn app.main:app --port 8001   # background

# frontend — MUST be on port 4173 or 5173: the backend's CORS allowlist
# only has those two. 5173 is usually the user's own dev server — use 4173.
cd client && VITE_API_URL=http://localhost:8001 \
  npm run dev -- --port 4173 --strictPort   # background
```

Drop `LEECHESS_WIKIBOOK=off` unless you *want* live Wikibooks fetches
(the review WikiBook panel); keep `LEECHESS_EXPLANATIONS=off` always
(paid Claude API).

## Seed a game (review pages need one)

POST `/games {"mode":"local"}` → POST `/games/{id}/moves {"uci":"e2e4"}`
per ply → POST `/games/{id}/complete {"result":"1-0"}` (kicks off the
Stockfish analysis job; review page polls until complete; needs native
stockfish in PATH). A theory-rich opening for WikiBook checks: Ruy Lopez
`e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6`.

Gotcha: run API-seeding scripts with `uv run python` from `server/`
(httpx is in that venv); sandboxed inline `python3 -c` in compound shell
commands can fail with "failed to change group ID".

## Drive the UI

Playwright is installed in `client/` (`@playwright/test` + chromium).
Scripts must live in `client/` for module resolution — copy in, run,
delete:

```bash
cp script.mjs client/.verify_drive.mjs && cd client && node .verify_drive.mjs; rm -f .verify_drive.mjs
```

- Review page: `http://localhost:4173/review/{id}`; move list is
  `[data-testid="move-list"]`, moves are `[data-ply="N"]` buttons,
  ←/→ arrow keys scrub.
- Three-column WikiBook layout needs viewport ≥1280 (xl); the
  small-screen `<details>` fallback shows below that.
- Dark mode: `document.documentElement.classList.add('dark')`.

## Cleanup

`kill $(lsof -ti tcp:8001) $(lsof -ti tcp:4173)` — never touch 5173.
