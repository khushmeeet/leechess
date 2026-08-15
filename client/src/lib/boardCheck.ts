/** Reading check off a position, for the stain the board paints on the king's
 * square (the artwork itself is in board.css / static/board/). */

import { Chess } from 'chess.js';

export interface CheckState {
	/** The side standing in it. */
	color: 'white' | 'black';
	/** Out of answers, not merely under attack — a deeper stain. */
	mate: boolean;
}

/** The king under attack in `fen`, or null if nobody is.
 *
 * Taken from the position rather than passed in, so every board in the app —
 * play, puzzles, drills, review, replays, a friend's game — gets this from the
 * FEN it was already handed. chess.js is the same rules engine the stores use,
 * so this cannot disagree with them.
 *
 * A FEN chess.js won't take is not an error worth surfacing from a board: a
 * position nobody can adjudicate simply has no king in check. */
export function readCheck(fen: string): CheckState | null {
	let position: Chess;
	try {
		position = new Chess(fen);
	} catch {
		return null;
	}
	if (!position.isCheck()) return null;
	return {
		color: position.turn() === 'w' ? 'white' : 'black',
		mate: position.isCheckmate()
	};
}
