/** Rule-based coach line for the insight bar: one primary sentence picked by
 * priority, the engine's preference when known, and sometimes a supporting
 * sentence. Deliberately template-driven — advice a club coach would give,
 * not engine analysis.
 */
import { Chess, type Color, type Square } from 'chess.js';
import type { Classification } from '$lib/classification';

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

export interface CoachContext {
	/** Position with the user to move. */
	fen: string;
	/** Plies played so far. */
	ply: number;
	/** Current eval, white POV, clamped (reserved for future rules). */
	evalCp: number | null;
	lastUserClassification: Classification | null;
	/** SAN of the engine's top choice in this position, when fresh. */
	bestMoveSan: string | null;
	userColor: 'white' | 'black';
	/** Still inside known opening theory (reserved for future rules). */
	inBook: boolean;
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
/** Total non-pawn material (both sides) at or below this = endgame. */
const ENDGAME_MATERIAL = 13;
const OPENING_MAX_PLY = 20;
const MINOR_HOME: Record<Color, Square[]> = {
	w: ['b1', 'g1', 'c1', 'f1'],
	b: ['b8', 'g8', 'c8', 'f8']
};

/** Knights and bishops of `color` no longer on their starting squares. */
export function developedMinors(chess: Chess, color: Color): number {
	let home = 0;
	for (const square of MINOR_HOME[color]) {
		const piece = chess.get(square);
		if (piece && piece.color === color && (piece.type === 'n' || piece.type === 'b')) {
			home += 1;
		}
	}
	return 4 - home;
}

export function hasCastled(chess: Chess, color: Color): boolean {
	const rank = color === 'w' ? '1' : '8';
	for (const file of ['g', 'c']) {
		const piece = chess.get(`${file}${rank}` as Square);
		if (piece?.type === 'k' && piece.color === color) return true;
	}
	return false;
}

function canStillCastle(chess: Chess, color: Color): boolean {
	const rights = chess.getCastlingRights(color);
	return rights.k || rights.q;
}

/** White material minus black, pawns = 1. */
export function materialDiff(chess: Chess): number {
	let diff = 0;
	for (const row of chess.board()) {
		for (const piece of row) {
			if (!piece || piece.type === 'k') continue;
			diff += (piece.color === 'w' ? 1 : -1) * PIECE_VALUE[piece.type];
		}
	}
	return diff;
}

export function gamePhase(chess: Chess, ply: number, userColor: Color): GamePhase {
	let nonPawn = 0;
	for (const row of chess.board()) {
		for (const piece of row) {
			if (piece && piece.type !== 'p' && piece.type !== 'k') {
				nonPawn += PIECE_VALUE[piece.type];
			}
		}
	}
	if (nonPawn <= ENDGAME_MATERIAL) return 'endgame';
	if (
		ply <= OPENING_MAX_PLY &&
		(developedMinors(chess, userColor) < 4 || !hasCastled(chess, userColor))
	) {
		return 'opening';
	}
	return 'middlegame';
}

export function coachAdvice(ctx: CoachContext): string {
	const chess = new Chess(ctx.fen);
	const color: Color = ctx.userColor === 'white' ? 'w' : 'b';
	const phase = gamePhase(chess, ctx.ply, color);
	const developed = developedMinors(chess, color);
	const material = (color === 'w' ? 1 : -1) * materialDiff(chess);

	let primary: string;
	let supporting: string | null = null;

	if (ctx.ply === 0) {
		primary = 'Fight for the center and develop quickly.';
	} else if (chess.isCheck()) {
		primary = "You're in check — deal with the threat first.";
	} else if (ctx.lastUserClassification === 'mistake' || ctx.lastUserClassification === 'blunder') {
		primary =
			'That last move let the eval slip — check checks, captures and threats before committing.';
	} else if (
		phase === 'opening' &&
		developed >= 2 &&
		!hasCastled(chess, color) &&
		canStillCastle(chess, color)
	) {
		primary = 'King safety is the priority.';
		supporting = 'Finish development and castle before opening the position.';
	} else if (phase === 'opening' && developed < 2) {
		primary = 'Develop your minor pieces toward the center.';
		supporting = 'Knights and bishops first, then castle.';
	} else if (material >= 3) {
		primary = "You're up material — simplify and trade pieces.";
	} else if (material <= -3) {
		primary = "You're down material — keep pieces on and create threats.";
	} else if (phase === 'endgame') {
		primary = 'Activate your king and look for passed pawns.';
	} else {
		primary = 'Improve your worst-placed piece and keep your king safe.';
	}

	const parts = [primary];
	if (ctx.bestMoveSan) parts.push(`Stockfish prefers ${ctx.bestMoveSan}.`);
	if (supporting) parts.push(supporting);
	return parts.join(' ');
}
