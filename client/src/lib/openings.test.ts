import { describe, expect, it, vi } from 'vitest';
import {
	epdFromFen,
	loadOpenings,
	lookupEpd,
	openingForFens,
	openingsReady,
	splitOpeningName
} from './openings';

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

function fetchStub(response: Partial<Response>): typeof fetch {
	return (() => Promise.resolve(response as Response)) as typeof fetch;
}

describe('epdFromFen', () => {
	it('drops the halfmove and fullmove counters', () => {
		expect(epdFromFen(E4_FEN)).toBe(E4_EPD);
	});
});

describe('splitOpeningName', () => {
	it('treats a name without a colon as the main line', () => {
		expect(splitOpeningName('Van Geet Opening')).toEqual({
			family: 'Van Geet Opening',
			variation: null
		});
	});

	it('splits family and variation on the first colon', () => {
		expect(splitOpeningName('Sicilian Defense: Najdorf Variation: English Attack')).toEqual({
			family: 'Sicilian Defense',
			variation: 'Najdorf Variation: English Attack'
		});
	});
});

describe('loadOpenings / lookupEpd', () => {
	it('fails soft and allows a retry', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(openingsReady()).toBe(false);
		expect(await loadOpenings(fetchStub({ ok: false, status: 500 }))).toBe(false);
		expect(openingsReady()).toBe(false);
		expect(lookupEpd(E4_FEN)).toBeNull();
		error.mockRestore();
	});

	it('loads once and resolves lookups by EPD', async () => {
		const stub = fetchStub({ ok: true, json: () => Promise.resolve(BOOK) });
		expect(await loadOpenings(stub)).toBe(true);
		expect(openingsReady()).toBe(true);
		expect(lookupEpd(E4_FEN)).toEqual({ eco: 'B00', name: "King's Pawn Game" });
		// full FENs with counters resolve through the same key format
		expect(lookupEpd('8/8/8/8/8/8/8/K6k w - - 0 1')).toBeNull();
	});

	// these reuse the book loaded above (module-level cache)
	describe('openingForFens', () => {
		it('names the deepest book hit', () => {
			expect(openingForFens(['sicilian w - -', 'sicilian-modern w - -'])).toEqual({
				eco: 'B50',
				family: 'Sicilian Defense',
				variation: 'Modern Variations',
				deepestPly: 2
			});
		});

		it('keeps a same-family variation when a coarser entry follows', () => {
			const line = openingForFens([
				'sicilian w - -',
				'sicilian-modern w - -',
				'sicilian-coarse w - -'
			]);
			expect(line).toEqual({
				eco: 'B50',
				family: 'Sicilian Defense',
				variation: 'Modern Variations',
				deepestPly: 3
			});
		});

		it('drops a variation from a different family', () => {
			expect(openingForFens(['knight-normal w - -', 'italian w - -'])).toEqual({
				eco: 'C50',
				family: 'Italian Game',
				variation: null,
				deepestPly: 2
			});
		});

		it('freezes at the deepest hit once past book', () => {
			const line = openingForFens(['sicilian-modern w - -', 'unknown w - -']);
			expect(line?.deepestPly).toBe(1);
			expect(line?.variation).toBe('Modern Variations');
		});

		it('returns null when nothing matched', () => {
			expect(openingForFens(['unknown w - -'])).toBeNull();
		});
	});
});
