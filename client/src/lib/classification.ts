/** Eval-delta → classification. The constants load from
 * shared/classification.json — the same file server/app/analysis.py reads —
 * so live badges and post-game review never disagree. The server's
 * test_classification.py pins the canonical values. */
import shared from '../../../shared/classification.json';

export type Classification = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export const EVAL_CLAMP_CP: number = shared.evalClampCp;

const THRESHOLDS = shared.thresholds as [number, Classification][];

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
	best: 'bg-ok-bg text-ok border-ok-line',
	good: 'bg-info-bg text-info border-info-line',
	inaccuracy: 'bg-warn-bg text-warn border-warn-line',
	mistake: 'bg-mist-bg text-mist border-mist-line',
	blunder: 'bg-err-bg text-err border-err-line'
};
