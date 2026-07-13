/** Short labels for engine candidate moves — the insight bar's "Ideas" chips.
 *
 * Pure heuristics over one move in one position, first matching rule wins:
 * mate/check/promotion, then captures by material outcome, castling, pawn
 * plans (central break vs space vs structure), development, rook to an open
 * file, and finally a generic "improve" per piece.
 */
import { Chess, type Color, type Move, type Square } from 'chess.js';

export interface Idea {
	san: string;
	label: string;
	uci: string;
}

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const CENTRAL_SQUARES = new Set(['c4', 'd4', 'e4', 'f4', 'c5', 'd5', 'e5', 'f5']);
const MINOR_HOME: Record<Color, Set<string>> = {
	w: new Set(['b1', 'g1', 'c1', 'f1']),
	b: new Set(['b8', 'g8', 'c8', 'f8'])
};
const IMPROVE: Record<string, string> = {
	n: 'Improve knight',
	b: 'Improve bishop',
	r: 'Improve rook',
	q: 'Improve queen',
	k: 'King move'
};

/** Squares a pawn of `color` on `square` attacks. */
function pawnAttacks(square: Square, color: Color): Square[] {
	const file = square.charCodeAt(0);
	const rank = Number(square[1]) + (color === 'w' ? 1 : -1);
	if (rank < 1 || rank > 8) return [];
	return [file - 1, file + 1]
		.filter((f) => f >= 97 && f <= 104)
		.map((f) => `${String.fromCharCode(f)}${rank}` as Square);
}

/** The moved pawn attacks an enemy pawn, or an enemy pawn attacks it. */
function createsPawnTension(post: Chess, move: Move): boolean {
	const opponent: Color = move.color === 'w' ? 'b' : 'w';
	const attacksEnemyPawn = pawnAttacks(move.to, move.color).some((square) => {
		const piece = post.get(square);
		return piece?.type === 'p' && piece.color === opponent;
	});
	if (attacksEnemyPawn) return true;
	return post.attackers(move.to, opponent).some((square) => post.get(square)?.type === 'p');
}

/** No own pawns on the rook's destination file. */
function landsOnOpenFile(post: Chess, move: Move): boolean {
	const file = move.to[0];
	for (let rank = 1; rank <= 8; rank += 1) {
		const piece = post.get(`${file}${rank}` as Square);
		if (piece?.type === 'p' && piece.color === move.color) return false;
	}
	return true;
}

function labelFor(fen: string, post: Chess, move: Move): string {
	if (post.isCheckmate()) return 'Mate';
	if (post.isCheck()) return 'Check';
	if (move.promotion) return 'Promote';

	if (move.captured) {
		const gain = VALUE[move.captured] - (VALUE[move.piece] ?? 0);
		if (gain > 0) return 'Wins material';
		const opponent: Color = move.color === 'w' ? 'b' : 'w';
		const defended = new Chess(fen).attackers(move.to, opponent).length > 0;
		if (!defended) return 'Wins material';
		return gain === 0 ? 'Trade' : 'Capture';
	}

	if (move.flags.includes('k') || move.flags.includes('q')) return 'King safety';

	if (move.piece === 'p') {
		if (CENTRAL_SQUARES.has(move.to)) {
			return createsPawnTension(post, move) ? 'Central break' : 'Space';
		}
		return 'Improve pawn';
	}

	if ((move.piece === 'n' || move.piece === 'b') && MINOR_HOME[move.color].has(move.from)) {
		return 'Develop';
	}
	if (move.piece === 'r' && landsOnOpenFile(post, move)) return 'Open file';

	return IMPROVE[move.piece] ?? 'Solid move';
}

/** SAN + label for a candidate move, or null if the uci is illegal in fen. */
export function describeIdea(fen: string, uci: string): Idea | null {
	const post = new Chess(fen);
	let move: Move;
	try {
		move = post.move({
			from: uci.slice(0, 2),
			to: uci.slice(2, 4),
			promotion: uci[4]
		});
	} catch {
		return null;
	}
	return { san: move.san, label: labelFor(fen, post, move), uci };
}
