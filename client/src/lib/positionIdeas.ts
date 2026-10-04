/** Position ideas: the strategic half of the motif taxonomy — outposts, open
 * files, a weak back rank, isolated, doubled and backward pawns, and a bishop
 * hemmed in by its own pawns.
 *
 * Every idea is a fact the player can check on the board, worked out with
 * chess.js alone. The server finds the same ideas (app/strategy.py — all but
 * the bad bishop) to tag positional mistakes, and shared/position-ideas.json
 * runs the same cases through both. Review uses `ideaChanges` to say what a
 * move changed — only changes, so a quiet position says nothing — and the
 * board's Structure overlay draws `structureMarks`.
 */
import { Chess, type Color, type Square } from 'chess.js';

const FILES = 'abcdefgh';
const SIDE: Record<Color, 'White' | 'Black'> = { w: 'White', b: 'Black' };
const NAME: Record<string, string> = {
	p: 'pawn',
	n: 'knight',
	b: 'bishop',
	r: 'rook',
	q: 'queen',
	k: 'king'
};

function opposite(color: Color): Color {
	return color === 'w' ? 'b' : 'w';
}

function at(file: number, rank: number): Square {
	return `${FILES[file]}${rank}` as Square;
}

function fileOf(square: Square): number {
	return FILES.indexOf(square[0]);
}

function rankOf(square: Square): number {
	return Number(square[1]);
}

/** 1-8 from `color`'s side of the board. */
function relativeRank(square: Square, color: Color): number {
	return color === 'w' ? rankOf(square) : 9 - rankOf(square);
}

/** Rank a is further up the board than rank b, for `color`. */
function ahead(a: number, b: number, color: Color): boolean {
	return color === 'w' ? a > b : a < b;
}

function pawnsOf(chess: Chess, color: Color): Square[] {
	return chess.findPiece({ type: 'p', color });
}

function squares(): Square[] {
	const all: Square[] = [];
	for (let file = 0; file < 8; file++)
		for (let rank = 1; rank <= 8; rank++) all.push(at(file, rank));
	return all;
}

/** Squares on `color`'s 4th to 6th rank that one of its pawns guards and no
 * enemy pawn can ever attack (none on a neighbouring file further up the
 * board). Squares holding a pawn or an enemy piece are left out: an outpost
 * is somewhere to put a piece. */
export function outposts(chess: Chess, color: Color): Square[] {
	const enemyPawns = pawnsOf(chess, opposite(color));
	return squares().filter((square) => {
		const relative = relativeRank(square, color);
		if (relative < 4 || relative > 6) return false;
		const occupant = chess.get(square);
		if (occupant && (occupant.type === 'p' || occupant.color !== color)) return false;
		const guarded = chess.attackers(square, color).some((from) => chess.get(from)?.type === 'p');
		if (!guarded) return false;
		return !enemyPawns.some(
			(pawn) =>
				Math.abs(fileOf(pawn) - fileOf(square)) === 1 && ahead(rankOf(pawn), rankOf(square), color)
		);
	});
}

/** 'open' with no pawns on the file, 'half_open' with none of `color`'s,
 * null while `color` has a pawn there. */
export function fileKind(chess: Chess, file: number, color: Color): 'open' | 'half_open' | null {
	let own = 0;
	let theirs = 0;
	for (let rank = 1; rank <= 8; rank++) {
		const piece = chess.get(at(file, rank));
		if (piece?.type !== 'p') continue;
		if (piece.color === color) own += 1;
		else theirs += 1;
	}
	if (own > 0) return null;
	return theirs > 0 ? 'half_open' : 'open';
}

/** `color`'s king is on its back rank with no way off it (every square in
 * front blocked by its own pieces or attacked), no rook or queen of its own
 * on that rank to guard it, and the other side has a rook or queen to use
 * it. */
export function weakBackRank(chess: Chess, color: Color): boolean {
	const king = chess.findPiece({ type: 'k', color })[0];
	if (!king || relativeRank(king, color) !== 1) return false;
	const back = rankOf(king);
	const guards = [
		...chess.findPiece({ type: 'r', color }),
		...chess.findPiece({ type: 'q', color })
	];
	if (guards.some((square) => rankOf(square) === back)) return false;
	const enemy = opposite(color);
	const heavy = [
		...chess.findPiece({ type: 'r', color: enemy }),
		...chess.findPiece({ type: 'q', color: enemy })
	];
	if (heavy.length === 0) return false;
	const front = back + (color === 'w' ? 1 : -1);
	for (let df = -1; df <= 1; df++) {
		const file = fileOf(king) + df;
		if (file < 0 || file > 7) continue;
		const square = at(file, front);
		const occupant = chess.get(square);
		if (occupant?.color === color) continue;
		if (chess.isAttacked(square, enemy)) continue;
		return false; // a way off the back rank
	}
	return true;
}

export interface PawnWeaknesses {
	isolated: Square[];
	/** Files with two or more of the side's pawns, as letters. */
	doubled: string[];
	backward: Square[];
}

/** `color`'s weak pawns: isolated (no pawn of its own on a neighbouring
 * file), doubled (another on the same file) and backward (not isolated,
 * every neighbouring pawn of its own already further up the board, and the
 * square in front covered by an enemy pawn). */
export function pawnWeaknesses(chess: Chess, color: Color): PawnWeaknesses {
	const pawns = pawnsOf(chess, color);
	const byFile = new Map<number, Square[]>();
	for (const pawn of pawns) byFile.set(fileOf(pawn), [...(byFile.get(fileOf(pawn)) ?? []), pawn]);
	const isolated: Square[] = [];
	const backward: Square[] = [];
	const doubled = [...byFile.entries()]
		.filter(([, group]) => group.length > 1)
		.map(([file]) => FILES[file])
		.sort();
	const enemy = opposite(color);
	for (const pawn of pawns) {
		const file = fileOf(pawn);
		const neighbours = [...(byFile.get(file - 1) ?? []), ...(byFile.get(file + 1) ?? [])];
		if (neighbours.length === 0) {
			isolated.push(pawn);
			continue;
		}
		if (neighbours.every((n) => ahead(rankOf(n), rankOf(pawn), color))) {
			const stopRank = rankOf(pawn) + (color === 'w' ? 1 : -1);
			if (stopRank < 1 || stopRank > 8) continue;
			const stop = at(file, stopRank);
			if (chess.attackers(stop, enemy).some((from) => chess.get(from)?.type === 'p')) {
				backward.push(pawn);
			}
		}
	}
	return { isolated: isolated.sort(), doubled, backward: backward.sort() };
}

/** `color`'s bishops hemmed in by their own pawns: three or more of them on
 * the bishop's colour, two or more of those fixed there by an enemy pawn
 * standing right in front. A pawn stopped by a piece can still move later,
 * so it does not count. (The server does not tag this one; Review and the
 * overlay show it.) */
export function badBishops(chess: Chess, color: Color): Square[] {
	const pawns = pawnsOf(chess, color);
	const shade = (square: Square) => (fileOf(square) + rankOf(square)) % 2;
	const fixed = (pawn: Square) => {
		const stopRank = rankOf(pawn) + (color === 'w' ? 1 : -1);
		if (stopRank < 1 || stopRank > 8) return false;
		const blocker = chess.get(at(fileOf(pawn), stopRank));
		return blocker?.type === 'p' && blocker.color !== color;
	};
	return chess.findPiece({ type: 'b', color }).filter((bishop) => {
		const same = pawns.filter((pawn) => shade(pawn) === shade(bishop));
		return same.length >= 3 && same.filter(fixed).length >= 2;
	});
}

function list(items: string[]): string {
	return items.length <= 1
		? (items[0] ?? '')
		: `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** What a move changed strategically, in plain sentences that name the side
 * (so the move is written without "…"): an outpost or open file taken, a
 * back rank left weak or mended, new weak pawns or a newly hemmed-in bishop,
 * for either side. Empty when the move changed none of these. */
export function ideaChanges(fenBefore: string, uci: string): string[] {
	const before = new Chess(fenBefore);
	const after = new Chess(fenBefore);
	let move;
	try {
		move = after.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
	} catch {
		return [];
	}
	const mover = move.color;
	const san = move.san;
	const said: string[] = [];

	if ((move.piece === 'n' || move.piece === 'b') && outposts(after, mover).includes(move.to)) {
		const guard = after
			.attackers(move.to, mover)
			.filter((from) => after.get(from)?.type === 'p')
			.sort()[0];
		said.push(
			`${san} puts ${SIDE[mover]}’s ${NAME[move.piece]} on an outpost: the ${guard} pawn guards ${move.to}, and no ${SIDE[opposite(mover)]} pawn can chase it away.`
		);
	}
	if ((move.piece === 'r' || move.piece === 'q') && move.from[0] !== move.to[0]) {
		const kind = fileKind(after, fileOf(move.to), mover);
		if (kind) {
			said.push(
				kind === 'open'
					? `${san} puts ${SIDE[mover]}’s ${NAME[move.piece]} on the open ${move.to[0]}-file.`
					: `${san} puts ${SIDE[mover]}’s ${NAME[move.piece]} on the half-open ${move.to[0]}-file, where ${SIDE[opposite(mover)]} has a pawn to aim at.`
			);
		}
	}

	for (const side of [mover, opposite(mover)] as Color[]) {
		const wasWeak = weakBackRank(before, side);
		const isWeak = weakBackRank(after, side);
		const king = after.findPiece({ type: 'k', color: side })[0];
		if (isWeak && !wasWeak) {
			said.push(
				`${san} leaves ${SIDE[side]}’s back rank weak: the king on ${king} has no way off it, and no rook or queen guards it.`
			);
		} else if (wasWeak && !isWeak && side === mover) {
			said.push(`${san} mends ${SIDE[side]}’s weak back rank.`);
		}

		const old = pawnWeaknesses(before, side);
		const now = pawnWeaknesses(after, side);
		const fresh: string[] = [];
		for (const square of now.isolated.filter((sq) => !old.isolated.includes(sq))) {
			fresh.push(`an isolated pawn on ${square}`);
		}
		for (const file of now.doubled.filter((f) => !old.doubled.includes(f))) {
			fresh.push(`doubled pawns on the ${file}-file`);
		}
		for (const square of now.backward.filter((sq) => !old.backward.includes(sq))) {
			fresh.push(`a backward pawn on ${square}`);
		}
		if (fresh.length > 0) said.push(`${san} leaves ${SIDE[side]} with ${list(fresh)}.`);

		const hemmed = badBishops(after, side).filter((sq) => !badBishops(before, side).includes(sq));
		for (const bishop of hemmed) {
			said.push(
				`${san} hems in ${SIDE[side]}’s bishop on ${bishop}: its own pawns block its colour.`
			);
		}
	}
	return said.slice(0, 3);
}

/** The Structure overlay's marks: outposts for each side, weak pawns, and a
 * king whose back rank is weak. */
export function structureMarks(fen: string): { square: Square; mark: string }[] {
	const chess = new Chess(fen);
	const marks: { square: Square; mark: string }[] = [];
	for (const color of ['w', 'b'] as Color[]) {
		for (const square of outposts(chess, color))
			marks.push({ square, mark: `ov-outpost-${color}` });
		const weak = pawnWeaknesses(chess, color);
		const pawns = new Set<Square>([...weak.isolated, ...weak.backward]);
		for (const file of weak.doubled) {
			for (const pawn of pawnsOf(chess, color)) if (pawn[0] === file) pawns.add(pawn);
		}
		for (const square of pawns) marks.push({ square, mark: 'ov-weak-pawn' });
		for (const square of badBishops(chess, color)) marks.push({ square, mark: 'ov-bad-bishop' });
		if (weakBackRank(chess, color)) {
			const king = chess.findPiece({ type: 'k', color })[0];
			if (king) marks.push({ square: king, mark: 'ov-weak-back-rank' });
		}
	}
	return marks;
}

/** What each idea the server tags means, for Progress — in the player's
 * terms, with the question that would have caught it. */
export const POSITION_IDEAS: Record<string, { label: string; what: string; ask: string }> = {
	outpost: {
		label: 'Outposts',
		what: 'a square for a knight that no enemy pawn can ever attack',
		ask: 'Is there a square their pawns can never reach, and a piece of mine that could stand there?'
	},
	open_file: {
		label: 'Open files',
		what: 'a file with no pawn of your own, where a rook works best',
		ask: 'Which file has no pawn of mine — and is a rook of mine on it?'
	},
	weak_back_rank: {
		label: 'Weak back rank',
		what: 'a king with no way off the back rank, and nothing guarding it',
		ask: 'If a rook checked my king along the back rank, could it get away?'
	},
	isolated_pawn: {
		label: 'Isolated pawns',
		what: 'a pawn with no pawn of its own on either side to guard it',
		ask: 'After this capture or push, which of my pawns has no neighbour left?'
	},
	doubled_pawns: {
		label: 'Doubled pawns',
		what: 'two pawns on one file, where they cannot guard each other',
		ask: 'Does this recapture put two of my pawns on one file?'
	},
	backward_pawn: {
		label: 'Backward pawns',
		what: 'a pawn left behind its neighbours that cannot safely move up',
		ask: 'Is the square in front of this pawn covered by one of theirs?'
	}
};

export function isPositionIdea(motif: string): boolean {
	return motif in POSITION_IDEAS;
}
