# Royal Study

The visual language follows the concepts in `../design/feature-previews`: aged parchment, sepia ink, wooden boards, fine rules, and oxblood actions. Book-serif text, bold Old Standard headings, small-cap navigation, and subtle paper grain give the interface the character of an old chess manual.

## Shared foundations

- `src/routes/layout.css` owns semantic colors, typography, panel and button styles, and responsive composition. Dark mode uses the same roles on a walnut surface.
- `BrandMark.svelte` renders the knight in `currentColor`; `PageHeading.svelte` keeps page titles, descriptions, filters, and secondary actions consistent.
- Use `.study-panel` for grouped content, `.section-title` for serif panel titles, and `.eyebrow` for small section labels. Use the book-serif face for body copy and controls. Reserve explicit sans-serif or monospace styles for notation and compact numerical readouts.
- Use `.btn-primary` for the main action and `.btn-secondary` for its alternative. Brass marks ornament and structure; red marks actions and the current navigation destination. Move classifications keep their established status colors and text labels.
- `.board-layout` places the board beside its guidance and stacks below 44rem. `.board-column` reserves space for the optional evaluation bar so toggling it never changes the board geometry.
- Board frames are outlines and shadows outside chessground's measured area. Coordinates stay inside their squares. New visitors get Antique × Merida; existing saved board and piece choices are honored.

## Density

The main navigation is 48px tall. Page titles are 26px, panel titles 18px, panel padding 12px, and standard actions 32px tall. Working page headings occupy one line; ornamental introductions do not displace the board. The board column is capped by viewport height, while the evaluation gutter remains fixed when toggled.

The browser suite verifies that the whole practice board and New game action fit at 1280×720. At phone widths, the same controls stack in normal document flow; navigation drops small caps to keep every destination visible.

## Interaction and verification

Printer's ornaments sit on page rules; inset hairlines and board-corner inlays add detail without changing the board's measured area. Decorative layers ignore pointer input. Filled diamonds mark the side to move, and notation uses ruled rows, a marginal line, and an ink mark for the latest or selected move. These cues stay static during frequent interactions.

Settings previews show the actual square palette, with checkmarks as well as borders for selected board and piece choices. Escape closes settings and restores focus to its trigger. Keep decorative marks small and purposeful; do not grow panels to make room for ornament.

Keyboard focus remains visible, the header includes a skip link, controls retain native semantics, and theme changes suppress intermediate transitions. Reduced-motion preferences disable press scaling and retain existing motion accommodations.

`e2e/design.e2e.ts` checks 320px navigation, settings and evaluation-bar overflow, mobile account flows, theme and board persistence, and active navigation on review detail. It also writes screenshots into Playwright's per-test output folders. Existing chess, account, review, puzzle, progress, and zen tests cover the underlying interactions.

Main text and action pairs exceed 4.5:1 in both appearances, including text on the darker navigation surface (4.54:1 minimum checked pair).

The concept-only lesson and guided-exercise features are outside this visual update; navigation continues to expose the app's implemented features.
