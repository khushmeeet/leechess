/** Eval change → classification. The constants load from
 * shared/classification.json — the same file server/app/analysis.py reads —
 * and shared/classification-cases.json runs the same table through both, so
 * live badges and post-game review never disagree.
 *
 * A move is graded by the winning chances it gives away, not raw centipawns:
 * dropping a pawn in a level game matters, dropping one at +6 barely does.
 * Forced mates are kept apart from the clamped centipawns, so a move that
 * throws away a mate, walks into one, or hastens one is graded as such
 * instead of reading "no change" at the clamp. */
import shared from '../../../shared/classification.json';

export type Classification = 'book' | 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export const EVAL_CLAMP_CP: number = shared.evalClampCp;

const THRESHOLDS = shared.thresholds as [number, Classification][];
const WIN_PERCENT_K: number = shared.winPercentK;
const MATE_INACCURACY_ABOVE: number = shared.mate.inaccuracyAboveCp;
const MATE_MISTAKE_ABOVE: number = shared.mate.mistakeAboveCp;

export function clampEval(cp: number): number {
	return Math.max(-EVAL_CLAMP_CP, Math.min(EVAL_CLAMP_CP, cp));
}

/** Winning chances in percent (0–100) for the side the eval favours when
 * positive, from a centipawn eval — Lichess's fit to real games. */
export function winPercent(cp: number): number {
	return 50 + 50 * (2 / (1 + Math.exp(-WIN_PERCENT_K * clampEval(cp))) - 1);
}

/** One side's winning chances in percent for an eval, with a forced mate
 * counted as certain — what Review shows beside each move. */
export function winChances(evaluation: GradedEval, forWhite: boolean): number {
	const white =
		evaluation.mate !== undefined && evaluation.mate !== null
			? evaluation.mate === 0
				? evaluation.cp > 0
					? 100
					: 0
				: evaluation.mate > 0
					? 100
					: 0
			: winPercent(evaluation.cp);
	return forWhite ? white : 100 - white;
}

/** An eval as stored: clamped centipawns, white's point of view, plus the
 * forced mate when there is one — moves to mate, signed for White like the
 * engine reports it. 0 is a mate already on the board; the centipawns (at
 * the clamp) say who delivered it. */
export interface GradedEval {
	cp: number;
	mate?: number | null;
}

export interface GradeOptions {
	/** The move is the engine's own choice. */
	playedIsBest?: boolean;
	/** The position after the move is in the opening book. */
	inBook?: boolean;
}

/** One side's view of an eval: centipawns for the mover, and a forced mate
 * as who gives it and in how many. */
function moverView(evaluation: GradedEval, moverIsWhite: boolean) {
	const sign = moverIsWhite ? 1 : -1;
	const cp = clampEval(evaluation.cp) * sign;
	if (evaluation.mate === undefined || evaluation.mate === null) return { cp, mate: null };
	const forMover = evaluation.mate === 0 ? cp > 0 : evaluation.mate * sign > 0;
	return { cp, mate: { forMover, moves: Math.abs(evaluation.mate) } };
}

function byThreshold(drop: number): Classification {
	for (const [upperBound, label] of THRESHOLDS) {
		if (drop < upperBound) return label;
	}
	return 'blunder';
}

function grade(before: GradedEval, after: GradedEval, moverIsWhite: boolean): Classification {
	const was = moverView(before, moverIsWhite);
	const now = moverView(after, moverIsWhite);

	if (was.mate?.forMover && now.mate?.forMover) {
		// still mating: on track if the mate got closer, a detour otherwise
		return now.mate.moves < was.mate.moves ? 'best' : 'good';
	}
	if (was.mate && !was.mate.forMover && now.mate && !now.mate.forMover) {
		// already being mated: only hastening it costs anything
		return now.mate.moves < was.mate.moves ? 'inaccuracy' : 'best';
	}
	if (was.mate?.forMover) {
		// a forced mate thrown away — how bad depends on what is left
		if (now.cp > MATE_INACCURACY_ABOVE) return 'inaccuracy';
		if (now.cp > MATE_MISTAKE_ABOVE) return 'mistake';
		return 'blunder';
	}
	if (now.mate && !now.mate.forMover) {
		// walked into a forced mate — how bad depends on how lost it already was
		if (was.cp < -MATE_INACCURACY_ABOVE) return 'inaccuracy';
		if (was.cp < -MATE_MISTAKE_ABOVE) return 'mistake';
		return 'blunder';
	}
	return byThreshold(Math.max(0, winPercent(was.cp) - winPercent(now.cp)));
}

/** Grade one move from the evals before and after it. The engine's own
 * choice is always "best" however the eval wobbled between the two
 * searches; a book move is "book" unless it is a blunder (some named lines
 * are traps — the Fool's Mate is in the book). */
export function classifyMove(
	before: GradedEval,
	after: GradedEval,
	moverIsWhite: boolean,
	options: GradeOptions = {}
): Classification {
	const label = options.playedIsBest ? 'best' : grade(before, after, moverIsWhite);
	if (options.inBook && label !== 'blunder') return 'book';
	return label;
}

export const BADGE_STYLES: Record<Classification, string> = {
	book: 'bg-paper text-muted border-line',
	best: 'bg-ok-bg text-ok border-ok-line',
	good: 'bg-info-bg text-info border-info-line',
	inaccuracy: 'bg-warn-bg text-warn border-warn-line',
	mistake: 'bg-mist-bg text-mist border-mist-line',
	blunder: 'bg-err-bg text-err border-err-line'
};
