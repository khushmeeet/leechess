/** Engine lines as a player reads them: each move in SAN with its move
 * number, and the position before and after it, so a line can be stepped
 * through on the board. Review stores lines as space-separated UCI (the
 * server's best_line and reply_line); the browser engine hands back arrays. */
import { Chess } from 'chess.js';

export interface LineMove {
	uci: string;
	san: string;
	fenBefore: string;
	fenAfter: string;
	/** "21." before a White move, "21…" before a line's first move when it is
	 * Black's, otherwise empty — the way a line is written. */
	number: string;
}

/** A stored line split into its moves; empty for a missing one. */
export function parseLine(line: string | null | undefined): string[] {
	return line ? line.split(' ').filter(Boolean) : [];
}

/** Play `ucis` from `fen`, stopping at the first move that doesn't fit (an
 * engine line can run past what the position allows once a game ends). */
export function playLine(fen: string, ucis: readonly string[]): LineMove[] {
	const moves: LineMove[] = [];
	let chess: Chess;
	try {
		chess = new Chess(fen);
	} catch {
		return moves;
	}
	for (const uci of ucis) {
		const fenBefore = chess.fen();
		const white = chess.turn() === 'w';
		const fullMove = Number(fenBefore.split(' ')[5]) || 1;
		let san: string;
		try {
			san = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
		} catch {
			break;
		}
		moves.push({
			uci,
			san,
			fenBefore,
			fenAfter: chess.fen(),
			number: white ? `${fullMove}.` : moves.length === 0 ? `${fullMove}…` : ''
		});
	}
	return moves;
}

/** The line as text: "21. Bxc8 Raxc8 22. Qxf5". */
export function lineText(moves: readonly LineMove[]): string {
	return moves.map((move) => (move.number ? `${move.number} ${move.san}` : move.san)).join(' ');
}

/** The UCI of a SAN move in `fen`, or null when it doesn't fit. */
export function sanToUci(fen: string, san: string): string | null {
	try {
		const move = new Chess(fen).move(san);
		return move.from + move.to + (move.promotion ?? '');
	} catch {
		return null;
	}
}
