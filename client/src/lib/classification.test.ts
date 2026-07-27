import { describe, expect, it } from 'vitest';
import cases from '../../../shared/classification-cases.json';
import { BADGE_STYLES, EVAL_CLAMP_CP, clampEval, classifyMove } from './classification';

// The same table server/tests/test_classification.py runs. Both
// implementations read shared/classification.json for the thresholds, but
// only running identical inputs through both proves they agree on the
// arithmetic around them — the live badge and the review page grade the same
// move the same way.

describe('classifyMove (shared conformance table)', () => {
	for (const testCase of cases.cases) {
		it(testCase.why, () => {
			expect(
				classifyMove(
					testCase.evalBefore,
					testCase.evalAfter,
					testCase.moverIsWhite,
					testCase.playedIsBest ?? false
				)
			).toBe(testCase.expected);
		});
	}
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

describe('BADGE_STYLES', () => {
	it('styles every label the classifier can return', () => {
		const labels = new Set(cases.cases.map((testCase) => testCase.expected));
		expect(new Set(Object.keys(BADGE_STYLES))).toEqual(labels);
	});
});
