import { describe, expect, it } from 'vitest';
import { readCheck, stainClip } from './boardCheck';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('readCheck', () => {
	it('finds nothing in a quiet position', () => {
		expect(readCheck(START)).toBeNull();
	});

	it('names the checked side and its king square', () => {
		// 1. e4 d5 2. Bb5+
		expect(readCheck('rnbqkbnr/ppp1pppp/8/1B1p4/4P3/8/PPPP1PPP/RNBQK1NR b KQkq - 1 2')).toEqual({
			color: 'black',
			mate: false,
			square: 'e8'
		});
	});

	it('reads a check against white just the same', () => {
		// 1. f3 e5 2. Kf2 Qh4+
		expect(readCheck('rnb1kbnr/pppp1ppp/8/4p3/7q/5P2/PPPPPKPP/RNBQ1BNR w kq - 2 3')).toMatchObject({
			color: 'white',
			square: 'f2'
		});
	});

	it('separates mate from mere check', () => {
		// Fool's mate: 1. f3 e5 2. g4 Qh4#
		const mate = readCheck('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
		expect(mate).toMatchObject({ color: 'white', mate: true, square: 'e1' });
		// Scholar's mate is the same call for the other side
		expect(
			readCheck('r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4')
		).toMatchObject({ color: 'black', mate: true, square: 'e8' });
	});

	it('treats a stalemate as no check at all', () => {
		expect(readCheck('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toBeNull();
	});

	it('gives up quietly on a position the rules engine will not take', () => {
		// no kings — a diagram, not a game
		expect(readCheck('8/8/8/4q3/8/8/8/8 w - - 0 1')).toBeNull();
		expect(readCheck('not a fen')).toBeNull();
		expect(readCheck('')).toBeNull();
	});
});

describe('stainClip', () => {
	it('trims nothing for a king with a square on every side', () => {
		expect(stainClip('e4', 'white')).toBe('inset(0% 0% 0% 0%)');
		expect(stainClip('e4', 'black')).toBe('inset(0% 0% 0% 0%)');
	});

	it('trims the edge the stain would spill over', () => {
		// e8 is the top of the board seen from white, the bottom seen from black
		expect(stainClip('e8', 'white')).toBe('inset(25% 0% 0% 0%)');
		expect(stainClip('e8', 'black')).toBe('inset(0% 0% 25% 0%)');
		expect(stainClip('e1', 'white')).toBe('inset(0% 0% 25% 0%)');
		expect(stainClip('e1', 'black')).toBe('inset(25% 0% 0% 0%)');
		// and the files flip with it
		expect(stainClip('a4', 'white')).toBe('inset(0% 0% 0% 25%)');
		expect(stainClip('a4', 'black')).toBe('inset(0% 25% 0% 0%)');
		expect(stainClip('h4', 'white')).toBe('inset(0% 25% 0% 0%)');
	});

	it('trims both edges in a corner', () => {
		expect(stainClip('h1', 'white')).toBe('inset(0% 25% 25% 0%)');
		expect(stainClip('a8', 'black')).toBe('inset(0% 25% 25% 0%)');
	});
});
