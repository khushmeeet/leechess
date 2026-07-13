import { completeGame, discardGame, postMove, startGame } from '$lib/api/client';
import { classifyMove, clampEval, EVAL_CLAMP_CP, type Classification } from '$lib/classification';
import { loadOpenings, openingForFens, openingsReady } from '$lib/openings';
import { GameStore, type PlayedMove } from './game.svelte';
import { stockfish, type EngineEval, type EngineLine } from './stockfish';
import type { Key } from 'chessground/types';

export interface MoveFeedback {
	ply: number;
	san: string;
	classification: Classification;
}

export interface OpeningState {
	eco: string;
	family: string;
	variation: string | null;
	/** The current position itself is in the book (vs the closest line so far). */
	inBook: boolean;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** Depth for live classification evals — matches the "depth ~16 minimum"
 * acceptance criterion; server batch analysis re-does this deeper. */
const LIVE_EVAL_DEPTH = 16;
/** Candidate lines for the insight bar's Ideas row. */
const IDEAS_MULTIPV = 3;

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
	readonly playerColor = 'white' as const; // vs engine; color choice is post-v1

	engineReady = $state(false);
	engineThinking = $state(false);

	/** Deepest opening-book match along the game so far. */
	opening = $state<OpeningState | null>(null);
	openingsLoaded = $state(false);
	openingsFailed = $state(false);
	/** Raw eval readout for the insight bar (mate-aware, with depth). */
	insightEval = $state<{ cp?: number; mate?: number; depth: number } | null>(null);
	/** Candidate lines for the position in `fen` — user-to-move positions only;
	 * consumers must check `fen` against the live board to drop stale ones. */
	ideas = $state<{ fen: string; lines: EngineLine[] } | null>(null);

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
	private initialEval: EngineEval | null = null;
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
				// (unless the session was reset — a late failure from a
				// discarded game must not surface in the fresh one)
				if (generation !== this.generation) return;
				this.serverError = error instanceof Error ? error.message : String(error);
			});
	}

	/** Warm the engine and establish the starting-position baseline. */
	async start(): Promise<void> {
		// opening book loads in parallel — never blocks the engine or the board
		loadOpenings().then((ok) => {
			if (ok) {
				this.openingsLoaded = true;
				this.refreshOpening();
			} else {
				this.openingsFailed = true;
			}
		});
		await stockfish.warmup();
		this.initialEval = await stockfish.evaluate(START_FEN, LIVE_EVAL_DEPTH, IDEAS_MULTIPV);
		this.baselineEval = normalizeEval(this.initialEval);
		this.pendingBestMove = this.initialEval.bestMove;
		this.seedFromInitial();
		this.engineReady = true;
	}

	private seedFromInitial(): void {
		if (!this.initialEval) return;
		const { cp, mate, depth, lines } = this.initialEval;
		this.insightEval = { cp, mate, depth };
		this.ideas = { fen: START_FEN, lines };
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
		this.refreshOpening();

		const generation = this.generation;
		this.inSync(async () => {
			if (this.serverGameId === null) {
				const id = (await startGame('engine')).id;
				if (generation !== this.generation) {
					// session was reset while the game was being created —
					// the fresh record belongs to an abandoned game; discard it
					discardGame(id).catch(() => {});
					return;
				}
				this.serverGameId = id;
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
			this.insightEval = null;
			this.ideas = null;
		} else {
			// badge evals stay single-PV so feedback lands inside the 500ms
			// budget; engine-reply evals (user to move next) also fetch the
			// candidate lines the insight bar's Ideas row shows.
			const multiPv = badge ? 1 : IDEAS_MULTIPV;
			const result = await stockfish.evaluate(played.fenAfter, LIVE_EVAL_DEPTH, multiPv);
			evalAfter = normalizeEval(result);
			this.pendingBestMove = result.bestMove;
			this.insightEval = { cp: result.cp, mate: result.mate, depth: result.depth };
			if (!badge) this.ideas = { fen: played.fenAfter, lines: result.lines };
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

	/** Track the deepest book line reached along the game so far. */
	private refreshOpening(): void {
		if (!openingsReady()) return;
		const line = openingForFens(this.game.moves.map((move) => move.fenAfter));
		this.opening = line
			? {
					eco: line.eco,
					family: line.family,
					variation: line.variation,
					inBook: line.deepestPly === this.game.moves.length
				}
			: null;
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

	/** An unfinished game is never kept for review — delete its server
	 * record. Fire-and-forget: a racing postMove that 404s afterwards is
	 * harmless (the sync chain's generation guard swallows it). */
	discardUnfinished(): void {
		if (this.serverGameId === null || this.game.isGameOver) return;
		const abandoned = this.serverGameId;
		this.serverGameId = null;
		discardGame(abandoned).catch(() => {});
	}

	newGame(): void {
		this.discardUnfinished();
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
		this.opening = null;
		this.insightEval = null;
		this.ideas = null;
		if (this.initialEval) {
			this.baselineEval = normalizeEval(this.initialEval);
			this.pendingBestMove = this.initialEval.bestMove;
			this.seedFromInitial();
		}
	}
}
