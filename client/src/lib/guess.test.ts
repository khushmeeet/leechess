import { describe, expect, it } from 'vitest';
import { gameMoves, guessPoints, guessVerdict, MAX_POINTS } from './guess';

describe('gameMoves', () => {
	it('reads a game score into moves with their positions and sides', () => {
		const moves = gameMoves('1. e4 e5 2. Nf3 Nc6 1-0');
		expect(moves.map((move) => move.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
		expect(moves[2]).toMatchObject({ uci: 'g1f3', white: true });
		expect(moves[3].fenBefore).toBe(moves[2].fenAfter);
	});
});

describe('guessPoints', () => {
	it('gives full points for the master’s move, or one as good', () => {
		expect(guessPoints(true, 30)).toBe(MAX_POINTS);
		expect(guessPoints(false, 0)).toBe(MAX_POINTS);
		expect(guessPoints(false, 0.9)).toBe(MAX_POINTS); // under move grading's "best" bar
		expect(guessPoints(false, -4)).toBe(MAX_POINTS); // better than the master's
	});

	it('takes points away the further the chances fall short', () => {
		expect(guessPoints(false, 2)).toBe(4);
		expect(guessPoints(false, 4)).toBe(3);
		expect(guessPoints(false, 9)).toBe(1);
		expect(guessPoints(false, 30)).toBe(0);
	});
});

describe('guessVerdict', () => {
	it('names both moves and their chances', () => {
		expect(
			guessVerdict({ san: 'Nf3', chances: 52 }, { san: 'Bc4', chances: 55 }, 'Morphy', 3)
		).toBe('Nf3 keeps 52%; Morphy’s Bc4 keeps 55%. 3 points.');
		expect(
			guessVerdict({ san: 'Nc3', chances: 56 }, { san: 'Bc4', chances: 55 }, 'Morphy', 5)
		).toBe('Nc3 keeps 56%; as good as Morphy’s Bc4 (55%). 5 points.');
		expect(guessVerdict(null, { san: 'Bc4', chances: NaN }, 'Morphy', 0)).toBe(
			'Morphy played Bc4.'
		);
	});
});
