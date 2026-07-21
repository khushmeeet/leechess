import { describe, expect, it } from 'vitest';
import { gameOutcome } from './result';

describe('gameOutcome', () => {
	it('reads a decisive result from the player’s side', () => {
		expect(gameOutcome('1-0', 'white')).toBe('win');
		expect(gameOutcome('1-0', 'black')).toBe('loss');
		expect(gameOutcome('0-1', 'black')).toBe('win');
		expect(gameOutcome('0-1', 'white')).toBe('loss');
	});

	it('is a draw for both sides', () => {
		expect(gameOutcome('1/2-1/2', 'white')).toBe('draw');
		expect(gameOutcome('1/2-1/2', 'black')).toBe('draw');
	});

	it('returns null for an undecided game', () => {
		expect(gameOutcome('*', 'white')).toBeNull();
	});
});
