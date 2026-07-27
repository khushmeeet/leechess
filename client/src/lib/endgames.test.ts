import { describe, expect, it } from 'vitest';
import { dueLabel, familyLabel, isDue, parseUtc } from './endgames';

const NOW = new Date('2026-07-26T12:00:00Z');

describe('familyLabel', () => {
	it('names every catalog family', () => {
		expect(familyLabel('kp-key-squares')).toBe('King and pawn — key squares');
		expect(familyLabel('lucena')).toBe('Lucena — building the bridge');
		expect(familyLabel('philidor')).toBe('Philidor — third-rank defense');
		expect(familyLabel('rook-pawn-conversion')).toBe('Rook and pawn — conversion');
	});

	it('falls back to the de-slugged name for anything unknown', () => {
		expect(familyLabel('some-new-family')).toBe('some new family');
	});
});

describe('parseUtc', () => {
	it('reads a naive stamp as UTC, not local time', () => {
		// what the API actually serves, SQLite having dropped the tzinfo
		expect(parseUtc('2026-07-26T12:00:00.123456').toISOString()).toBe('2026-07-26T12:00:00.123Z');
	});

	it('leaves an explicit offset alone', () => {
		expect(parseUtc('2026-07-26T12:00:00Z').toISOString()).toBe('2026-07-26T12:00:00.000Z');
		expect(parseUtc('2026-07-26T14:00:00+02:00').toISOString()).toBe('2026-07-26T12:00:00.000Z');
	});
});

describe('dueLabel', () => {
	it('says due now once the interval has elapsed', () => {
		expect(dueLabel('2026-07-26T11:59:00', NOW)).toBe('due now');
		expect(dueLabel('2026-07-26T12:00:00', NOW)).toBe('due now');
	});

	it('counts down in minutes, hours, then days', () => {
		expect(dueLabel('2026-07-26T12:10:00', NOW)).toBe('in 10m'); // box 1
		expect(dueLabel('2026-07-27T12:00:00', NOW)).toBe('in 1d'); // box 2
		expect(dueLabel('2026-07-29T12:00:00', NOW)).toBe('in 3d'); // box 3
		expect(dueLabel('2026-08-16T12:00:00', NOW)).toBe('in 21d'); // box 5
		expect(dueLabel('2026-07-26T15:00:00', NOW)).toBe('in 3h');
	});

	it('never rounds a pending drill down to zero minutes', () => {
		expect(dueLabel('2026-07-26T12:00:10', NOW)).toBe('in 1m');
	});
});

describe('isDue', () => {
	it('matches the label', () => {
		expect(isDue('2026-07-26T11:59:00', NOW)).toBe(true);
		expect(isDue('2026-07-26T12:10:00', NOW)).toBe(false);
	});
});
