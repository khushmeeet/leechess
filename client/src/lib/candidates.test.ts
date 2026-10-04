import { describe, expect, it } from 'vitest';
import {
	chancesFor,
	CRITICAL_GAP,
	criticalGap,
	gradeCandidates,
	isCritical,
	type WeighedCandidate
} from './candidates';
import type { Threat } from './threats';

function line(score: { cp?: number; mate?: number }, uci = 'e2e4') {
	return { ...score, depth: 16, pvUci: [uci] };
}

describe('critical moments', () => {
	it('is critical when the best line leads the second by the gap', () => {
		// White: +2 against level is about 18 win% points
		expect(isCritical([line({ cp: 200 }), line({ cp: 0 })], true)).toBe(true);
		// a few centipawns between them is no decision at all
		expect(isCritical([line({ cp: 30 }), line({ cp: 20 })], true)).toBe(false);
	});

	it('reads the gap from the player’s side', () => {
		// for Black, the line White likes less is the better one
		expect(criticalGap([line({ cp: -200 }), line({ cp: 0 })], false)).toBeGreaterThanOrEqual(
			CRITICAL_GAP
		);
		expect(isCritical([line({ cp: 200 }), line({ cp: 0 })], false)).toBe(false);
	});

	it('counts a forced mate as the whole of the chances', () => {
		expect(chancesFor({ mate: 3 }, true)).toBe(100);
		expect(isCritical([line({ mate: 2 }), line({ cp: 300 })], true)).toBe(true);
		// a mate when everything else wins anyway is no critical moment
		expect(isCritical([line({ mate: 2 }), line({ cp: 900 })], true)).toBe(false);
	});

	it('is no decision with one line, or none', () => {
		expect(criticalGap([line({ cp: 500 })], true)).toBeNull();
		expect(isCritical([], true)).toBe(false);
	});
});

const BEST = { uci: 'f5c8', san: 'Bxc8', chances: 40 };
const THREAT = { uci: 'c8f5', san: '…Bxf5' } as Threat;

function candidate(
	uci: string,
	san: string,
	chances: number,
	replyUci: string | null,
	replySan: string | null = null
) {
	return { uci, san, chances, replyUci, replySan } satisfies WeighedCandidate;
}

describe('gradeCandidates', () => {
	it('credits finding the engine’s move, and names who answered the threat', () => {
		const grade = gradeCandidates(
			[
				candidate('f5c8', 'Bxc8', 40, 'a8c8'),
				candidate('f5e6', 'Be6', 8, 'c8e6', '…Bxe6'),
				candidate('a2a3', 'a3', 9, 'c8f5')
			],
			BEST,
			THREAT
		)!;
		expect(grade.foundBest).toBe(true);
		expect(grade.closeEnough).toBe(true);
		// Be6 dodges …Bxf5 only to drop the bishop on e6: not an answer
		expect(grade.answersThreat?.map((c) => c.san)).toEqual(['Bxc8']);
		expect(grade.lines).toEqual([
			'The engine’s move, Bxc8, was on your list.',
			'Their threat, …Bxf5, was answered by Bxc8.',
			'Be6 gets out of it, but then their best is …Bxe6.',
			'a3 left it on the board.'
		]);
	});

	it('does not call a dodge that loses more elsewhere an answer', () => {
		const grade = gradeCandidates([candidate('f5e6', 'Be6', 8, 'c8e6', '…Bxe6')], BEST, THREAT)!;
		expect(grade.answersThreat).toEqual([]);
		expect(grade.lines.slice(1)).toEqual([
			'None of them dealt with their threat, …Bxf5.',
			'Be6 gets out of it, but then their best is …Bxe6.'
		]);
	});

	it('accepts a move as good as the engine’s', () => {
		const grade = gradeCandidates([candidate('f5d3', 'Bd3', 38.5, 'a8b8')], BEST, null)!;
		expect(grade.foundBest).toBe(false);
		expect(grade.closeEnough).toBe(true);
		expect(grade.lines).toEqual(['Bd3 is as good as the engine’s move, Bxc8 (39% against 40%).']);
		expect(grade.answersThreat).toBeNull();
	});

	it('names the move to find, and a threat left standing', () => {
		const grade = gradeCandidates([candidate('a2a3', 'a3', 10, 'c8f5')], BEST, THREAT)!;
		expect(grade.closeEnough).toBe(false);
		expect(grade.lines).toEqual([
			'The move to find was Bxc8 (40%); your best candidate, a3, keeps 10%.',
			'None of them dealt with their threat, …Bxf5.'
		]);
	});

	it('grades nothing without candidates', () => {
		expect(gradeCandidates([], BEST, null)).toBeNull();
	});
});
