/** Turning a raw PGN result ("1-0" / "0-1" / "1/2-1/2") into the player's
 * outcome. Shared by the play screen's end-of-game overlay and the review
 * pages, so both read a finished game the same way. */

export type GameOutcome = 'win' | 'loss' | 'draw';

/** The finished game's result from `userColor`'s perspective — the side the
 * human played (engine games) or White by default (local pass-and-play).
 * A draw is a draw for both sides; null while the game is undecided ("*"). */
export function gameOutcome(result: string, userColor: 'white' | 'black'): GameOutcome | null {
	if (result === '1/2-1/2') return 'draw';
	const winner = result === '1-0' ? 'white' : result === '0-1' ? 'black' : null;
	if (!winner) return null;
	return winner === userColor ? 'win' : 'loss';
}

export const OUTCOME_LABELS: Record<GameOutcome, string> = {
	win: 'Win',
	loss: 'Loss',
	draw: 'Draw'
};
