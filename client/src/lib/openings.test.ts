import { beforeEach, describe, expect, it, vi } from 'vitest';

// openings.ts caches the book in module scope, which is right for the app (one
// 450KB fetch per session) and wrong for a test file: tests that shared the
// cache could only pass in file order, and running one on its own returned
// null. Every test here gets a freshly imported module instead, so each is
// runnable and reorderable on its own.
type OpeningsModule = typeof import('./openings');

const E4_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const E4_EPD = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -';

// stub book; keys are fake EPDs (any 4-field string round-trips epdFromFen)
const BOOK: Record<string, [string, string]> = {
	[E4_EPD]: ['B00', "King's Pawn Game"],
	'sicilian w - -': ['B20', 'Sicilian Defense'],
	'sicilian-modern w - -': ['B50', 'Sicilian Defense: Modern Variations'],
	'sicilian-coarse w - -': ['B50', 'Sicilian Defense'],
	'knight-normal w - -': ['C44', "King's Knight Opening: Normal Variation"],
	'italian w - -': ['C50', 'Italian Game']
};

function okFetch() {
	return vi.fn(
		() =>
			Promise.resolve({ ok: true, json: () => Promise.resolve(BOOK) } as Response) as ReturnType<
				typeof fetch
			>
	);
}

function failingFetch(status = 500) {
	return vi.fn(
		() => Promise.resolve({ ok: false, status } as Response) as ReturnType<typeof fetch>
	);
}

let openings: OpeningsModule;

beforeEach(async () => {
	vi.resetModules();
	openings = await import('./openings');
});

/** Load the stub book into the freshly imported module. */
async function withBook(): Promise<OpeningsModule> {
	expect(await openings.loadOpenings(okFetch())).toBe(true);
	return openings;
}

describe('epdFromFen', () => {
	it('drops the halfmove and fullmove counters', () => {
		expect(openings.epdFromFen(E4_FEN)).toBe(E4_EPD);
	});
});

describe('splitOpeningName', () => {
	it('treats a name without a colon as the main line', () => {
		expect(openings.splitOpeningName('Van Geet Opening')).toEqual({
			family: 'Van Geet Opening',
			variation: null
		});
	});

	it('splits family and variation on the first colon', () => {
		expect(
			openings.splitOpeningName('Sicilian Defense: Najdorf Variation: English Attack')
		).toEqual({
			family: 'Sicilian Defense',
			variation: 'Najdorf Variation: English Attack'
		});
	});
});

describe('loadOpenings / lookupEpd', () => {
	it('fails soft and allows a retry', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(openings.openingsReady()).toBe(false);
		expect(await openings.loadOpenings(failingFetch())).toBe(false);
		expect(openings.openingsReady()).toBe(false);
		expect(openings.lookupEpd(E4_FEN)).toBeNull();

		// the retry the failure cleared the way for actually succeeds
		expect(await openings.loadOpenings(okFetch())).toBe(true);
		expect(openings.openingsReady()).toBe(true);
		error.mockRestore();
	});

	it('resolves lookups by EPD once loaded', async () => {
		await withBook();
		expect(openings.openingsReady()).toBe(true);
		expect(openings.lookupEpd(E4_FEN)).toEqual({ eco: 'B00', name: "King's Pawn Game" });
		// full FENs with counters resolve through the same key format
		expect(openings.lookupEpd('8/8/8/8/8/8/8/K6k w - - 0 1')).toBeNull();
	});

	it('fetches the 450KB book only once, however many callers ask', async () => {
		const fetchSpy = okFetch();
		// concurrent callers (the Play screen and a restored game race on mount)
		const [first, second] = await Promise.all([
			openings.loadOpenings(fetchSpy),
			openings.loadOpenings(fetchSpy)
		]);
		// and a later one, after the book is already in memory
		const third = await openings.loadOpenings(fetchSpy);

		expect([first, second, third]).toEqual([true, true, true]);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(fetchSpy).toHaveBeenCalledWith('/openings.json');
	});

	it('does not cache a failed load, so the next game can retry', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const failing = failingFetch(503);
		expect(await openings.loadOpenings(failing)).toBe(false);
		expect(await openings.loadOpenings(failing)).toBe(false);
		expect(failing).toHaveBeenCalledTimes(2);
		error.mockRestore();
	});
});

describe('openingForFens', () => {
	// Each of these loads its own book — none depends on a test above having
	// run first.
	it('names the deepest book hit', async () => {
		const { openingForFens } = await withBook();
		expect(openingForFens(['sicilian w - -', 'sicilian-modern w - -'])).toEqual({
			eco: 'B50',
			family: 'Sicilian Defense',
			variation: 'Modern Variations',
			deepestPly: 2
		});
	});

	it('keeps a same-family variation when a coarser entry follows', async () => {
		const { openingForFens } = await withBook();
		expect(
			openingForFens(['sicilian w - -', 'sicilian-modern w - -', 'sicilian-coarse w - -'])
		).toEqual({
			eco: 'B50',
			family: 'Sicilian Defense',
			variation: 'Modern Variations',
			deepestPly: 3
		});
	});

	it('drops a variation from a different family', async () => {
		const { openingForFens } = await withBook();
		expect(openingForFens(['knight-normal w - -', 'italian w - -'])).toEqual({
			eco: 'C50',
			family: 'Italian Game',
			variation: null,
			deepestPly: 2
		});
	});

	it('freezes at the deepest hit once past book', async () => {
		const { openingForFens } = await withBook();
		const line = openingForFens(['sicilian-modern w - -', 'unknown w - -']);
		expect(line?.deepestPly).toBe(1);
		expect(line?.variation).toBe('Modern Variations');
	});

	it('returns null when nothing matched', async () => {
		const { openingForFens } = await withBook();
		expect(openingForFens(['unknown w - -'])).toBeNull();
	});

	it('returns null before the book has loaded at all', () => {
		// no withBook() here: an unloaded book must read as "out of book",
		// never throw
		expect(openings.openingForFens(['sicilian w - -'])).toBeNull();
	});
});
