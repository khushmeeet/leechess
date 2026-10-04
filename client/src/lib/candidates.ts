/** "Think first": at a critical moment Play asks for candidate moves before
 * the move itself, then grades the thinking rather than the move.
 *
 * A position is critical when one move is much better than the rest — the
 * engine's best line beats its second-best by `CRITICAL_GAP` points of the
 * player's winning chances. Asking everywhere would teach the player to click
 * through the prompt; asking where it matters teaches when to slow down, which
 * is a skill of its own.
 *
 * The grade has two parts, the two questions of a thinking routine that a
 * list of candidates can answer: was a move as good as the engine's among
 * them, and — when the opponent's last move threatened something — did any of
 * them deal with it. The candidates are weighed by the caller (an engine
 * search of the position after each); everything here is arithmetic on those
 * results.
 */
import { EVAL_CLAMP_CP, winChances } from '$lib/classification';
import type { EngineLine } from '$lib/stores/stockfish';
import type { Threat } from '$lib/threats';

/** Win% points the best line must lead the second by. */
export const CRITICAL_GAP = 10;
/** A candidate within this many win% points of the engine's move is as good
 * as it — the bar between "best" and "good" in move grading. */
export const CLOSE_ENOUGH = 2.5;
/** At most this many candidates are taken; two or three is the habit. */
export const MAX_CANDIDATES = 3;
/** A move that gets out of the threat but trails the engine's move by this
 * many win% points ran into something else — a mistake's worth. The bar
 * between "answered" and "sidestepped", here and in defence puzzles. */
export const SIDESTEP_LOSS = 10;

/** An engine score (white's point of view) as the player's winning chances. */
export function chancesFor(score: { cp?: number; mate?: number }, forWhite: boolean): number {
	const mate = score.mate ?? null;
	const cp = mate !== null ? (mate > 0 ? EVAL_CLAMP_CP : -EVAL_CLAMP_CP) : (score.cp ?? 0);
	return winChances({ cp, mate }, forWhite);
}

/** How far the best line leads the second, in the player's win% points;
 * null with fewer than two lines (one legal move is not a decision). */
export function criticalGap(lines: readonly EngineLine[], forWhite: boolean): number | null {
	const [best, second] = lines;
	if (!best || !second) return null;
	return chancesFor(best, forWhite) - chancesFor(second, forWhite);
}

export function isCritical(lines: readonly EngineLine[], forWhite: boolean): boolean {
	const gap = criticalGap(lines, forWhite);
	return gap !== null && gap >= CRITICAL_GAP;
}

/** One candidate, weighed: the player's chances after it, and the
 * opponent's best reply to it ("…Bxe6", Black's prefixed). */
export interface WeighedCandidate {
	uci: string;
	san: string;
	chances: number;
	replyUci: string | null;
	replySan: string | null;
}

export interface ThinkingGrade {
	/** The engine's own move was on the list. */
	foundBest: boolean;
	/** The best candidate, and whether it is as good as the engine's move. */
	bestCandidate: WeighedCandidate;
	closeEnough: boolean;
	/** Candidates that dealt with the threat — took it off the board without
	 * losing more elsewhere; null without a threat. */
	answersThreat: WeighedCandidate[] | null;
	/** The verdict, one sentence per question. */
	lines: string[];
}

export function gradeCandidates(
	candidates: readonly WeighedCandidate[],
	best: { uci: string; san: string; chances: number },
	threat: Threat | null
): ThinkingGrade | null {
	if (candidates.length === 0) return null;
	const bestCandidate = candidates.reduce((top, candidate) =>
		candidate.chances > top.chances ? candidate : top
	);
	const foundBest = candidates.some((candidate) => candidate.uci === best.uci);
	const closeEnough = foundBest || bestCandidate.chances >= best.chances - CLOSE_ENOUGH;
	const lines: string[] = [];

	if (foundBest) {
		lines.push(`The engine’s move, ${best.san}, was on your list.`);
	} else if (closeEnough) {
		lines.push(
			`${bestCandidate.san} is as good as the engine’s move, ${best.san} ` +
				`(${Math.round(bestCandidate.chances)}% against ${Math.round(best.chances)}%).`
		);
	} else {
		lines.push(
			`The move to find was ${best.san} (${Math.round(best.chances)}%); ` +
				`your best candidate, ${bestCandidate.san}, keeps ${Math.round(bestCandidate.chances)}%.`
		);
	}

	// Three outcomes, as in Review: still their best move (left on the board),
	// gone but at a price (sidestepped into something else), or answered.
	// Calling a move that dodged the threat by hanging the piece somewhere
	// else "answered" would teach exactly the wrong lesson.
	let answersThreat: WeighedCandidate[] | null = null;
	if (threat) {
		const left = candidates.filter((candidate) => candidate.replyUci === threat.uci);
		const dodged = candidates.filter(
			(candidate) => candidate.replyUci !== null && candidate.replyUci !== threat.uci
		);
		answersThreat = dodged.filter((candidate) => candidate.chances > best.chances - SIDESTEP_LOSS);
		const sidestepped = dodged.filter((candidate) => !answersThreat!.includes(candidate));
		const names = (list: WeighedCandidate[]) => list.map((c) => c.san).join(' and ');
		if (answersThreat.length > 0) {
			lines.push(`Their threat, ${threat.san}, was answered by ${names(answersThreat)}.`);
		} else {
			lines.push(`None of them dealt with their threat, ${threat.san}.`);
		}
		for (const candidate of sidestepped) {
			lines.push(
				candidate.replySan
					? `${candidate.san} gets out of it, but then their best is ${candidate.replySan}.`
					: `${candidate.san} gets out of it, but loses more elsewhere.`
			);
		}
		if (left.length > 0 && answersThreat.length > 0) {
			lines.push(`${names(left)} left it on the board.`);
		}
	}

	return { foundBest, bestCandidate, closeEnough, answersThreat, lines };
}
