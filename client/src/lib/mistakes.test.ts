import { describe, expect, it } from 'vitest';
import { isMistakeCause, MISTAKE_CAUSES } from './mistakes';

describe('MISTAKE_CAUSES', () => {
	it('has words for every cause the server gives (app/mistakes.py CAUSES)', () => {
		expect(Object.keys(MISTAKE_CAUSES)).toEqual([
			'missed_threat',
			'hung_piece',
			'allowed_reply',
			'missed_tactic',
			'positional'
		]);
		for (const copy of Object.values(MISTAKE_CAUSES)) {
			expect(copy.label).not.toBe('');
			expect(copy.what.endsWith('.')).toBe(true);
			expect(copy.habit.endsWith('.')).toBe(true);
		}
	});

	it('recognizes only those causes', () => {
		expect(isMistakeCause('missed_threat')).toBe(true);
		expect(isMistakeCause('fork')).toBe(false);
		expect(isMistakeCause(null)).toBe(false);
		expect(isMistakeCause(undefined)).toBe(false);
	});
});
