import { describe, expect, it } from 'vitest';
import cases from '../../../shared/classification-cases.json';
import {
	BADGE_STYLES,
	EVAL_CLAMP_CP,
	clampEval,
	classifyMove,
	winChances,
	winPercent,
	type Classification
} from './classification';

// The same table server/tests/test_classification.py runs. Both
// implementations read shared/classification.json for the thresholds, but
// only running identical inputs through both proves they agree on the
// arithmetic around them — the live badge and the review page grade the same
// move the same way.

describe('classifyMove (shared conformance table)', () => {
	for (const testCase of cases.cases) {
		it(testCase.why, () => {
			expect(
				classifyMove(testCase.before, testCase.after, testCase.moverIsWhite, {
					playedIsBest: testCase.playedIsBest ?? false,
					inBook: testCase.inBook ?? false
				})
			).toBe(testCase.expected);
		});
	}

	it('covers every label, both movers, and every rule', () => {
		const labels = new Set(cases.cases.map((testCase) => testCase.expected));
		expect(labels).toEqual(new Set(Object.keys(BADGE_STYLES)));
		expect(new Set(cases.cases.map((testCase) => testCase.moverIsWhite))).toEqual(
			new Set([true, false])
		);
		expect(cases.cases.some((testCase) => testCase.playedIsBest)).toBe(true);
		expect(cases.cases.some((testCase) => testCase.inBook)).toBe(true);
		expect(cases.cases.some((testCase) => 'mate' in testCase.before)).toBe(true);
	});
});

describe('clampEval (shared conformance table)', () => {
	for (const testCase of cases.clampCases) {
		it(testCase.why, () => {
			expect(clampEval(testCase.cp)).toBe(testCase.expected);
		});
	}

	it('exposes the clamp the table was written against', () => {
		expect(EVAL_CLAMP_CP).toBe(1000);
	});
});

describe('winPercent (shared conformance table)', () => {
	for (const testCase of cases.winPercentCases) {
		it(testCase.why, () => {
			expect(winPercent(testCase.cp)).toBeCloseTo(testCase.expected, 3);
		});
	}
});

describe('BADGE_STYLES', () => {
	it('styles every label the classifier can return', () => {
		const labels: Classification[] = ['book', 'best', 'good', 'inaccuracy', 'mistake', 'blunder'];
		expect(new Set(Object.keys(BADGE_STYLES))).toEqual(new Set(labels));
	});
});

describe('winChances', () => {
	it('is one side’s share of the winning-chances curve', () => {
		expect(winChances({ cp: 100 }, true)).toBeCloseTo(59.1, 1);
		expect(winChances({ cp: 100 }, false)).toBeCloseTo(40.9, 1);
	});

	it('counts a forced mate as certain, for whichever side gives it', () => {
		expect(winChances({ cp: 1000, mate: 3 }, true)).toBe(100);
		expect(winChances({ cp: -1000, mate: -2 }, true)).toBe(0);
		expect(winChances({ cp: -1000, mate: -2 }, false)).toBe(100);
		expect(winChances({ cp: 1000, mate: 0 }, false)).toBe(0);
	});
});
