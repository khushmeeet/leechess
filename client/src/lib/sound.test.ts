import { describe, expect, it } from 'vitest';
import { moveSoundKind } from './sound';

describe('moveSoundKind', () => {
	it('reads a quiet move off a plain SAN', () => {
		expect(moveSoundKind('e4')).toBe('move-self');
		expect(moveSoundKind('Nf3', true)).toBe('move-opponent');
	});

	it('reads captures', () => {
		expect(moveSoundKind('Bxf7')).toBe('capture');
		expect(moveSoundKind('exd5')).toBe('capture');
	});

	it('reads both sides of castling', () => {
		expect(moveSoundKind('O-O')).toBe('castle');
		expect(moveSoundKind('O-O-O')).toBe('castle');
	});

	it('reads promotions, including capturing promotions', () => {
		expect(moveSoundKind('e8=Q')).toBe('promote');
		expect(moveSoundKind('exd8=N')).toBe('promote');
	});

	it('lets check outrank capture and castling', () => {
		expect(moveSoundKind('Qh5+')).toBe('check');
		expect(moveSoundKind('Qxf7#')).toBe('check');
		expect(moveSoundKind('O-O+')).toBe('check');
		expect(moveSoundKind('exd8=Q+')).toBe('check');
	});
});
