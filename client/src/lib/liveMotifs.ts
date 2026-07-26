/** Client-side motif detection for live Play positions.
 *
 * The server's `app/motifs.py` is the authority for Review and Puzzles (it runs
 * over stored analysis with python-chess). Play has no server round-trip in the
 * loop, so the hint ladder needs a motif client-side, derived from the engine's
 * best line. This is a TypeScript port of that module's detectors, kept at
 * parity with it: fork, pin, skewer, back-rank mate, hanging piece, discovered
 * check, double check, discovered attack, deflection, overloading, trapped
 * piece, zwischenzug.
 *
 * The multi-move motifs (deflection, overloading, zwischenzug) can't be proven
 * from a single move without a search, so each settles for the same
 * conservative single-move signature the server uses — under-tagging is
 * preferred to a tagger that cries wolf. A live position with no detected motif
 * simply shows no tactic ladder, just the generic pre-move nudge.
 *
 * Only x-ray and the strategic motifs are missing here, because the server
 * doesn't detect them either. Keep the two in step: when a detector lands
 * there, port it here (and vice versa).
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
export const DISCOVERED_ATTACK = 'discovered_attack';
export const DEFLECTION = 'deflection';
export const OVERLOADING = 'overloading';
export const TRAPPED_PIECE = 'trapped_piece';
export const ZWISCHENZUG = 'zwischenzug';

/** The taxonomy this module detects, most specific / most decisive first —
 * the Level 2 chip shows one name. Kept at parity with the detectors in
 * `server/app/motifs.py`; `liveMotifs.test.ts` pins the list so a motif added
 * on one side and not the other fails the build. */
export const MOTIF_PRIORITY = [
	BACK_RANK_MATE,
	DOUBLE_CHECK,
	DISCOVERED_CHECK,
	DISCOVERED_ATTACK,
	FORK,
	HANGING_PIECE,
	ZWISCHENZUG,
	DEFLECTION,
	OVERLOADING,
	TRAPPED_PIECE,
	PIN,
	SKEWER
];

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

/** Every square holding a piece of `color`. */
function piecesOf(chess: Chess, color: Color): Square[] {
	const squares: Square[] = [];
	for (const row of chess.board()) {
		for (const cell of row) {
			if (cell && cell.color === color) squares.push(cell.square);
		}
	}
	return squares;
}

/** Every square holding an enemy (of `friendly`) piece. */
function enemyPieces(chess: Chess, friendly: Color): Square[] {
	return piecesOf(chess, opposite(friendly));
}

/** Squares strictly between two squares on a shared rank, file, or diagonal;
 * empty when they aren't aligned (python-chess `between`). */
function between(from: Square, to: Square): Square[] {
	const fileDistance = fileOf(to) - fileOf(from);
	const rankDistance = rankOf(to) - rankOf(from);
	if (
		fileDistance !== 0 &&
		rankDistance !== 0 &&
		Math.abs(fileDistance) !== Math.abs(rankDistance)
	) {
		return [];
	}
	const fileStep = Math.sign(fileDistance);
	const rankStep = Math.sign(rankDistance);
	const squares: Square[] = [];
	let file = fileOf(from) + fileStep;
	let rank = rankOf(from) + rankStep;
	while (file !== fileOf(to) || rank !== rankOf(to)) {
		squares.push(squareAt(file, rank));
		file += fileStep;
		rank += rankStep;
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

/** `defenderSquare` is the one and only piece guarding `square`. */
function soleDefender(chess: Chess, square: Square, defenderSquare: Square): boolean {
	const piece = chess.get(square)!;
	const defenders = chess.attackers(square, piece.color);
	return defenders.length === 1 && defenders[0] === defenderSquare;
}

/** A `byColor` slider on the same line could win the enemy piece on `target`:
 * worth taking (≥ minor) and either undefended or worth more than the cheapest
 * attacker. The king is left to the check detectors. */
function winnableTarget(chess: Chess, target: Square, byColor: Color): boolean {
	const piece = chess.get(target)!;
	if (piece.type === 'k' || VALUE[piece.type] < 3) return false;
	if (!isDefended(chess, target)) return true;
	return chess.attackers(target, byColor).some((a) => valueAt(chess, a) < VALUE[piece.type]);
}

/** Vacating the from-square unmasks a friendly slider onto a valuable enemy
 * piece it couldn't reach before. The king case is discovered check, detected
 * separately, so it's excluded here. */
function discoveredAttack(before: Chess, after: Chess, from: Square, to: Square): boolean {
	const friendly = before.turn();
	for (const target of enemyPieces(after, friendly)) {
		if (after.get(target)!.type === 'k') continue;
		for (const attacker of after.attackers(target, friendly)) {
			if (attacker === to) continue; // a direct hit by the moved piece isn't discovered
			if (!SLIDER_DIRECTIONS[after.get(attacker)!.type]) continue;
			if (before.attackers(target, friendly).includes(attacker)) continue; // already bore on it
			if (!between(attacker, target).includes(from)) continue; // wasn't the blocker
			if (winnableTarget(after, target, friendly)) return true;
		}
	}
	return false;
}

/** The moved piece attacks an enemy defender that can't stay put (a capture it
 * can't answer, or an undefended hit), and that defender is the sole guard of a
 * valuable piece — so wherever it runs, the piece it was holding falls. */
function deflection(after: Chess, to: Square): boolean {
	const enemy = after.turn();
	const friendly = opposite(enemy);
	for (const defenderSquare of enemyPieces(after, friendly)) {
		if (!attacks(after, to, defenderSquare)) continue;
		const defender = after.get(defenderSquare)!;
		// not our piece to deflect, or not actually forced away
		if (defender.type === 'k' || isSafe(after, defenderSquare)) continue;
		for (const guardedSquare of piecesOf(after, enemy)) {
			const guarded = after.get(guardedSquare)!;
			if (guardedSquare === defenderSquare || guarded.type === 'k') continue;
			if (VALUE[guarded.type] < 3) continue;
			if (after.attackers(guardedSquare, friendly).length === 0) continue;
			if (soleDefender(after, guardedSquare, defenderSquare)) return true;
		}
	}
	return false;
}

/** One enemy piece is the only defender of two different pieces we attack. It
 * can guard just one: we take the one we can capture at no loss, it recaptures,
 * and the other — now unguarded — falls for free. */
function overloading(after: Chess): boolean {
	const enemy = after.turn();
	const friendly = opposite(enemy);
	const enemySquares = piecesOf(after, enemy);
	for (const defenderSquare of enemySquares) {
		const guarded = enemySquares.filter(
			(square) =>
				square !== defenderSquare &&
				after.get(square)!.type !== 'k' &&
				VALUE[after.get(square)!.type] >= 3 &&
				after.attackers(square, friendly).length > 0 &&
				soleDefender(after, square, defenderSquare)
		);
		if (guarded.length < 2) continue;
		// A concrete win needs a target we can capture at no loss (attacker worth
		// no more than it) plus a *different* attacker still bearing on a second
		// target for after the defender is diverted.
		for (const first of guarded) {
			const initiators = after
				.attackers(first, friendly)
				.filter((a) => valueAt(after, a) <= valueAt(after, first));
			if (initiators.length === 0) continue;
			for (const second of guarded) {
				if (second === first) continue;
				const others = after.attackers(second, friendly).filter((a) => !initiators.includes(a));
				if (others.length > 0) return true;
			}
		}
	}
	return false;
}

/** Any legal move of the piece on `square` that lands it somewhere safe. */
function hasSafeFlight(after: Chess, square: Square): boolean {
	for (const flight of after.moves({ square, verbose: true })) {
		if (isSafe(new Chess(flight.after), flight.to as Square)) return true;
	}
	return false;
}

/** An enemy piece attacked by something cheaper (so it must move) that has no
 * square to run to where it's any safer. A check is excluded — then the forced
 * move is the king's, not the attacked piece's. */
function trappedPiece(after: Chess): boolean {
	if (after.isCheck()) return false;
	const enemy = after.turn();
	for (const square of piecesOf(after, enemy)) {
		const piece = after.get(square)!;
		if (piece.type === 'p' || piece.type === 'k') continue;
		const attackers = after.attackers(square, opposite(enemy));
		// not attacked by anything cheaper — no forced flight
		if (!attackers.some((a) => valueAt(after, a) < VALUE[piece.type])) continue;
		if (!hasSafeFlight(after, square)) return true;
	}
	return false;
}

/** An in-between check: rather than rescue a piece that's already hanging, the
 * mover throws in a check (one that can't just be captured) and leaves the
 * piece hanging for now — the threat comes first. */
function zwischenzug(before: Chess, after: Chess, from: Square, to: Square): boolean {
	if (!after.isCheck() || !isSafe(after, to)) return false;
	const friendly = before.turn();
	for (const square of piecesOf(before, friendly)) {
		const piece = before.get(square)!;
		if (square === from || piece.type === 'k') continue;
		if (VALUE[piece.type] < 3) continue;
		// not a piece that was already hanging
		if (before.attackers(square, opposite(friendly)).length === 0) continue;
		if (isSafe(before, square)) continue;
		const still = after.get(square);
		if (still && !isSafe(after, square)) return true; // left hanging while we check instead
	}
	return false;
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
	if (discoveredAttack(before, after, from, to)) motifs.add(DISCOVERED_ATTACK);
	// a check forces the reply, so the defender-diversion motifs can't be read
	// off the position — the opponent never gets to choose
	if (!after.isCheck()) {
		if (deflection(after, to)) motifs.add(DEFLECTION);
		if (overloading(after)) motifs.add(OVERLOADING);
	}
	if (trappedPiece(after)) motifs.add(TRAPPED_PIECE);
	if (zwischenzug(before, after, from, to)) motifs.add(ZWISCHENZUG);
	return motifs;
}

/** The single motif name to surface for `uci` in `fen`, highest priority
 * first, or null when no recognized tactic is present. */
export function detectLiveMotif(fen: string, uci: string): string | null {
	const motifs = detectMotifs(fen, uci);
	return MOTIF_PRIORITY.find((motif) => motifs.has(motif)) ?? null;
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
