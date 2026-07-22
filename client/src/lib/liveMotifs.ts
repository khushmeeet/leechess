/** Client-side motif detection for live Play positions.
 *
 * The server's `app/motifs.py` is the authority for Review and Puzzles (it runs
 * over stored analysis with python-chess). Play has no server round-trip in the
 * loop, so the hint ladder needs a motif client-side, derived from the engine's
 * best line. This is a focused TypeScript port of that module's single-move
 * detectors — the ones a move proves on its own from one position: hanging
 * piece, fork, pin, skewer, back-rank mate, discovered check, double check.
 *
 * The multi-move motifs (deflection, overloading, zwischenzug, …) need a search
 * to prove and stay server-only; under-detection is the deliberate failure mode
 * (same as the server), so a live position with no detected motif simply shows
 * no tactic ladder — just the generic pre-move nudge.
 */
import { Chess, type Color, type Square } from 'chess.js';
import { humanizeMotif, motifReason } from '$lib/motifs';
import type { HintContent } from '$lib/components/HintLadder.svelte';

export const FORK = 'fork';
export const PIN = 'pin';
export const SKEWER = 'skewer';
export const BACK_RANK_MATE = 'back_rank_mate';
export const HANGING_PIECE = 'hanging_piece';
export const DISCOVERED_CHECK = 'discovered_check';
export const DOUBLE_CHECK = 'double_check';

/** Most specific / most decisive first — the chip shows one name. */
const PRIORITY = [BACK_RANK_MATE, DOUBLE_CHECK, DISCOVERED_CHECK, FORK, HANGING_PIECE, PIN, SKEWER];

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

const DIAGONAL = [
	[1, 1],
	[1, -1],
	[-1, 1],
	[-1, -1]
] as const;
const ORTHOGONAL = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1]
] as const;
const SLIDER_DIRECTIONS: Record<string, readonly (readonly [number, number])[]> = {
	b: DIAGONAL,
	r: ORTHOGONAL,
	q: [...DIAGONAL, ...ORTHOGONAL]
};

/** How many plies of the engine line to surface as the "full line". */
const MAX_LINE_PLIES = 8;

function opposite(color: Color): Color {
	return color === 'w' ? 'b' : 'w';
}

function fileOf(square: Square): number {
	return square.charCodeAt(0) - 97;
}
function rankOf(square: Square): number {
	return Number(square[1]) - 1;
}
function squareAt(file: number, rank: number): Square {
	return `${String.fromCharCode(97 + file)}${rank + 1}` as Square;
}

function valueAt(chess: Chess, square: Square): number {
	return VALUE[chess.get(square)!.type];
}

/** `square`'s occupant has at least one friendly piece guarding it. */
function isDefended(chess: Chess, square: Square): boolean {
	const piece = chess.get(square)!;
	return chess.attackers(square, piece.color).length > 0;
}

/** Safe enough to hang a tactic on: no cheaper enemy attacker and, when
 * attacked at all, at least one defender (SEE-lite, matching the server). */
function isSafe(chess: Chess, square: Square): boolean {
	const piece = chess.get(square)!;
	const attackers = chess.attackers(square, opposite(piece.color));
	if (attackers.length === 0) return true;
	if (attackers.some((a) => valueAt(chess, a) < VALUE[piece.type])) return false;
	return isDefended(chess, square);
}

/** True when the piece on `from` attacks `to`. */
function attacks(chess: Chess, from: Square, to: Square): boolean {
	return chess.attackers(to, chess.get(from)!.color).includes(from);
}

/** Enemy pieces attacked from `square` that can't just be left to hang. */
function forkTargets(chess: Chess, square: Square): Square[] {
	const forker = chess.get(square)!;
	const targets: Square[] = [];
	for (const target of enemyPieces(chess, forker.color)) {
		if (!attacks(chess, square, target)) continue;
		const piece = chess.get(target)!;
		if (
			piece.type === 'k' ||
			VALUE[piece.type] > VALUE[forker.type] ||
			(VALUE[piece.type] >= 3 && !isDefended(chess, target))
		) {
			targets.push(target);
		}
	}
	return targets;
}

/** Every square holding an enemy (of `friendly`) piece. */
function enemyPieces(chess: Chess, friendly: Color): Square[] {
	const enemy = opposite(friendly);
	const squares: Square[] = [];
	for (const row of chess.board()) {
		for (const cell of row) {
			if (cell && cell.color === enemy) squares.push(cell.square);
		}
	}
	return squares;
}

function isFork(after: Chess, toSquare: Square): boolean {
	return forkTargets(after, toSquare).length >= 2 && isSafe(after, toSquare);
}

/** The first two pieces met walking `direction` from `square`. */
function firstTwoOnRay(
	chess: Chess,
	square: Square,
	[fileDelta, rankDelta]: readonly [number, number]
): { square: Square; type: string; color: Color }[] {
	let file = fileOf(square);
	let rank = rankOf(square);
	const found: { square: Square; type: string; color: Color }[] = [];
	while (found.length < 2) {
		file += fileDelta;
		rank += rankDelta;
		if (file < 0 || file > 7 || rank < 0 || rank > 7) break;
		const sq = squareAt(file, rank);
		const piece = chess.get(sq);
		if (piece) found.push({ square: sq, type: piece.type, color: piece.color });
	}
	return found;
}

/** Pins and skewers created by the slider that just landed on `toSquare`. */
function lineMotifs(after: Chess, toSquare: Square): Set<string> {
	const piece = after.get(toSquare)!;
	const directions = SLIDER_DIRECTIONS[piece.type] ?? [];
	const motifs = new Set<string>();
	if (directions.length && !isSafe(after, toSquare)) return motifs;
	for (const direction of directions) {
		const pieces = firstTwoOnRay(after, toSquare, direction);
		if (pieces.length < 2) continue;
		const [front, back] = pieces;
		if (front.color === piece.color || back.color === piece.color) continue;
		if (
			front.type !== 'p' &&
			front.type !== 'k' &&
			(back.type === 'k' || VALUE[back.type] > VALUE[front.type])
		) {
			motifs.add(PIN);
		} else if (
			(front.type === 'k' || VALUE[front.type] > VALUE[back.type]) &&
			back.type !== 'k' &&
			VALUE[back.type] >= 3
		) {
			motifs.add(SKEWER);
		}
	}
	return motifs;
}

function findKing(chess: Chess, color: Color): Square | null {
	for (const row of chess.board()) {
		for (const cell of row) {
			if (cell && cell.type === 'k' && cell.color === color) return cell.square;
		}
	}
	return null;
}

function isBackRankMate(after: Chess): boolean {
	if (!after.isCheckmate()) return false;
	const mated = after.turn();
	const kingSquare = findKing(after, mated);
	if (!kingSquare) return false;
	const backRank = mated === 'b' ? 7 : 0;
	if (rankOf(kingSquare) !== backRank) return false;
	const checkers = after.attackers(kingSquare, opposite(mated));
	return checkers.some((sq) => {
		const type = after.get(sq)!.type;
		return (type === 'r' || type === 'q') && rankOf(sq) === backRank;
	});
}

/** The move captures a piece (≥ minor) that was free to take. */
function winsHangingPiece(before: Chess, from: Square, to: Square): boolean {
	const victim = before.get(to);
	if (!victim || VALUE[victim.type] < 3) return false;
	if (!isDefended(before, to)) return true;
	return VALUE[victim.type] > valueAt(before, from);
}

function checkMotifs(
	before: Chess,
	after: Chess,
	from: Square,
	to: Square,
	flags: string
): Set<string> {
	const motifs = new Set<string>();
	const checked = after.turn();
	const kingSquare = findKing(after, checked);
	if (!kingSquare) return motifs;
	const checkers = after.attackers(kingSquare, opposite(checked));
	if (checkers.length === 0) return motifs;
	if (checkers.length >= 2) motifs.add(DOUBLE_CHECK);
	const movedTo = new Set<Square>([to]);
	if (flags.includes('k') || flags.includes('q')) {
		// count the castled rook's landing square as "moved" so its direct
		// check doesn't read as discovered
		const rookFile = fileOf(to) < 4 ? 3 : 5;
		movedTo.add(squareAt(rookFile, rankOf(to)));
	}
	if (checkers.some((sq) => !movedTo.has(sq))) motifs.add(DISCOVERED_CHECK);
	return motifs;
}

/** Every single-move motif the `uci` move executes from `fen`, or an empty set
 * if the move is illegal there. */
export function detectMotifs(fen: string, uci: string): Set<string> {
	const before = new Chess(fen);
	const from = uci.slice(0, 2) as Square;
	const to = uci.slice(2, 4) as Square;
	const after = new Chess(fen);
	let flags: string;
	try {
		flags = after.move({ from, to, promotion: uci[4] }).flags;
	} catch {
		return new Set();
	}

	const motifs = new Set<string>();
	if (winsHangingPiece(before, from, to)) motifs.add(HANGING_PIECE);
	for (const motif of checkMotifs(before, after, from, to, flags)) motifs.add(motif);
	if (isBackRankMate(after)) motifs.add(BACK_RANK_MATE);
	if (isFork(after, to)) motifs.add(FORK);
	for (const motif of lineMotifs(after, to)) motifs.add(motif);
	return motifs;
}

/** The single motif name to surface for `uci` in `fen`, highest priority
 * first, or null when no recognized tactic is present. */
export function detectLiveMotif(fen: string, uci: string): string | null {
	const motifs = detectMotifs(fen, uci);
	return PRIORITY.find((motif) => motifs.has(motif)) ?? null;
}

/** Turn the engine's best line into hint-ladder content — only when its first
 * move executes a recognized tactic. `pvUci` is the principal variation for
 * the user-to-move position `fen`. */
export function liveHintFromLine(fen: string, pvUci: string[]): HintContent | null {
	const best = pvUci[0];
	if (!best) return null;
	const motif = detectLiveMotif(fen, best);
	if (!motif) return null;

	const chess = new Chess(fen);
	const line: string[] = [];
	for (const uci of pvUci.slice(0, MAX_LINE_PLIES)) {
		try {
			line.push(chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
		} catch {
			break;
		}
	}
	if (line.length === 0) return null;

	return {
		category: 'There’s a tactic in this position.',
		motif: humanizeMotif(motif),
		moveSan: line[0],
		reason: motifReason(motif, line[0]),
		line
	};
}
