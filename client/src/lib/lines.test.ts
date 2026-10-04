import { describe, expect, it } from 'vitest';
import { lineText, parseLine, playLine, sanToUci } from './lines';

/** Move 21 of the play-tested game, White to move. */
const BISHOP_HIT = 'r1b3rk/pp3p1p/2n2p2/3p1B2/P4q2/1P5P/2QN1PP1/2R2RK1 w - - 5 21';

describe('playLine', () => {
	it('numbers White moves and a line that opens with Black', () => {
		const line = playLine(BISHOP_HIT, ['f5c8', 'a8c8', 'c2c6']);
		expect(lineText(line)).toBe('21. Bxc8 Raxc8 22. Qxc6');
		const black = playLine(line[0].fenAfter, ['a8c8', 'c2c6']);
		expect(lineText(black)).toBe('21… Raxc8 22. Qxc6');
	});

	it('keeps the position before and after each move', () => {
		const [first, second] = playLine(BISHOP_HIT, ['f5c8', 'a8c8']);
		expect(first.fenBefore).toBe(BISHOP_HIT);
		expect(second.fenBefore).toBe(first.fenAfter);
		expect(second.fenAfter.split(' ')[1]).toBe('w');
	});

	it('stops at the first move that does not fit', () => {
		expect(playLine(BISHOP_HIT, ['f5c8', 'e2e4', 'a8c8']).map((move) => move.san)).toEqual([
			'Bxc8'
		]);
		expect(playLine('not a fen', ['e2e4'])).toEqual([]);
	});
});

describe('parseLine', () => {
	it('splits a stored line, and reads a missing one as empty', () => {
		expect(parseLine('f5c8 a8c8')).toEqual(['f5c8', 'a8c8']);
		expect(parseLine(null)).toEqual([]);
		expect(parseLine('')).toEqual([]);
	});
});

describe('sanToUci', () => {
	it('reads a move in its position', () => {
		expect(sanToUci(BISHOP_HIT, 'Be6')).toBe('f5e6');
		expect(sanToUci(BISHOP_HIT, 'Nf6')).toBeNull();
	});
});
