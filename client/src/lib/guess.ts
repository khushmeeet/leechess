/** Guess the move: step through a landmark game from one side, guessing each
 * of that side's moves before the master's is shown. A guess is scored by how
 * close it comes to the master's move in the guesser's winning chances — the
 * same scale move grading uses — so a different move that is as good earns
 * nearly as much as the master's own. That is the point: the exercise trains
 * finding good moves, not memorizing one game.
 */
import { Chess } from 'chess.js';

export interface GameMove {
	uci: string;
	san: string;
	fenBefore: string;
	fenAfter: string;
	white: boolean;
}

/** The game score as moves, each with its positions. */
export function gameMoves(pgn: string): GameMove[] {
	const chess = new Chess();
	chess.loadPgn(pgn);
	const replay = new Chess();
	return chess.history({ verbose: true }).map((move) => {
		const fenBefore = replay.fen();
		replay.move(move.san);
		return {
			uci: move.from + move.to + (move.promotion ?? ''),
			san: move.san,
			fenBefore,
			fenAfter: replay.fen(),
			white: move.color === 'w'
		};
	});
}

/** Points for a guess, out of `MAX_POINTS`. `drop` is how many win% points
 * the guess trails the master's move by (negative when it is better). The
 * bands are move grading's: under 1 point is as good as the master's move. */
export const MAX_POINTS = 5;
const AS_GOOD = 1;
const BANDS: [number, number][] = [
	[2.5, 4],
	[5, 3],
	[10, 1]
];

export function guessPoints(same: boolean, drop: number): number {
	if (same || drop < AS_GOOD) return MAX_POINTS;
	for (const [bound, points] of BANDS) {
		if (drop <= bound) return points;
	}
	return 0;
}

/** A sentence for one guess, from the guesser's side. */
export function guessVerdict(
	guess: { san: string; chances: number } | null,
	master: { san: string; chances: number },
	player: string,
	points: number
): string {
	if (!guess) return `${player} played ${master.san}.`;
	if (guess.san === master.san)
		return `${guess.san} — the move ${player} played. ${points} points.`;
	const yours = Math.round(guess.chances);
	const theirs = Math.round(master.chances);
	const comparison =
		yours >= theirs
			? `as good as ${player}’s ${master.san} (${theirs}%)`
			: `${player}’s ${master.san} keeps ${theirs}%`;
	return `${guess.san} keeps ${yours}%; ${comparison}. ${points} point${points === 1 ? '' : 's'}.`;
}
