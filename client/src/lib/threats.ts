/** "What does their last move want?" — the opponent's threat in a position
 * where it is the player's turn.
 *
 * The threat is found by passing: hand the move back to the opponent (a null
 * move) and ask the engine what they would play with it. That search is the
 * caller's job — Play runs it on the in-browser engine, the server's analysis
 * job runs it with native Stockfish and stores the result — so everything
 * here is pure board logic over its result, and Play and Review classify the
 * same facts the same way.
 *
 * The engine move alone is not a threat. A free move is always worth
 * something, and the opponent's best use of one is often just tidying up, or
 * rescuing a piece of their own the player is about to take. So the engine
 * supplies the candidate, and a board fact has to back it before it is
 * reported:
 *
 * | Kind       | Backed by                                                     |
 * |------------|---------------------------------------------------------------|
 * | `mate`     | the passed position is a forced mate for the opponent         |
 * | `material` | the move is a capture that wins material by static exchange   |
 * |            | (told as a `motif` instead when the capture also forks)       |
 * | `motif`    | the move executes a recognized tactic and is worth ≥ 1.5 pawns |
 * | `attack`   | a quiet move worth ≥ 1 pawn that sets something up the player |
 * |            | can check: the piece could then win material by a capture, or |
 * |            | it now hits more squares beside the king (two at least)       |
 * |            | — or, with nothing to point at, any move worth ≥ 3 pawns      |
 *
 * "Worth" is the swing: how much better the opponent stands after a free move
 * than in the real position with the player to move, less whatever the free
 * move takes away from what the player could win by capturing right now. That
 * last part is what keeps a rescue from reading as a threat — when the player
 * can take a queen, the opponent's best free move is to save it, and the eval
 * swings by nine pawns without anything being threatened at all. A capture
 * still there after the free move was not rescued, so it takes nothing off. The last two kinds need the swing because a
 * detector firing is not proof the tactic works. Small threats are reported
 * only with a board fact to point at, and vaguer positional ones below the
 * bars not at all — a threat row that cries wolf teaches the player to stop
 * reading it.
 */
import { Chess, type Color, type Square } from 'chess.js';
import { EVAL_CLAMP_CP } from '$lib/classification';
import { detectMotifs, explainMotif, FORK, HANGING_PIECE, MOTIF_PRIORITY } from '$lib/liveMotifs';
import { humanizeMotif } from '$lib/motifs';

/** An engine score, white's point of view: centipawns, or moves to mate. */
export interface EngineScore {
	cp?: number | null;
	mate?: number | null;
}

export type ThreatKind = 'mate' | 'material' | 'motif' | 'attack';

export interface Threat {
	kind: ThreatKind;
	/** The side making the threat. */
	by: 'white' | 'black';
	/** The threatening move, UCI — for the board arrow. */
	uci: string;
	/** The same move as SAN, "…" prefixed for Black ("…Bxf5"). */
	san: string;
	/** The square under attack, for `material` threats — circled on the board. */
	target: Square | null;
	/** Humanized motif name, for `motif` threats. */
	motif: string | null;
	/** The whole sentence: "Black threatens …Bxf5, winning the bishop on f5
	 * (attacked twice, defended once)." */
	text: string;
}

export interface ThreatInput {
	/** The real position, with the player (the defending side) to move. */
	fen: string;
	/** The opponent's best move in the passed position (`passTurn(fen)`). */
	threatUci: string | null | undefined;
	/** The engine's score of the passed position, white POV. */
	threatScore: EngineScore;
	/** The engine's score of the real position, white POV. Without it only
	 * `mate` and `material` threats can be reported — the other two kinds are
	 * defined by the swing between the two scores. */
	currentScore: EngineScore | null;
}

/** Swing, in centipawns, a tactic must be worth before it is reported. */
export const MOTIF_SWING_CP = 150;
/** Swing, in centipawns, past which a threat is reported with no name. */
export const ATTACK_SWING_CP = 300;
/** Swing, in centipawns, a quiet threat must be worth when the board backs
 * it with something to point at (`setsUp`) — a pawn's worth. */
export const SMALL_SWING_CP = 100;

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const PIECE_NAME: Record<string, string> = {
	p: 'pawn',
	n: 'knight',
	b: 'bishop',
	r: 'rook',
	q: 'queen',
	k: 'king'
};
const COLOR_NAME: Record<Color, 'white' | 'black'> = { w: 'white', b: 'black' };

function opposite(color: Color): Color {
	return color === 'w' ? 'b' : 'w';
}

/** The same position with the other side to move — the null move the threat
 * search runs on. Null when the side to move is in check: there is no passing
 * out of check, and the check is already the threat. The en passant square is
 * dropped, since it belonged to the move that was just played. */
export function passTurn(fen: string): string | null {
	let chess: Chess;
	try {
		chess = new Chess(fen);
	} catch {
		return null;
	}
	if (chess.isCheck() || chess.isGameOver()) return null;
	const fields = fen.split(' ');
	fields[1] = fields[1] === 'w' ? 'b' : 'w';
	fields[3] = '-';
	return fields.join(' ');
}

/** Material the side moving `from` → `to` comes out ahead by, in pawns, if
 * both sides keep recapturing on `to` with their cheapest piece and either may
 * stop when continuing would lose. Pieces lined up behind each other (a queen
 * behind a rook) join in as the ones in front are used up, because the
 * attackers are recounted on the board as each capture is made. Zero when
 * `to` is empty. */
export function staticExchange(fen: string, from: Square, to: Square): number {
	const board = new Chess(fen);
	const target = board.get(to);
	const mover = board.get(from);
	if (!target || !mover) return 0;

	const gains = [VALUE[target.type]];
	board.remove(from);
	board.put(mover, to);
	let standing = VALUE[mover.type];
	let side = opposite(mover.color);

	for (;;) {
		const attackers = board.attackers(to, side);
		if (attackers.length === 0) break;
		const cheapest = attackers.reduce((best, square) =>
			VALUE[board.get(square)!.type] < VALUE[board.get(best)!.type] ? square : best
		);
		const piece = board.get(cheapest)!;
		gains.push(standing - gains[gains.length - 1]);
		board.remove(cheapest);
		board.put(piece, to);
		standing = VALUE[piece.type];
		side = opposite(side);
	}

	for (let i = gains.length - 1; i > 0; i--) {
		gains[i - 1] = -Math.max(-gains[i - 1], gains[i]);
	}
	return gains[0] || 0; // the negations above can leave an even trade at -0
}

/** The most the side to move in `fen` wins, in pawns, by its best capture —
 * zero when every capture loses material or there is none. */
export function bestCaptureGain(fen: string): number {
	let best = 0;
	for (const move of new Chess(fen).moves({ verbose: true })) {
		if (!move.isCapture() || move.isEnPassant()) continue;
		best = Math.max(best, staticExchange(fen, move.from, move.to));
	}
	return best;
}

/** Centipawns, white POV, with mate pinned to the clamp — the same scale the
 * stored evals use, so a mate on either side of the swing reads as decisive
 * without blowing the arithmetic up. */
function centipawns(score: EngineScore): number | null {
	if (score.mate !== undefined && score.mate !== null) {
		return score.mate > 0 ? EVAL_CLAMP_CP : -EVAL_CLAMP_CP;
	}
	if (score.cp === undefined || score.cp === null) return null;
	return Math.max(-EVAL_CLAMP_CP, Math.min(EVAL_CLAMP_CP, score.cp));
}

function times(count: number): string {
	if (count === 1) return 'once';
	if (count === 2) return 'twice';
	return `${count} times`;
}

/** "the bishop on f5" */
function describe(chess: Chess, square: Square): string {
	return `the ${PIECE_NAME[chess.get(square)!.type]} on ${square}`;
}

/** Why a capture wins, in the terms a player can check on the board. */
function materialClause(passed: Chess, from: Square, to: Square): string {
	const target = passed.get(to)!;
	const attacker = passed.get(from)!;
	const attackers = passed.attackers(to, attacker.color).length;
	const defenders = passed.attackers(to, target.color).length;
	const piece = describe(passed, to);
	if (defenders === 0) return `winning ${piece}, which nothing defends`;
	if (VALUE[attacker.type] < VALUE[target.type]) {
		return `winning material: ${piece} is worth more than the ${PIECE_NAME[attacker.type]} that takes it`;
	}
	return `winning ${piece} (attacked ${times(attackers)}, defended ${times(defenders)})`;
}

/** The squares next to `color`'s king. */
function kingZone(chess: Chess, color: Color): Square[] {
	const king = chess.findPiece({ type: 'k', color })[0];
	if (!king) return [];
	const file = king.charCodeAt(0);
	const rank = Number(king[1]);
	const zone: Square[] = [];
	for (let df = -1; df <= 1; df++) {
		for (let dr = -1; dr <= 1; dr++) {
			const f = file + df;
			const r = rank + dr;
			if ((df === 0 && dr === 0) || f < 97 || f > 104 || r < 1 || r > 8) continue;
			zone.push(`${String.fromCharCode(f)}${r}` as Square);
		}
	}
	return zone;
}

/** What a quiet threat move sets up, when it is something the player can
 * check on the board, as the rest of the sentence after "threatens …Qf4":
 * the piece that moved could then win material by a capture, or it now hits
 * more squares next to the player's king than it did (two at least). Null
 * for anything vaguer, which is left unreported below the attack bar. */
function setsUp(passed: Chess, after: Chess, from: Square, to: Square): string | null {
	const mover = after.get(to)!;
	const prefix = mover.color === 'b' ? '…' : '';
	// the threatener's next move, as though the player passed in turn; none
	// when the move gives check, which is a threat of its own kind
	const againFen = passTurn(after.fen());
	if (againFen) {
		const again = new Chess(againFen);
		let best: { gain: number; from: Square; to: Square; san: string } | null = null;
		for (const move of again.moves({ square: to, verbose: true })) {
			if (!move.isCapture() || move.isEnPassant()) continue;
			const gain = staticExchange(againFen, move.from, move.to);
			if (gain >= 1 && (!best || gain > best.gain)) {
				best = { gain, from: move.from, to: move.to, san: move.san };
			}
		}
		if (best) {
			return ` and then ${prefix}${best.san}, ${materialClause(again, best.from, best.to)}`;
		}
	}
	const defender = opposite(mover.color);
	const zone = kingZone(after, defender);
	const hitNow = zone.filter((square) => after.attackers(square, mover.color).includes(to));
	const hitBefore = zone.filter((square) => passed.attackers(square, mover.color).includes(from));
	if (hitNow.length >= 2 && hitNow.length > hitBefore.length) {
		const king = COLOR_NAME[defender] === 'white' ? 'White' : 'Black';
		const squares = `${hitNow.slice(0, -1).join(', ')} and ${hitNow.at(-1)}`;
		return `, aiming the ${PIECE_NAME[mover.type]} at ${king}’s king: from ${to} it hits ${squares}, next to the king`;
	}
	return null;
}

/** The opponent's threat in `input.fen`, or null when there is nothing
 * concrete to answer. See the module comment for what counts. */
export function classifyThreat(input: ThreatInput): Threat | null {
	const { fen, threatUci, threatScore, currentScore } = input;
	if (!threatUci) return null;
	const passedFen = passTurn(fen);
	if (!passedFen) return null;

	const passed = new Chess(passedFen);
	const from = threatUci.slice(0, 2) as Square;
	const to = threatUci.slice(2, 4) as Square;
	const after = new Chess(passedFen);
	let san: string;
	let flags: string;
	try {
		const move = after.move({ from, to, promotion: threatUci[4] });
		san = move.san;
		flags = move.flags;
	} catch {
		return null; // the engine's move doesn't fit this position — say nothing
	}

	const threatener = passed.turn();
	const by = COLOR_NAME[threatener];
	const shown = threatener === 'b' ? `…${san}` : san;
	const subject = by === 'white' ? 'White' : 'Black';
	const sign = threatener === 'w' ? 1 : -1;
	const base = { by, uci: threatUci, san: shown } as const;

	const mate = threatScore.mate;
	if (mate !== undefined && mate !== null && sign * mate > 0) {
		const text = after.isCheckmate()
			? `${subject} threatens ${shown}, checkmate.`
			: `${subject} threatens a forced mate starting with ${shown} (mate in ${Math.abs(mate)}).`;
		return { ...base, kind: 'mate', target: null, motif: null, text };
	}

	const motifs = detectMotifs(passedFen, threatUci);
	const capture = flags.includes('c') || flags.includes('e');
	if (capture && staticExchange(passedFen, from, to) >= 1) {
		// a capture that lands on a fork (…Nxf2 hitting both rooks) is about the
		// fork — the pawn it picks up on the way is the small part of it
		const fork = motifs.has(FORK) ? explainMotif(passedFen, threatUci, FORK) : null;
		if (fork) {
			return {
				...base,
				kind: 'motif',
				target: null,
				motif: humanizeMotif(FORK),
				text: `${subject} threatens ${shown}, a fork: ${fork}.`
			};
		}
		return {
			...base,
			kind: 'material',
			target: to,
			motif: null,
			text: `${subject} threatens ${shown}, ${materialClause(passed, from, to)}.`
		};
	}

	const now = currentScore ? centipawns(currentScore) : null;
	const passedScore = centipawns(threatScore);
	if (now === null || passedScore === null) return null;
	// how much better the opponent stands with the free move than they do now,
	// less what the free move took off the player's board — a capture it
	// rescued from, not one still there after it (see the module comment)
	const rescued = bestCaptureGain(fen) - bestCaptureGain(after.fen());
	const swing = sign * (passedScore - now) - 100 * Math.max(0, rescued);

	if (swing >= MOTIF_SWING_CP) {
		// a capture that loses the exchange isn't a hanging piece, whatever the
		// detector's own heuristic says — the exchange count above is the
		// authority on captures
		const motif = MOTIF_PRIORITY.find((name) => name !== HANGING_PIECE && motifs.has(name));
		const why = motif ? explainMotif(passedFen, threatUci, motif) : null;
		if (motif && why) {
			const name = humanizeMotif(motif);
			return {
				...base,
				kind: 'motif',
				target: null,
				motif: name,
				text: `${subject} threatens ${shown}, a ${name}: ${why}.`
			};
		}
	}

	// a quiet move worth a pawn or more, with something on the board to point
	// at; above the attack bar the same clause beats a bare number
	const setup = swing >= SMALL_SWING_CP ? setsUp(passed, after, from, to) : null;
	if (setup) {
		return {
			...base,
			kind: 'attack',
			target: null,
			motif: null,
			text: `${subject} threatens ${shown}${setup}.`
		};
	}

	if (swing >= ATTACK_SWING_CP) {
		const pawns = Math.round(swing / 100);
		return {
			...base,
			kind: 'attack',
			target: null,
			motif: null,
			text: `${subject} threatens ${shown}, which would gain about ${pawns} pawns’ worth.`
		};
	}
	return null;
}

/** What became of a threat once the move that faced it was played. */
export type ThreatOutcome =
	{ kind: 'ignored' } | { kind: 'replaced'; replySan: string } | { kind: 'answered' };

/** Read off the other side's best move after the move (`replyUci`, the next
 * position's stored best move). Still the threat: the move left it on the
 * board. Something else, after a mistake or blunder: the move made a bigger
 * problem, and that is what to name — calling a move that dropped the queen
 * "answered" would teach the wrong lesson. Something else after a sound move:
 * answered. Null without a next position to read. */
export function threatOutcome(
	threat: Threat,
	played: { fenAfter: string; classification: string | null },
	replyUci: string | null | undefined
): ThreatOutcome | null {
	if (!replyUci) return null;
	if (replyUci === threat.uci) return { kind: 'ignored' };
	if (played.classification !== 'mistake' && played.classification !== 'blunder') {
		return { kind: 'answered' };
	}
	const after = new Chess(played.fenAfter);
	try {
		const reply = after.move({
			from: replyUci.slice(0, 2),
			to: replyUci.slice(2, 4),
			promotion: replyUci[4]
		});
		return { kind: 'replaced', replySan: reply.color === 'b' ? `…${reply.san}` : reply.san };
	} catch {
		return null; // a stored move that doesn't fit the position — claim nothing
	}
}
