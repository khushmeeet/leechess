import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import { ApiError, getNextDrill, recordDrillAttempt, type DrillRecord } from '$lib/api/client';
import { GameStore, type PlayedMove } from './game.svelte';
import { soundPrefs } from './soundPrefs.svelte';
import { stockfish, type EngineEval } from './stockfish';

export type DrillStatus = 'loading' | 'empty' | 'playing' | 'won' | 'lost' | 'error';

/** Why a drill ended. Recorded with the attempt so a later post-mortem can
 * tell "I lost the pawn" from "I ran out of moves". */
export type DrillOutcome =
	| 'mate'
	| 'promoted'
	| 'stalemate'
	| 'insufficient'
	| 'repetition'
	| 'fifty-move'
	| 'opponent-disarmed'
	| 'mated'
	| 'opponent-promoted'
	| 'material-lost'
	| 'move-cap';

export type DrillVerdict =
	{ done: true; success: boolean; outcome: DrillOutcome } | { done: false };

export type Side = 'white' | 'black';

/** The engine defends at full strength — that is what makes the outcome mean
 * something, and it is why grading needs no eval of its own. */
const DRILL_SKILL = 20;
/** Ceiling on the user's own moves. A win drill that hits it wasn't
 * converted; a draw drill that hits it was held, which is how these endings
 * actually resolve over the board. */
export const MOVE_CAP = 60;
/** Same two-attempt recovery the play screen uses: the first failure tears
 * down the worker, so the retry runs on a fresh engine. */
const ENGINE_REPLY_ATTEMPTS = 2;

function other(side: Side): Side {
	return side === 'white' ? 'black' : 'white';
}

const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

function materialValue(placement: string, white: boolean): number {
	let total = 0;
	for (const char of placement) {
		const value = PIECE_VALUES[char.toLowerCase()];
		if (value === undefined) continue; // rank digit or separator
		if ((char === char.toUpperCase()) === white) total += value;
	}
	return total;
}

function hasPawn(placement: string, white: boolean): boolean {
	return placement.includes(white ? 'P' : 'p');
}

/** Can `side` still force a result in its favour with the material left?
 *
 * True while it has a pawn to promote, or simply more material than the other
 * side. That second clause is what separates "lost the pawn, drill over" from
 * "traded into something still won": K+P down to bare kings fails, R+P down to
 * R vs R fails (level material, dead drawn), but winning the enemy rook — or
 * promoting into Q+R vs R — keeps the drill alive.
 *
 * Piece values are the schoolbook ones; nothing here needs to be finer than
 * "is one side plainly up material", and the positions this runs on hold a
 * handful of pieces at most.
 */
export function canStillWin(chess: Chess, side: Side): boolean {
	const placement = chess.fen().split(' ')[0];
	const white = side === 'white';
	if (hasPawn(placement, white)) return true;
	return materialValue(placement, white) > materialValue(placement, !white);
}

export interface JudgeContext {
	goal: 'win' | 'draw';
	playerColor: Side;
	/** The move just played — promotions are read off its UCI (5 chars). */
	lastMove?: { uci: string; byPlayer: boolean };
	/** The user's own moves so far, for the cap. */
	playerMoves: number;
}

/** Decide whether a drill has resolved, and in whose favour.
 *
 * Pure and engine-free: everything below is a board fact chess.js already
 * knows. A win drill ends on promotion rather than mate so nobody has to
 * grind out K+Q vs K, and a draw drill ends when the opponent promotes for
 * the same reason.
 */
export function judgeDrill(chess: Chess, ctx: JudgeContext): DrillVerdict {
	const { goal, playerColor, lastMove, playerMoves } = ctx;
	const won = (outcome: DrillOutcome): DrillVerdict => ({ done: true, success: true, outcome });
	const lost = (outcome: DrillOutcome): DrillVerdict => ({ done: true, success: false, outcome });

	if (chess.isCheckmate()) {
		// the side to move is the one that got mated
		const mated: Side = chess.turn() === 'w' ? 'white' : 'black';
		return mated === playerColor ? lost('mated') : won('mate');
	}
	if (chess.isStalemate()) return goal === 'draw' ? won('stalemate') : lost('stalemate');
	if (chess.isInsufficientMaterial()) {
		return goal === 'draw' ? won('insufficient') : lost('insufficient');
	}
	if (chess.isThreefoldRepetition()) {
		return goal === 'draw' ? won('repetition') : lost('repetition');
	}
	if (chess.isDrawByFiftyMoves()) {
		return goal === 'draw' ? won('fifty-move') : lost('fifty-move');
	}

	const promoted = lastMove !== undefined && lastMove.uci.length === 5;
	if (goal === 'win' && promoted && lastMove!.byPlayer) {
		// Only count it once the new piece is safe: if the opponent can take it
		// straight back the technique hasn't landed yet, so play on rather than
		// award the drill. (It's the opponent to move here.)
		const square = lastMove!.uci.slice(2, 4);
		const capturable = chess.moves({ verbose: true }).some((move) => move.to === square);
		if (!capturable) return won('promoted');
	}
	if (goal === 'draw' && promoted && !lastMove!.byPlayer) return lost('opponent-promoted');

	if (goal === 'win' && !canStillWin(chess, playerColor)) return lost('material-lost');
	if (goal === 'draw' && !canStillWin(chess, other(playerColor))) return won('opponent-disarmed');

	if (playerMoves >= MOVE_CAP) {
		return goal === 'draw' ? won('move-cap') : lost('move-cap');
	}
	return { done: false };
}

/** Human-facing reason, shown in the result banner. */
export function describeOutcome(outcome: DrillOutcome, success: boolean): string {
	switch (outcome) {
		case 'mate':
			return 'Checkmate — converted.';
		case 'promoted':
			return 'Pawn promoted safely — that’s the win.';
		case 'stalemate':
			return success ? 'Stalemate — held.' : 'Stalemate — the win slipped away.';
		case 'insufficient':
			return success ? 'Nothing left to mate with — held.' : 'Not enough material left to win.';
		case 'repetition':
			return success ? 'Threefold repetition — held.' : 'Repetition — no progress made.';
		case 'fifty-move':
			return success ? 'Fifty-move rule — held.' : 'Fifty moves without progress.';
		case 'opponent-disarmed':
			return 'The pawn is gone — nothing left to defend against.';
		case 'mated':
			return 'Checkmated.';
		case 'opponent-promoted':
			return 'The pawn queened — the defense broke.';
		case 'material-lost':
			return 'Your pawn went, and with it the win.';
		case 'move-cap':
			return success
				? 'Held long enough — that’s the draw.'
				: 'Ran out of moves without converting.';
	}
}

/** One drill at a time: the user plays `drill.player_color` and full-strength
 * Stockfish takes the other side. Unlike a puzzle there is no solution line —
 * the position is played out and `judgeDrill` decides when it has resolved.
 *
 * Engine searches are serialized through `chain` (there is one WASM engine),
 * and `generation` invalidates work queued for a drill the user has already
 * moved on from.
 */
export class DrillSession {
	drill = $state<DrillRecord | null>(null);
	status = $state<DrillStatus>('loading');
	error = $state<string | null>(null);
	outcome = $state<DrillOutcome | null>(null);

	game = $state(new GameStore());
	engineReady = $state(false);
	engineThinking = $state(false);
	/** Set when the engine gave up after retries; the drill waits on the
	 * engine's turn until `retryEngineMove()` runs. */
	engineError = $state<string | null>(null);

	/** The user's own moves in the current attempt (what MOVE_CAP counts). */
	playerMoves = $state(0);
	completedCount = $state(0);

	private chain: Promise<void> = Promise.resolve();
	private generation = 0;
	private suspended = false;
	private attemptRecorded = false;

	get playerColor(): Side {
		return (this.drill?.player_color as Side) ?? 'white';
	}

	get goal(): 'win' | 'draw' {
		return (this.drill?.goal as 'win' | 'draw') ?? 'win';
	}

	get isPlayersTurn(): boolean {
		return this.game.turnColor === this.playerColor;
	}

	get userCanMove(): boolean {
		return this.status === 'playing' && this.isPlayersTurn;
	}

	/** Queue a job behind prior engine work, dropping jobs left over from a
	 * drill the session has already moved past. */
	private inChain(job: () => Promise<void>): void {
		const generation = this.generation;
		this.chain = this.chain
			.then(() => (generation === this.generation && !this.suspended ? job() : undefined))
			.catch((error) => console.error('drill engine chain:', error));
	}

	async load(family?: string | null): Promise<void> {
		this.generation += 1;
		this.status = 'loading';
		this.error = null;
		try {
			const drill = await getNextDrill(family);
			this.begin(drill);
		} catch (e) {
			this.drill = null;
			if (e instanceof ApiError && e.status === 404) {
				this.status = 'empty';
			} else {
				this.status = 'error';
				this.error = e instanceof Error ? e.message : String(e);
			}
			return;
		}
		await this.startEngine();
	}

	/** Replay the drill already loaded, from its starting position. */
	restart(): void {
		if (!this.drill) return;
		this.generation += 1;
		this.begin(this.drill);
		void this.startEngine();
	}

	private begin(drill: DrillRecord): void {
		this.drill = drill;
		this.game = new GameStore(drill.fen);
		this.status = 'playing';
		this.outcome = null;
		this.playerMoves = 0;
		this.attemptRecorded = false;
		this.engineThinking = false;
		this.engineError = null;
	}

	/** Warm the engine, then let it open if the drill starts on its turn. */
	private async startEngine(): Promise<void> {
		try {
			await stockfish.warmup();
		} catch (error) {
			this.engineError = error instanceof Error ? error.message : 'the engine failed to start';
			return;
		}
		if (this.suspended) return;
		this.engineReady = true;
		if (this.status === 'playing' && !this.isPlayersTurn) this.engineReply();
	}

	handleBoardMove(orig: Key, dest: Key, promotion?: string): void {
		if (!this.userCanMove) return;
		const played = this.game.tryMove(orig, dest, promotion);
		if (!played) {
			soundPrefs.play('illegal');
			return;
		}
		this.playerMoves += 1;
		this.afterMove(played, true);
	}

	private afterMove(played: PlayedMove, byPlayer: boolean): void {
		soundPrefs.move(played.san, !byPlayer);

		const verdict = judgeDrill(new Chess(this.game.fen), {
			goal: this.goal,
			playerColor: this.playerColor,
			lastMove: { uci: played.uci, byPlayer },
			playerMoves: this.playerMoves
		});
		if (verdict.done) {
			this.finish(verdict.success, verdict.outcome);
			return;
		}
		if (!this.isPlayersTurn) this.engineReply();
	}

	private engineReply(): void {
		this.engineThinking = true;
		this.engineError = null;
		const generation = this.generation;
		this.inChain(async () => {
			try {
				if (this.status !== 'playing' || this.isPlayersTurn) return;
				let reply: EngineEval | null = null;
				for (let attempt = 0; attempt < ENGINE_REPLY_ATTEMPTS; attempt++) {
					try {
						reply = await stockfish.play(this.game.fen, DRILL_SKILL);
						break;
					} catch (error) {
						if (generation !== this.generation) return; // reloaded mid-retry
						if (attempt === ENGINE_REPLY_ATTEMPTS - 1) {
							this.engineError =
								error instanceof Error ? error.message : 'the engine stopped responding';
							return;
						}
					}
				}
				if (!reply || generation !== this.generation || this.suspended) return;
				if (this.status !== 'playing' || this.isPlayersTurn) return;
				const played = this.game.applyUci(reply.bestMove);
				if (played) this.afterMove(played, false);
			} finally {
				this.engineThinking = false;
			}
		});
	}

	/** Manual recovery after `engineError`, on a fresh worker. */
	retryEngineMove(): void {
		if (this.status !== 'playing' || this.isPlayersTurn) return;
		this.engineError = null;
		this.engineReply();
	}

	private finish(success: boolean, outcome: DrillOutcome): void {
		this.status = success ? 'won' : 'lost';
		this.outcome = outcome;
		this.completedCount += 1;
		soundPrefs.play('game-end');
		if (this.attemptRecorded || !this.drill) return;
		this.attemptRecorded = true;
		recordDrillAttempt(this.drill.id, success, this.playerMoves, outcome).catch((e) =>
			console.error('recording drill attempt failed:', e)
		);
	}

	/** Called when the page unmounts: in-flight engine work may outlive it,
	 * but it must not apply to whatever the next mount loads. */
	suspend(): void {
		this.suspended = true;
		this.generation += 1;
	}
}
