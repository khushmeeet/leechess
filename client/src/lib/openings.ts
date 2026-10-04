/** Opening-book lookup for the in-game insight bar.
 *
 * The book is static/openings.json — every position along every named
 * opening in the lichess chess-openings dataset, keyed by EPD (FEN minus move
 * counters), built at dev/build time by scripts/build-openings.js. A line's
 * final position carries its [eco, name]; positions on the way there are null
 * (book, but unnamed). Positions are matched by EPD so transpositions into a
 * known line still resolve. The JSON (~700KB) is fetched lazily and failure
 * is soft: lookups just return null, and nothing counts as book.
 */

export interface Opening {
	eco: string;
	name: string;
}

let book: Map<string, Opening> | null = null;
/** Every book position, named or passed through on the way to one. */
let bookPositions: Set<string> | null = null;
let loading: Promise<boolean> | null = null;

/** FEN without the halfmove/fullmove counters — the book's key format. */
export function epdFromFen(fen: string): string {
	return fen.split(' ').slice(0, 4).join(' ');
}

/** Fetch the book once; safe to call repeatedly. Resolves false on failure. */
export function loadOpenings(fetchFn: typeof fetch = fetch): Promise<boolean> {
	loading ??= fetchFn('/openings.json')
		.then(async (response) => {
			if (!response.ok) throw new Error(`openings.json: HTTP ${response.status}`);
			const data = (await response.json()) as Record<string, [string, string] | null>;
			book = new Map();
			for (const [epd, entry] of Object.entries(data)) {
				if (entry) book.set(epd, { eco: entry[0], name: entry[1] });
			}
			bookPositions = new Set(Object.keys(data));
			return true;
		})
		.catch((error) => {
			console.error('opening book failed to load:', error);
			loading = null; // allow a retry on the next game
			return false;
		});
	return loading;
}

export function openingsReady(): boolean {
	return book !== null;
}

export function lookupEpd(fen: string): Opening | null {
	return book?.get(epdFromFen(fen)) ?? null;
}

/** The position is on a known opening line — a move into it is a book move,
 * which move grading leaves ungraded (see `classifyMove`). False until the
 * book has loaded. */
export function inBook(fen: string): boolean {
	return bookPositions?.has(epdFromFen(fen)) ?? false;
}

/** Dataset names read "Family: Variation"; no colon = family umbrella only. */
export function splitOpeningName(name: string): { family: string; variation: string | null } {
	const colon = name.indexOf(': ');
	if (colon === -1) return { family: name, variation: null };
	return { family: name.slice(0, colon), variation: name.slice(colon + 2) };
}

export interface OpeningLine {
	eco: string;
	family: string;
	variation: string | null;
	/** 1-based index of the last FEN that was a book hit. */
	deepestPly: number;
}

/** The opening reached along a game (post-move FENs in order): the deepest
 * book hit names the line, but a coarse family-only entry never erases a
 * variation named earlier in the same family — e.g. the Sicilian's
 * "Modern Variations" (2...d6) survives 3.d4, whose entry is just
 * "Sicilian Defense". Variations from a different family are dropped. */
export function openingForFens(fens: readonly string[]): OpeningLine | null {
	let deepest: { opening: Opening; ply: number } | null = null;
	let named: { family: string; variation: string } | null = null;
	for (const [index, fen] of fens.entries()) {
		const hit = lookupEpd(fen);
		if (!hit) continue;
		deepest = { opening: hit, ply: index + 1 };
		const { family, variation } = splitOpeningName(hit.name);
		if (variation) named = { family, variation };
	}
	if (!deepest) return null;
	const { family, variation } = splitOpeningName(deepest.opening.name);
	return {
		eco: deepest.opening.eco,
		family,
		variation: variation ?? (named?.family === family ? named.variation : null),
		deepestPly: deepest.ply
	};
}
