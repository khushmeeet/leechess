/** Board palettes and piece sets the user can pick from (Settings, in the nav).
 * Piece SVGs live in static/pieces/<set>/ — vendored from lichess, see
 * static/pieces/LICENSES.md. Adding a set: drop the 12 SVGs there and add a
 * row here and in pieces.css. */

export interface BoardTheme {
	name: string;
	label: string;
	light: string;
	dark: string;
}

export const BOARD_THEMES: BoardTheme[] = [
	{ name: 'brown', label: 'Brown', light: '#f0d9b5', dark: '#b58863' },
	{ name: 'green', label: 'Green', light: '#eeeed2', dark: '#769656' },
	{ name: 'blue', label: 'Ice blue', light: '#dee3e6', dark: '#8ca2ad' },
	{ name: 'walnut', label: 'Walnut', light: '#e8d0aa', dark: '#8a5c3c' },
	{ name: 'slate', label: 'Slate', light: '#ccd3db', dark: '#77828f' },
	{ name: 'plum', label: 'Plum', light: '#e9def0', dark: '#967bab' },
	{ name: 'midnight', label: 'Midnight', light: '#8593ab', dark: '#566274' }
];

export const PIECE_SETS = [
	{ id: 'cburnett', label: 'Cburnett' },
	{ id: 'merida', label: 'Merida' },
	{ id: 'alpha', label: 'Alpha' },
	{ id: 'staunty', label: 'Staunty' },
	{ id: 'fresca', label: 'Fresca' },
	{ id: 'maestro', label: 'Maestro' }
] as const;

export type PieceSetId = (typeof PIECE_SETS)[number]['id'];

/** The 8×8 checkerboard as an SVG data URI, plugged into cg-board via the
 * --board-image custom property (see board.css). a8 must be a light square. */
export function boardImageUrl(theme: BoardTheme): string {
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">` +
		`<defs><pattern id="c" width="2" height="2" patternUnits="userSpaceOnUse">` +
		`<rect width="2" height="2" fill="${theme.light}"/>` +
		`<rect x="1" width="1" height="1" fill="${theme.dark}"/>` +
		`<rect y="1" width="1" height="1" fill="${theme.dark}"/>` +
		`</pattern></defs><rect width="8" height="8" fill="url(#c)"/></svg>`;
	return `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
}
