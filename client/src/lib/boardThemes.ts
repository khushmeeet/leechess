/** Board palettes and piece sets the user can pick from (Settings, in the nav).
 * Piece SVGs live in static/pieces/<set>/ — vendored from lichess, see
 * static/pieces/LICENSES.md. Adding a set: drop the 12 SVGs there and add a
 * row here and in pieces.css. */

export interface BoardTheme {
	name: string;
	label: string;
	light: string;
	dark: string;
	/** Set only by engraved themes: the dark squares are ruled with diagonal
	 * lines in this colour over the light square, the way a printed diagram
	 * gets a second shade out of a single ink. `dark` stays the solid stand-in
	 * the rest of the app reads — coordinates, the swatch, the eval bar. */
	hatch?: string;
}

export const BOARD_THEMES: BoardTheme[] = [
	{ name: 'brown', label: 'Brown', light: '#f0d9b5', dark: '#b58863' },
	{ name: 'green', label: 'Green', light: '#eeeed2', dark: '#769656' },
	{ name: 'blue', label: 'Ice blue', light: '#dee3e6', dark: '#8ca2ad' },
	{ name: 'walnut', label: 'Walnut', light: '#e8d0aa', dark: '#8a5c3c' },
	{ name: 'slate', label: 'Slate', light: '#ccd3db', dark: '#77828f' },
	{ name: 'plum', label: 'Plum', light: '#e9def0', dark: '#967bab' },
	{ name: 'midnight', label: 'Midnight', light: '#8593ab', dark: '#566274' },
	{ name: 'print', label: 'Print', light: '#f4eddc', dark: '#1d4e79', hatch: '#2f79ad' }
];

export const PIECE_SETS = [
	{ id: 'cburnett', label: 'Cburnett' },
	{ id: 'merida', label: 'Merida' },
	{ id: 'alpha', label: 'Alpha' },
	{ id: 'staunty', label: 'Staunty' },
	{ id: 'fresca', label: 'Fresca' },
	{ id: 'maestro', label: 'Maestro' },
	{ id: 'leipzig', label: 'Leipzig' }
] as const;

export type PieceSetId = (typeof PIECE_SETS)[number]['id'];

/** Diagonal rules for a hatched theme, as a repeating gradient. Sized in
 * pixels rather than board fractions on purpose: ruling is an ink-level
 * texture, so it should keep the same weight on a full board and on a
 * thumbnail diagram instead of scaling with the squares and turning to mush. */
function hatching(theme: BoardTheme): string {
	return `repeating-linear-gradient(45deg, ${theme.hatch} 0 2px, ${theme.light} 2px 6px)`;
}

/** The board's `background-image`: an 8×8 checkerboard as an SVG data URI,
 * plugged into cg-board via the --board-image custom property (see board.css).
 * a8 must be a light square. A hatched theme leaves the dark squares cut out
 * of the SVG and lays the ruling underneath, so it shows through only there. */
export function boardBackground(theme: BoardTheme): string {
	const darkSquares = theme.hatch
		? '' // cut out, so the ruling layer below shows through
		: `<rect x="1" width="1" height="1" fill="${theme.dark}"/>` +
			`<rect y="1" width="1" height="1" fill="${theme.dark}"/>`;
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">` +
		`<defs><pattern id="c" width="2" height="2" patternUnits="userSpaceOnUse">` +
		`<rect width="1" height="1" fill="${theme.light}"/>` +
		`<rect x="1" y="1" width="1" height="1" fill="${theme.light}"/>` +
		darkSquares +
		`</pattern></defs><rect width="8" height="8" fill="url(#c)"/></svg>`;
	const checker = `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
	return theme.hatch ? `${checker}, ${hatching(theme)}` : checker;
}

/** The custom properties a board wears, for the element wrapping cg-board. */
export function boardVars(theme: BoardTheme): string {
	// A hatched dark square is paper with lines ruled over it, so a coordinate
	// standing on one wants the same dark ink as one on a light square — the
	// usual light-on-dark would dissolve into the paper between the rules.
	const coordOnDark = theme.hatch ? theme.dark : theme.light;
	return (
		`--sq-lt: ${theme.light}; --sq-dk: ${theme.dark}; ` +
		`--coord-on-dark: ${coordOnDark}; --board-image: ${boardBackground(theme)}`
	);
}

/** The palette chip in Settings: light and dark split on the diagonal, with
 * the ruling itself standing in for the dark half when a theme has one. */
export function themeSwatch(theme: BoardTheme): string {
	if (!theme.hatch) return `linear-gradient(135deg, ${theme.light} 50%, ${theme.dark} 50%)`;
	return `linear-gradient(135deg, ${theme.light} 50%, transparent 50%), ${hatching(theme)}`;
}
