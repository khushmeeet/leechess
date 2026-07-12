# Literature: Wikipedia live-sync plan (option 3, not yet implemented)

The Literature screen currently ships hand-curated static data
(`client/src/lib/literature/{terms,history,games}.ts`): original definitions
written against cited sources, with game scores machine-verified by
python-chess and cross-checked against their Wikipedia articles. This document
is the plan for the deferred "option 3": keeping that content synced from
Wikipedia itself.

## Recommendation: build-time sync, not runtime fetching

Fetch and parse Wikipedia in a **sync script run at build/dev time**, committing
the generated data. Runtime fetching in the SPA is the wrong tool here:

- The content changes on the order of months; users would pay network latency,
  CORS/availability risk, and parser fragility on every visit for no freshness
  benefit.
- The app is offline-friendly today (pure static SPA + local API); runtime
  fetching would regress that.
- Committing generated data keeps every content change reviewable in a diff —
  important because a vandalized or restructured Wikipedia page would otherwise
  flow straight to users.

## Source pages

| Section     | Page                                             | Extraction target                          |
| ----------- | ------------------------------------------------ | ------------------------------------------ |
| Terminology | `Glossary_of_chess`                              | `<dl>` definition lists: `<dt id>` → term, `<dd>` → definition |
| History     | `History_of_chess`                               | Section lead paragraphs (TextExtracts)     |
| Games       | `List_of_chess_games` + per-game articles        | Entry metadata; movetext from game article |

## MediaWiki endpoints

- Rendered HTML + revision id (main workhorse):
  `https://en.wikipedia.org/w/api.php?action=parse&page=Glossary_of_chess&prop=text|revid&format=json&formatversion=2`
- Plain-text section extracts (history summaries):
  `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&titles=History_of_chess&explaintext=1&format=json`
- Change detection without downloading content:
  `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=ids|timestamp&titles=...`

Etiquette (Wikimedia API policy): send a descriptive `User-Agent` with a
contact address, stay well under 1 request/second, pass `maxlag=5`, and cache
responses locally between runs.

## Script design

`server/scripts/sync_literature.py` (python — python-chess is already in the
server venv for PGN validation):

1. For each source page, fetch current `revid`; compare against
   `literature.lock.json` (page → revid, timestamp). Unchanged → skip.
2. Parse changed pages into the exact interfaces the UI already consumes
   (`Term`, `Era`, `LandmarkGame`) and emit
   `client/src/lib/literature/generated/*.json`.
3. Strip citation markers (`[1]`), resolve relative wiki links to absolute
   URLs, and truncate definitions to the first one–two sentences.
4. Validate before writing: every game PGN must parse fully legally in
   python-chess (and end in checkmate where claimed); term count must not drop
   more than ~10% from the previous run (guard against page restructuring);
   otherwise abort and keep last-good data.
5. Update the lock file. Run manually or as a monthly CI job; the diff gets
   reviewed like any PR.

## Licensing — the important difference from today

The current definitions are **original text** (facts sourced, wording ours) and
carry no license obligations. Verbatim Wikipedia text is **CC BY-SA 4.0**:

- Attribute each page (link to the article and to the license) — a footer on
  the Literature screen plus an entry alongside `static/pieces/LICENSES.md`.
- Adapted/synced text must remain under CC BY-SA (share-alike). Do not blend
  it silently with the original hand-written text; keep synced entries marked
  (e.g. a `license: 'CC-BY-SA-4.0'` field) so the UI can attribute precisely.

## If runtime fetching is ever truly wanted

Fetch on first visit via the REST endpoint, cache in `localStorage` keyed by
revid with a ~30-day TTL, and always fall back to the bundled generated data
when offline or on parse failure. This buys real-time freshness at the cost of
all the risks above — only worth it if the Literature corpus grows far beyond
what we want to ship in the bundle.
