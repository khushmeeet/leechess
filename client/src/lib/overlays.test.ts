import { describe, expect, it } from 'vitest';
import {
	control,
	files,
	kingDanger,
	leastActivePiece,
	loosePieces,
	overlayMarks,
	pins,
	safeSquares
} from './overlays';

/** Move 21 of the play-tested game: the bishop on f5 is attacked by the
 * queen and the c8 bishop and defended once by the queen on c2. */
const BISHOP_HIT = 'r1b3rk/pp3p1p/2n2p2/3p1B2/P4q2/1P5P/2QN1PP1/2R2RK1 w - - 5 21';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('loosePieces', () => {
	it('finds a piece attacked more often than it is defended', () => {
		expect(loosePieces(BISHOP_HIT)).toContainEqual({
			square: 'f5',
			color: 'w',
			kind: 'underdefended'
		});
	});

	it('calls an undefended attacked piece hanging, and leaves safe ones alone', () => {
		const fen = '4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1'; // e4 hits the lone knight
		expect(loosePieces(fen)).toEqual([{ square: 'd5', color: 'b', kind: 'hanging' }]);
		expect(loosePieces(START)).toEqual([]);
	});
});

describe('pins', () => {
	it('finds a piece that cannot leave the line to its king', () => {
		// the knight on c6 stands between the bishop on b5 and the king on e8
		const fen = 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
		expect(pins(fen)).toEqual([]); // d7 pawn still blocks: no pin yet
		const pinned = 'r1bqkbnr/ppp2ppp/2np4/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4';
		expect(pins(pinned)).toEqual([{ pinned: 'c6', by: 'b5', king: 'e8' }]);
	});
});

describe('control, files and kings', () => {
	it('gives the centre to nobody at the start, and the third rank to White', () => {
		const owner = control(START);
		expect(owner.get('e4')).toBeUndefined();
		expect(owner.get('e3')).toBe('w');
		expect(owner.get('e6')).toBe('b');
	});

	it('names open and half-open files', () => {
		// White has no e-pawn, Black no d-pawn; the c-file has none at all
		const fen = '4k3/pp3ppp/4p3/8/3P4/8/PP3PPP/4K3 w - - 0 1';
		expect(files(fen)).toEqual([
			{ file: 'c', kind: 'open' },
			{ file: 'd', kind: 'black' },
			{ file: 'e', kind: 'white' }
		]);
	});

	it('marks the squares around a king the other side attacks', () => {
		// the rook on h2 sweeps the second rank beside the king on e1
		const fen = '4k3/8/8/8/8/8/7r/4K3 w - - 0 1';
		expect(kingDanger(fen).sort()).toEqual(['d2', 'e2', 'f2']);
	});
});

describe('safe squares and the least active piece', () => {
	it('counts only squares the piece is not lost on', () => {
		// a bishop on c1 behind its own pawns has nowhere to go
		expect(safeSquares(START, 'c1')).toEqual([]);
		// the knight on b1 has a3 and c3, both safe
		expect(safeSquares(START, 'b1').sort()).toEqual(['a3', 'c3']);
	});

	it('names the piece with the fewest safe squares, preferring the minor piece', () => {
		expect(leastActivePiece(START, 'w')).toEqual({ square: 'c1', name: 'bishop', safe: 0 });
	});

	it('names no piece when every one has room', () => {
		const open = '4k3/8/8/8/3N4/8/8/4K3 w - - 0 1';
		expect(leastActivePiece(open, 'w')).toBeNull();
	});
});

describe('overlayMarks', () => {
	it('combines the classes of the overlays switched on, and only those', () => {
		const { classes, pinLines } = overlayMarks(BISHOP_HIT, new Set(['loose', 'king']));
		expect(classes.get('f5')).toContain('ov-underdefended');
		expect(pinLines).toEqual([]);
		expect(overlayMarks(BISHOP_HIT, new Set()).classes.size).toBe(0);
	});
});
