/** Reading check off a position, for the stain the board paints on the king's
 * square (the artwork and its animation live in board.css / static/board/). */

import { Chess } from 'chess.js';

export interface CheckState {
	/** The side standing in it. */
	color: 'white' | 'black';
	/** Out of answers, not merely under attack — a heavier stain, plus runs. */
	mate: boolean;
	/** Where the king is, in FEN square notation. */
	square: string;
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
	const turn = position.turn();
	const square = position.findPiece({ type: 'k', color: turn })[0];
	if (!square) return null;
	return {
		color: turn === 'w' ? 'white' : 'black',
		mate: position.isCheckmate(),
		square
	};
}

/** How much of the stain to trim, as insets on its own box.
 *
 * The stain is drawn two squares wide and centred on the king, so a king on an
 * edge file or rank — which is where kings spend most of a game — throws a
 * quarter of it off the board and onto the page, over whatever is sitting
 * there. Trim exactly that quarter: the board is the paper the red soaked
 * into, and it stops where the paper stops. */
export function stainClip(square: string, orientation: 'white' | 'black'): string {
	const file = square.charCodeAt(0) - 97; // a → 0
	const rank = Number(square[1]) - 1; // 1 → 0
	const column = orientation === 'white' ? file : 7 - file;
	const row = orientation === 'white' ? 7 - rank : rank;
	const trim = (offBoard: boolean) => (offBoard ? '25%' : '0%');
	return `inset(${trim(row === 0)} ${trim(column === 7)} ${trim(row === 7)} ${trim(column === 0)})`;
}
