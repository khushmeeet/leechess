# chess-openings data

Vendored from <https://github.com/lichess-org/chess-openings> at commit
`292fd0468068f58bb244f7fe1c3e573e493c3c53` (2026-07-12). License: CC0 (public domain).

Columns: `eco`, `name`, `pgn`. `scripts/build-openings.js` replays each PGN and
emits `static/openings.json` keyed by EPD for in-game opening lookup.
