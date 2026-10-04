/** Board overlays: each one is a way of looking at a position, drawn on the
 * board so the player learns to see it without the overlay.
 *
 * - **Loose pieces** — attacked pieces the exchange count says are lost
 *   (`hanging`: nothing defends them; `underdefended`: defended, but not
 *   enough, or attacked by something cheaper). A piece pinned to its king
 *   neither attacks nor defends off its line, and the side to move takes
 *   only with a legal capture — so a check or a pin on the capturing piece
 *   is respected.
 * - **Control** — which side attacks each square more often.
 * - **Pins** — pieces that cannot move without exposing their king, or a
 *   piece worth more than both them and the piece pinning them, with the
 *   line from the pinning piece.
 * - **King safety** — the squares around each king the other side attacks.
 * - **Files** — open files (no pawns) and half-open ones (no pawns of one
 *   side), where rooks belong.
 * - **Structure** — outposts, weak pawns, hemmed-in bishops and a weak back
 *   rank ($lib/positionIdeas).
 *
 * `safeSquares`/`leastActivePiece` count where a piece can go without being
 * lost there — what lets the coach name the worst piece instead of a slogan.
 * Everything is board arithmetic on chess.js; no engine.
 */
import { Chess, type Color, type Square } from 'chess.js';
import { structureMarks } from '$lib/positionIdeas';
import { staticExchange } from '$lib/threats';

export type OverlayName = 'loose' | 'control' | 'pins' | 'king' | 'files' | 'structure';
export const OVERLAYS: { name: OverlayName; label: string; title: string }[] = [
	{
		name: 'loose',
		label: 'Loose pieces',
		title: 'Pieces that can be taken: red if nothing defends them, orange if not enough does'
	},
	{
		name: 'control',
		label: 'Control',
		title: 'Squares White (light) or Black (dark) attacks more often'
	},
	{
		name: 'pins',
		label: 'Pins',
		title:
			'Pieces that cannot move without exposing their king, or a more valuable piece behind them'
	},
	{ name: 'king', label: 'King safety', title: 'Squares around each king the other side attacks' },
	{ name: 'files', label: 'Files', title: 'Open files (no pawns) and half-open ones' },
	{
		name: 'structure',
		label: 'Structure',
		title:
			'Outposts (green ring; with a dark inner ring for Black’s), weak pawns and hemmed-in bishops (orange), and a king with a weak back rank (red)'
	}
];

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const FILES = 'abcdefgh';
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

function allSquares(): Square[] {
	const squares: Square[] = [];
	for (const file of FILES)
		for (let rank = 1; rank <= 8; rank++) squares.push(`${file}${rank}` as Square);
	return squares;
}

/** The position with `color` to move, so its pieces' moves can be listed
 * whoever's turn it really is. Null when that would leave the other king in
 * check (an impossible position). */
function withTurn(fen: string, color: Color): Chess | null {
	const fields = fen.split(' ');
	if (fields[1] !== color) {
		fields[1] = color;
		fields[3] = '-';
	}
	try {
		const chess = new Chess(fields.join(' '));
		const enemyKing = findKing(chess, opposite(color));
		if (enemyKing && chess.isAttacked(enemyKing, color)) return null;
		return chess;
	} catch {
		return null;
	}
}

function findKing(chess: Chess, color: Color): Square | null {
	return chess.findPiece({ type: 'k', color })[0] ?? null;
}

export interface LoosePiece {
	square: Square;
	color: Color;
	kind: 'hanging' | 'underdefended';
}

/** The squares a piece pinned to its king may still move along: the line
 * between the king and the pinning piece, the pinner's own square included. */
function pinLine(pin: Pin): Set<Square> {
	const line = new Set<Square>();
	const df = Math.sign(pin.by.charCodeAt(0) - pin.behind.charCodeAt(0));
	const dr = Math.sign(Number(pin.by[1]) - Number(pin.behind[1]));
	let file = pin.behind.charCodeAt(0) + df;
	let rank = Number(pin.behind[1]) + dr;
	for (;;) {
		const square = `${String.fromCharCode(file)}${rank}` as Square;
		line.add(square);
		if (square === pin.by) return line;
		file += df;
		rank += dr;
	}
}

/** Pieces the other side would win material by taking (kings excepted). */
export function loosePieces(fen: string): LoosePiece[] {
	const chess = new Chess(fen);
	const held = pins(fen)
		.filter((pin) => pin.absolute)
		.map((pin) => ({ square: pin.pinned, line: pinLine(pin) }));
	// what the side to move can actually take now: a pinned piece or one
	// whose king is in check has fewer captures than it has attacks
	const legalTakers = new Map<Square, Square[]>();
	for (const move of chess.moves({ verbose: true })) {
		if (!move.captured) continue;
		legalTakers.set(move.to, [...(legalTakers.get(move.to) ?? []), move.from]);
	}
	const loose: LoosePiece[] = [];
	for (const square of allSquares()) {
		const piece = chess.get(square);
		if (!piece || piece.type === 'k') continue;
		const enemy = opposite(piece.color);
		// pinned pieces that can't reach this square without leaving their line
		const blocked = new Set(held.filter((pin) => !pin.line.has(square)).map((pin) => pin.square));
		const attackers =
			enemy === chess.turn()
				? (legalTakers.get(square) ?? [])
				: chess.attackers(square, enemy).filter((sq) => !blocked.has(sq));
		if (attackers.length === 0) continue;
		const cheapest = attackers.reduce((best, sq) =>
			VALUE[chess.get(sq)!.type] < VALUE[chess.get(best)!.type] ? sq : best
		);
		if (staticExchange(fen, cheapest, square, blocked) < 1) continue;
		const defended = chess.attackers(square, piece.color).some((sq) => !blocked.has(sq));
		loose.push({ square, color: piece.color, kind: defended ? 'underdefended' : 'hanging' });
	}
	return loose;
}

/** Squares one side attacks more often than the other. */
export function control(fen: string): Map<Square, Color> {
	const chess = new Chess(fen);
	const owner = new Map<Square, Color>();
	for (const square of allSquares()) {
		const white = chess.attackers(square, 'w').length;
		const black = chess.attackers(square, 'b').length;
		if (white > black) owner.set(square, 'w');
		else if (black > white) owner.set(square, 'b');
	}
	return owner;
}

export interface Pin {
	pinned: Square;
	by: Square;
	/** The piece the pin is against. */
	behind: Square;
	/** Pinned to the king: the piece may not leave the line at all. Otherwise
	 * it may, at the cost of the more valuable piece behind it. */
	absolute: boolean;
}

/** Pieces that cannot leave their line without exposing what stands behind
 * them: their king, or a piece worth more than both the pinned piece and
 * the one pinning it (moving would lose material — a queen behind a knight
 * pinned by a bishop). Lift the piece off and see which enemy slider then
 * newly attacks the piece behind. A piece pinned to its king is reported
 * against the king only. */
export function pins(fen: string): Pin[] {
	const chess = new Chess(fen);
	const found: Pin[] = [];
	for (const color of ['w', 'b'] as Color[]) {
		const enemy = opposite(color);
		// what a pin can be against, king first so an absolute pin wins
		const targets = allSquares()
			.filter((sq) => {
				const piece = chess.get(sq);
				return piece?.color === color && 'kqr'.includes(piece.type);
			})
			.sort((a, b) => VALUE[chess.get(b)!.type] - VALUE[chess.get(a)!.type])
			.map((sq) => ({
				square: sq,
				value: VALUE[chess.get(sq)!.type],
				before: new Set(chess.attackers(sq, enemy))
			}));
		for (const square of allSquares()) {
			const piece = chess.get(square);
			if (!piece || piece.color !== color || piece.type === 'k') continue;
			chess.remove(square);
			for (const target of targets) {
				if (target.square === square || target.value <= VALUE[piece.type]) continue;
				const absolute = target.value === VALUE.k;
				const by = chess.attackers(target.square, enemy).find((sq) => {
					const pinner = chess.get(sq)!;
					return (
						!target.before.has(sq) &&
						'brq'.includes(pinner.type) &&
						(absolute || VALUE[pinner.type] < target.value)
					);
				});
				if (by) {
					found.push({ pinned: square, by, behind: target.square, absolute });
					break;
				}
			}
			chess.put(piece, square);
		}
	}
	return found;
}

/** Squares next to each king (and the king's own) the other side attacks. */
export function kingDanger(fen: string): Square[] {
	const chess = new Chess(fen);
	const danger: Square[] = [];
	for (const color of ['w', 'b'] as Color[]) {
		const king = findKing(chess, color);
		if (!king) continue;
		const file = FILES.indexOf(king[0]);
		const rank = Number(king[1]);
		for (let df = -1; df <= 1; df++) {
			for (let dr = -1; dr <= 1; dr++) {
				const f = file + df;
				const r = rank + dr;
				if (f < 0 || f > 7 || r < 1 || r > 8) continue;
				const square = `${FILES[f]}${r}` as Square;
				if (chess.isAttacked(square, opposite(color))) danger.push(square);
			}
		}
	}
	return danger;
}

export interface FileState {
	file: string;
	/** `open`: no pawns at all; `white`/`black`: half-open for that side
	 * (none of its own pawns, so its rooks see down it). */
	kind: 'open' | 'white' | 'black';
}

export function files(fen: string): FileState[] {
	const chess = new Chess(fen);
	const result: FileState[] = [];
	for (const file of FILES) {
		let white = 0;
		let black = 0;
		for (let rank = 1; rank <= 8; rank++) {
			const piece = chess.get(`${file}${rank}` as Square);
			if (piece?.type !== 'p') continue;
			if (piece.color === 'w') white += 1;
			else black += 1;
		}
		if (white === 0 && black === 0) result.push({ file, kind: 'open' });
		else if (white === 0) result.push({ file, kind: 'white' });
		else if (black === 0) result.push({ file, kind: 'black' });
	}
	return result;
}

/** Where the piece on `square` can move without being lost there: legal
 * destinations the opponent can't win material on by taking it. */
export function safeSquares(fen: string, square: Square): Square[] {
	const piece = new Chess(fen).get(square);
	if (!piece) return [];
	const board = withTurn(fen, piece.color);
	if (!board) return [];
	const safe: Square[] = [];
	for (const move of board.moves({ square, verbose: true })) {
		const after = new Chess(board.fen());
		after.move(move);
		const attackers = after.attackers(move.to, opposite(piece.color));
		const lost = attackers.some((attacker) => staticExchange(after.fen(), attacker, move.to) >= 1);
		if (!lost) safe.push(move.to);
	}
	return safe;
}

/** The side's knight, bishop, rook or queen with the fewest safe squares,
 * when it has three or fewer — the piece a coach would point at. Ties go to
 * the minor piece, which is the one that should be out by now. */
export function leastActivePiece(
	fen: string,
	color: Color
): { square: Square; name: string; safe: number } | null {
	const chess = new Chess(fen);
	let worst: { square: Square; name: string; safe: number; value: number } | null = null;
	for (const square of allSquares()) {
		const piece = chess.get(square);
		if (!piece || piece.color !== color || !'nbrq'.includes(piece.type)) continue;
		const safe = safeSquares(fen, square).length;
		const value = VALUE[piece.type];
		if (!worst || safe < worst.safe || (safe === worst.safe && value < worst.value)) {
			worst = { square, name: NAME[piece.type], safe, value };
		}
	}
	if (!worst || worst.safe > 3) return null;
	return { square: worst.square, name: worst.name, safe: worst.safe };
}

/** The board classes and arrows for the overlays switched on. */
export function overlayMarks(
	fen: string,
	enabled: ReadonlySet<OverlayName>
): { classes: Map<Square, string>; pinLines: Pin[] } {
	const classes = new Map<Square, string>();
	const add = (square: Square, klass: string) =>
		classes.set(square, classes.has(square) ? `${classes.get(square)} ${klass}` : klass);
	if (enabled.has('control')) {
		for (const [square, color] of control(fen)) add(square, `ov-control-${color}`);
	}
	if (enabled.has('files')) {
		for (const { file, kind } of files(fen)) {
			for (let rank = 1; rank <= 8; rank++) add(`${file}${rank}` as Square, `ov-file-${kind}`);
		}
	}
	if (enabled.has('king')) {
		for (const square of kingDanger(fen)) add(square, 'ov-king');
	}
	if (enabled.has('structure')) {
		for (const { square, mark } of structureMarks(fen)) add(square, mark);
	}
	if (enabled.has('loose')) {
		for (const { square, kind } of loosePieces(fen)) add(square, `ov-${kind}`);
	}
	const pinLines = enabled.has('pins') ? pins(fen) : [];
	for (const pin of pinLines) add(pin.pinned, pin.absolute ? 'ov-pinned' : 'ov-pinned-relative');
	return { classes, pinLines };
}

/** The overlay classes with the notation-focus class added on `focus` — the
 * board's whole `highlight.custom` map, undefined when there is nothing. */
export function boardHighlights(
	classes: ReadonlyMap<Square, string> | undefined,
	focus: Square | null
): Map<Square, string> | undefined {
	const merged = new Map(classes ?? []);
	if (focus)
		merged.set(focus, merged.has(focus) ? `${merged.get(focus)} notation-focus` : 'notation-focus');
	return merged.size > 0 ? merged : undefined;
}
