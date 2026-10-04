/** Play grades each move as it is played, with the browser engine; the
 * analysis job grades it again after the game, deeper, with native
 * Stockfish. The rules and thresholds are the same (shared/
 * classification.json), but a deeper search can see a reply the quick one
 * missed — or find a defence it didn't — so a grade can change. Review says
 * so, with both checks' numbers, instead of contradicting the badge the
 * player saw without a word.
 *
 * Only changes that matter are reported: one side of the change has to cost
 * something (an inaccuracy or worse). Book, best and good are one tier here —
 * the line between best and good is a single win% point, and a note on every
 * move that crossed it would bury the ones worth reading.
 */
import { winChances, type Classification } from '$lib/classification';
import type { MoveRecord } from '$lib/api/client';

const TIER: Record<Classification, number> = {
	book: 0,
	best: 0,
	good: 0,
	inaccuracy: 1,
	mistake: 2,
	blunder: 3
};

export const GRADE_NAMES: Record<Classification, string> = {
	book: 'a book move',
	best: 'the best move',
	good: 'a good move',
	inaccuracy: 'an inaccuracy',
	mistake: 'a mistake',
	blunder: 'a blunder'
};

function isClassification(value: string | null): value is Classification {
	return value !== null && value in TIER;
}

export interface GradeChange {
	live: Classification;
	final: Classification;
	/** The deeper check graded it worse. */
	harsher: boolean;
	/** The mover's winning chances lost by the move, by each check (win%
	 * points); null where an eval is not on record. */
	liveLoss: number | null;
	finalLoss: number | null;
}

/** The grade change on `move`, if any; `previous` is the move before it
 * (the live check's eval before a move is its eval after the one before). */
export function gradeChange(
	move: MoveRecord,
	previous: MoveRecord | undefined
): GradeChange | null {
	const live = move.live_classification;
	const final = move.classification;
	if (!isClassification(live) || !isClassification(final)) return null;
	if (TIER[live] === TIER[final]) return null;
	const white = move.ply % 2 === 1;
	const loss = (before: number | null | undefined, after: number | null): number | null =>
		before == null || after === null
			? null
			: winChances({ cp: before }, white) - winChances({ cp: after }, white);
	const finalLoss =
		move.eval_before === null || move.eval_after === null
			? null
			: winChances({ cp: move.eval_before, mate: move.mate_before }, white) -
				winChances({ cp: move.eval_after, mate: move.mate_after }, white);
	return {
		live,
		final,
		harsher: TIER[final] > TIER[live],
		liveLoss: loss(previous?.live_eval_after, move.live_eval_after),
		finalLoss
	};
}

function points(loss: number | null): string {
	if (loss === null) return '';
	const rounded = Math.max(0, Math.round(loss));
	return ` (${rounded} point${rounded === 1 ? '' : 's'} of winning chances lost)`;
}

/** The note, in plain words: what Play said, what the deeper check says. */
export function gradeChangeText(change: GradeChange, san: string): string {
	const during = `During the game, Play’s quick check called ${san} ${GRADE_NAMES[change.live]}${points(change.liveLoss)}.`;
	const after = change.harsher
		? `The deeper check after the game sees more: it is ${GRADE_NAMES[change.final]}${points(change.finalLoss)}.`
		: `The deeper check after the game finds it costs less: it is ${GRADE_NAMES[change.final]}${points(change.finalLoss)}.`;
	return `${during} ${after}`;
}
