import { completeGame, postMove, startGame } from '$lib/api/client';
import { classifyMove, clampEval, EVAL_CLAMP_CP, type Classification } from '$lib/classification';
import { GameStore, type PlayedMove } from './game.svelte';
import { stockfish, type EngineEval } from './stockfish';
import type { Key } from 'chessground/types';

export type HintSetting = 'off' | 'nudge';

export interface MoveFeedback {
	ply: number;
	san: string;
	classification: Classification;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** Depth for live classification evals — matches the "depth ~16 minimum"
 * acceptance criterion; server batch analysis re-does this deeper. */
const LIVE_EVAL_DEPTH = 16;

function normalizeEval(result: EngineEval): number {
	if (result.mate !== undefined) return result.mate > 0 ? EVAL_CLAMP_CP : -EVAL_CLAMP_CP;
	return clampEval(result.cp ?? 0);
}

/** Orchestrates one live game: board state, engine opponent, live move
 * classification, and fire-and-forget sync to the server. Engine searches
 * and eval bookkeeping are serialized through `chain` (one WASM engine, and
 * each move's eval is the next move's baseline); server calls go through the
 * separate `sync` chain so a slow network never delays the engine. */
export class PlaySession {
	game = new GameStore();

	// per-game settings, locked once the first move is played
	engineSkill = $state(5);
	hints = $state<HintSetting>('nudge');
	readonly playerColor = 'white' as const; // vs engine; color choice is post-v1

	showEvalBar = $state(false);
	nudgeVisible = $state(true);

	engineReady = $state(false);
	engineThinking = $state(false);

	/** Eval (cp, white POV, clamped) after each ply; index = ply - 1. */
	evals = $state<(number | null)[]>([]);
	badges = $state<(Classification | null)[]>([]);
	lastFeedback = $state<MoveFeedback | null>(null);
	currentEval = $state<number | null>(null);

	serverGameId = $state<number | null>(null);
	serverError = $state<string | null>(null);
	/** Set when the finished game has been completed server-side and its
	 * analysis job is queued — the review link becomes meaningful. */
	completedGameId = $state<number | null>(null);

	get started(): boolean {
		return this.game.moves.length > 0;
	}

	private baselineEval = 0;
	private pendingBestMove: string | null = null;
	private initialEval: { cp: number; bestMove: string } | null = null;
	private chain: Promise<void> = Promise.resolve();
	private sync: Promise<void> = Promise.resolve();
	private generation = 0;

	/** Queue a job behind all prior engine/eval work; stale jobs from a
	 * previous game (before a reset) are dropped via the generation guard. */
	private inChain(job: () => Promise<void>): void {
		const generation = this.generation;
		this.chain = this.chain
			.then(() => (generation === this.generation ? job() : undefined))
			.catch((error) => console.error('engine chain:', error));
	}

	private inSync(job: () => Promise<void>): void {
		const generation = this.generation;
		this.sync = this.sync
			.then(() => {
				if (generation !== this.generation || this.serverError) return;
				return job();
			})
			.catch((error) => {
				// fail soft: the game continues locally, server sync stops
				this.serverError = error instanceof Error ? error.message : String(error);
			});
	}

	/** Warm the engine and establish the starting-position baseline. */
	async start(): Promise<void> {
		await stockfish.warmup();
		const result = await stockfish.evaluate(START_FEN, LIVE_EVAL_DEPTH);
		this.initialEval = { cp: normalizeEval(result), bestMove: result.bestMove };
		this.baselineEval = this.initialEval.cp;
		this.pendingBestMove = this.initialEval.bestMove;
		this.engineReady = true;
	}

	get userCanMove(): boolean {
		if (this.game.isGameOver) return false;
		return this.game.turnColor === this.playerColor;
	}

	handleBoardMove(orig: Key, dest: Key): void {
		if (!this.userCanMove) return;
		const played = this.game.tryMove(orig, dest);
		if (played) this.afterMove(played, false);
	}

	private afterMove(played: PlayedMove, byEngine: boolean): void {
		// Level 0 nudge: re-shown after every opponent (engine) move.
		if (this.hints !== 'off' && byEngine) {
			this.nudgeVisible = true;
		}

		this.inSync(async () => {
			if (this.serverGameId === null) {
				this.serverGameId = (await startGame('engine')).id;
			}
			await postMove(this.serverGameId, played.uci);
		});

		this.inChain(() => this.evaluatePly(played, !byEngine));

		if (this.game.isGameOver) {
			this.finish();
		} else if (this.game.turnColor !== this.playerColor) {
			this.engineReply();
		}
	}

	/** Runs inside `chain`: eval after this ply becomes the next baseline;
	 * classification compares it to the baseline captured at execution time. */
	private async evaluatePly(played: PlayedMove, badge: boolean): Promise<void> {
		const evalBefore = this.baselineEval;
		const bestBefore = this.pendingBestMove;

		let evalAfter: number;
		if (this.game.boardGameOver) {
			// terminal positions aren't searchable — same rule as the server
			const result = this.game.result;
			evalAfter = result === '1-0' ? EVAL_CLAMP_CP : result === '0-1' ? -EVAL_CLAMP_CP : 0;
			this.pendingBestMove = null;
		} else {
			const result = await stockfish.evaluate(played.fenAfter, LIVE_EVAL_DEPTH);
			evalAfter = normalizeEval(result);
			this.pendingBestMove = result.bestMove;
		}

		this.baselineEval = evalAfter;
		this.evals[played.ply - 1] = evalAfter;
		this.currentEval = evalAfter;

		if (badge) {
			const moverIsWhite = played.fenBefore.split(' ')[1] !== 'b';
			const classification = classifyMove(
				evalBefore,
				evalAfter,
				moverIsWhite,
				played.uci === bestBefore
			);
			this.badges[played.ply - 1] = classification;
			this.lastFeedback = { ply: played.ply, san: played.san, classification };
		}
	}

	private engineReply(): void {
		this.engineThinking = true;
		this.inChain(async () => {
			try {
				const reply = await stockfish.play(this.game.fen, this.engineSkill);
				const played = this.game.applyUci(reply.bestMove);
				if (played) this.afterMove(played, true);
			} finally {
				this.engineThinking = false;
			}
		});
	}

	/** Every finished game is completed server-side automatically — that is
	 * what queues the analysis job (no user action required). */
	private finish(): void {
		const result = this.game.result;
		this.inSync(async () => {
			if (this.serverGameId === null) return;
			await completeGame(this.serverGameId, result);
			this.completedGameId = this.serverGameId;
		});
	}

	resign(): void {
		if (!this.started || this.game.isGameOver) return;
		this.game.resign(this.playerColor);
		this.finish();
	}

	newGame(): void {
		this.generation += 1;
		this.game.reset();
		this.evals = [];
		this.badges = [];
		this.lastFeedback = null;
		this.currentEval = null;
		this.serverGameId = null;
		this.serverError = null;
		this.completedGameId = null;
		this.engineThinking = false;
		this.nudgeVisible = true;
		if (this.initialEval) {
			this.baselineEval = this.initialEval.cp;
			this.pendingBestMove = this.initialEval.bestMove;
		}
	}
}
