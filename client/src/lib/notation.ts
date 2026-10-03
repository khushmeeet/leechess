/** Chess notation inside coaching text — moves ("…Bxd1", "Qd2", "21. Be6")
 * and squares ("the queen on d1") — found and resolved against the position
 * the text is about, so the screen can set them apart and show them on the
 * board when the player points at them.
 *
 * A bare square is the one ambiguity: "d4" is both a pawn move and a square.
 * Read as a move only when the text says it is one — a move number or "…"
 * before it, a verb that introduces a move ("prefers d4", "threatens d4"), or
 * a move right before it in a line ("e4 e5 Nf3"). Everywhere else it is a
 * square: "the pawn on e4" must light up e4, not draw e2–e4 because that push
 * happens to be legal. `linkWhy` in summaryLinks.ts guesses by legality, which
 * is the trap this avoids.
 *
 * Moves are tried, in order, in the position right after the previous move in
 * the text (so a line resolves move by move), then in each of the positions
 * the caller names — a threat is a move in the passed position, an engine
 * suggestion one in the current position. A move that fits none of them stays
 * plain text: there would be nothing to show.
 */
import { Chess, type Square } from 'chess.js';

export type NotationTarget =
	{ kind: 'move'; from: Square; to: Square } | { kind: 'square'; square: Square };

export interface NotationSegment {
	text: string;
	target: NotationTarget | null;
}

const SAN = '(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=[QRBN])?|O-O(?:-O)?)[+#]?';

// Optional move number or ellipsis, then a SAN — never inside a word or a
// longer number ("1400." is a rating, not move 1400).
const TOKEN = new RegExp(
	String.raw`(?<![A-Za-z0-9=…])(\d{1,3}(?:\.\.\.|…|\.)\s?|\.\.\.|…)?(${SAN})(?![A-Za-z0-9=])`,
	'g'
);
const BARE_SQUARE = /^[a-h][1-8]$/;
/** Words that put a move, not a square, right after them. */
const INTRODUCES_MOVE = /\b(?:prefers|threatens|plays?|played|line:)\s+$/i;

function tryMove(fen: string, san: string): { from: Square; to: Square; after: string } | null {
	try {
		const chess = new Chess(fen);
		const move = chess.move(san);
		return { from: move.from, to: move.to, after: chess.fen() };
	} catch {
		return null;
	}
}

/** Split `text` into prose and notation. `fens` are the positions its moves
 * may be played in, most likely first. With `line`, every token is a move —
 * for text that is nothing but moves, like a principal variation. */
export function linkNotation(
	text: string,
	fens: string[],
	options: { line?: boolean } = {}
): NotationSegment[] {
	const segments: NotationSegment[] = [];
	let cursor = 0;
	// position after the last move resolved, and where that move's text ended
	let running: string | null = null;
	let lastMoveEnd = -1;

	for (const match of text.matchAll(TOKEN)) {
		const [whole, prefix, san] = match;
		const start = match.index;
		const before = text.slice(0, start);
		const continuesLine = lastMoveEnd >= 0 && /^\s+$/.test(text.slice(lastMoveEnd, start));

		let target: NotationTarget | null = null;
		const bare = BARE_SQUARE.test(san);
		const asMove =
			!bare ||
			options.line ||
			prefix !== undefined ||
			continuesLine ||
			INTRODUCES_MOVE.test(before);
		if (asMove) {
			for (const fen of running ? [running, ...fens] : fens) {
				const move = tryMove(fen, san);
				if (move) {
					target = { kind: 'move', from: move.from, to: move.to };
					running = move.after;
					lastMoveEnd = start + whole.length;
					break;
				}
			}
		}
		if (!target && bare) target = { kind: 'square', square: san as Square };
		if (!target) continue;

		if (start > cursor) segments.push({ text: text.slice(cursor, start), target: null });
		segments.push({ text: whole, target });
		cursor = start + whole.length;
	}
	if (cursor < text.length) segments.push({ text: text.slice(cursor), target: null });
	return segments;
}

/** The square a target lights up: the piece that moves, or the square named. */
export function targetSquare(target: NotationTarget): Square {
	return target.kind === 'move' ? target.from : target.square;
}
