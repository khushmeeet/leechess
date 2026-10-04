# chess-openings data

Vendored from <https://github.com/lichess-org/chess-openings> at commit
`292fd0468068f58bb244f7fe1c3e573e493c3c53` (2026-07-12). License: CC0 (public domain).

Columns: `eco`, `name`, `pgn`. Two readers, kept in agreement by replaying the
same lines:

- `client/scripts/build-openings.js` emits `client/static/openings.json` keyed by
  EPD, for the in-game opening name and the live badge's book check.
- `server/app/openings.py` builds the set of book positions the analysis job
  grades against: a move into one is graded "book".

Every position along a line is book, not only its last one.
