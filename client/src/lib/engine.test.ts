import { describe, expect, it } from 'vitest';
import { engineName, strengthPresets } from './engine';

describe('engineName', () => {
	it('names the engine after the chosen strength preset', () => {
		expect(engineName(5)).toBe('Stockfish (Club)');
		expect(engineName(1)).toBe('Stockfish (Beginner)');
		expect(engineName(20)).toBe('Stockfish (Max)');
	});

	it('covers every preset the strength picker offers', () => {
		for (const preset of strengthPresets) {
			expect(engineName(preset.skill)).toBe(`Stockfish (${preset.label})`);
		}
	});

	it('falls back to the raw level for an off-preset skill', () => {
		expect(engineName(7)).toBe('Stockfish (level 7)');
	});
});
