import { describe, expect, it } from 'vitest';
import { linkNotation, targetSquare } from './notation';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** White to move; Black's bishop on g4 eyes the queen on d1. */
const BISHOP_EYES_QUEEN = '4k3/8/8/8/6b1/8/8/3QK3 w - - 0 1';
const PASSED = '4k3/8/8/8/6b1/8/8/3QK3 b - - 0 1';

/** Just the notation, as [text, target] pairs. */
function tokens(...args: Parameters<typeof linkNotation>) {
	return linkNotation(...args)
		.filter((segment) => segment.target)
		.map((segment) => [segment.text, segment.target]);
}

describe('linkNotation', () => {
	it('finds the threat move in the passed position and the square it names', () => {
		const text =
			'Black threatens …Bxd1, winning material: the queen on d1 is worth more than the bishop that takes it.';
		expect(tokens(text, [PASSED, BISHOP_EYES_QUEEN])).toEqual([
			['…Bxd1', { kind: 'move', from: 'g4', to: 'd1' }],
			['d1', { kind: 'square', square: 'd1' }]
		]);
	});

	it('keeps the prose around the notation intact', () => {
		const text = 'Stockfish prefers Qd2. Keep going.';
		const segments = linkNotation(text, [BISHOP_EYES_QUEEN]);
		expect(segments.map((segment) => segment.text).join('')).toBe(text);
		expect(segments).toEqual([
			{ text: 'Stockfish prefers ', target: null },
			{ text: 'Qd2', target: { kind: 'move', from: 'd1', to: 'd2' } },
			{ text: '. Keep going.', target: null }
		]);
	});

	it('reads a bare square as a move only when the text says it is one', () => {
		expect(tokens('Stockfish prefers d4.', [START])).toEqual([
			['d4', { kind: 'move', from: 'd2', to: 'd4' }]
		]);
		// e2–e4 is legal here, but "the pawn on e4" is about the square
		expect(tokens('the pawn on e4 is weak', [START])).toEqual([
			['e4', { kind: 'square', square: 'e4' }]
		]);
		expect(tokens('moving off f2 uncovers the rook on f1', [START])).toEqual([
			['f2', { kind: 'square', square: 'f2' }],
			['f1', { kind: 'square', square: 'f1' }]
		]);
	});

	it('plays a line through, move by move', () => {
		expect(tokens('e4 e5 Nf3', [START], { line: true })).toEqual([
			['e4', { kind: 'move', from: 'e2', to: 'e4' }],
			['e5', { kind: 'move', from: 'e7', to: 'e5' }],
			['Nf3', { kind: 'move', from: 'g1', to: 'f3' }]
		]);
		// without the flag, a move right after a move continues the line
		expect(tokens('Full line: e4 e5', [START])).toEqual([
			['e4', { kind: 'move', from: 'e2', to: 'e4' }],
			['e5', { kind: 'move', from: 'e7', to: 'e5' }]
		]);
	});

	it('takes a move number or ellipsis in with the move', () => {
		const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
		expect(tokens('1... e5 holds the centre', [afterE4])).toEqual([
			['1... e5', { kind: 'move', from: 'e7', to: 'e5' }]
		]);
		expect(tokens('After 1. e4, the reply …e5 is natural', [START])).toEqual([
			['1. e4', { kind: 'move', from: 'e2', to: 'e4' }],
			['…e5', { kind: 'move', from: 'e7', to: 'e5' }]
		]);
	});

	it('resolves castling', () => {
		const castle = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
		expect(tokens('White prefers O-O-O.', [castle])).toEqual([
			['O-O-O', { kind: 'move', from: 'e1', to: 'c1' }]
		]);
	});

	it('leaves a move that fits none of the positions as plain text', () => {
		expect(tokens('Stockfish prefers Nf6.', [START])).toEqual([]);
	});

	it('does not find notation inside words or numbers', () => {
		expect(tokens('A 1400.5 rating, Be careful, b4x', [START])).toEqual([]);
	});
});

describe('targetSquare', () => {
	it('is the piece that moves, or the square named', () => {
		expect(targetSquare({ kind: 'move', from: 'g4', to: 'd1' })).toBe('g4');
		expect(targetSquare({ kind: 'square', square: 'd1' })).toBe('d1');
	});
});
