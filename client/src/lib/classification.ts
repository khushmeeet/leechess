/** Eval-delta → classification, mirrored from server/app/analysis.py so live
 * badges and post-game review never disagree — keep the two in sync. The
 * server's test_classification.py pins the canonical values. */

export type Classification = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export const EVAL_CLAMP_CP = 1000;

const THRESHOLDS: [number, Classification][] = [
	[10, 'best'],
	[25, 'good'],
	[50, 'inaccuracy'],
	[100, 'mistake']
];

export function clampEval(cp: number): number {
	return Math.max(-EVAL_CLAMP_CP, Math.min(EVAL_CLAMP_CP, cp));
}

export function classifyMove(
	evalBefore: number,
	evalAfter: number,
	moverIsWhite: boolean,
	playedIsBest = false
): Classification {
	if (playedIsBest) return 'best';
	const loss = Math.max(0, moverIsWhite ? evalBefore - evalAfter : evalAfter - evalBefore);
	for (const [upperBound, label] of THRESHOLDS) {
		if (loss < upperBound) return label;
	}
	return 'blunder';
}

export const BADGE_STYLES: Record<Classification, string> = {
	best: 'bg-emerald-100 text-emerald-800 border-emerald-300',
	good: 'bg-sky-100 text-sky-800 border-sky-300',
	inaccuracy: 'bg-yellow-100 text-yellow-800 border-yellow-300',
	mistake: 'bg-orange-100 text-orange-800 border-orange-300',
	blunder: 'bg-red-100 text-red-800 border-red-300'
};
