import { ApiError, completeGame, discardGame, getGame, postMove, startGame } from '$lib/api/client';
import { classifyMove, clampEval, EVAL_CLAMP_CP, type Classification } from '$lib/classification';
import { loadOpenings, openingForFens, openingsReady } from '$lib/openings';
import { GameStore, type PlayedMove } from './game.svelte';
import { soundPrefs } from './soundPrefs.svelte';
import { clearActiveGame, loadActiveGame, saveActiveGame } from './gamePersistence';
import { stockfish, type EngineEval, type EngineLine } from './stockfish';
import { usernamePrefs } from './username.svelte';
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
/** Attempts to get the engine's reply before giving up (the first failure
 * tears down and re-inits the worker, so a retry runs on a fresh engine). */
const ENGINE_REPLY_ATTEMPTS = 2;

function normalizeEval(result: EngineEval): number {
	if (result.mate !== undefined) return result.mate > 0 ? EVAL_CLAMP_CP : -EVAL_CLAMP_CP;
	return clampEval(result.cp ?? 0);
}

/** Orchestrates one live game: board state, engine opponent, live move
 * classification, and fire-and-forget sync to the server. Engine searches
 * and eval bookkeeping are serialized through `chain` (one WASM engine, and
 * each move's eval is the next move's baseline); server calls go through the
 * separate `sync` chain so a slow network never delays the engine.
 *
 * The active game is persisted to localStorage after every state change, so
 * a refresh or in-app navigation restores it (constructor). Resigning or
 * starting a new game ends persistence. */
export class PlaySession {
	game = new GameStore();

	// per-game settings, locked once the first move is played
	engineSkill = $state(5);
	readonly playerColor = 'white' as const; // vs engine; color choice is post-v1

	engineReady = $state(false);
	engineThinking = $state(false);
	/** Set when the engine failed to produce its move after retries — the game
	 * is paused on the engine's turn until `retryEngineMove()` is invoked. */
	engineError = $state<string | null>(null);

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
	/** False after a resignation: the finished game must not be re-saved by
	 * late eval/sync work. New game turns persistence back on. */
	private persistable = true;
	/** Set on unmount: kills queued and future jobs (generation only covers
	 * jobs whose capture happened before the suspend). */
	private suspended = false;

	constructor() {
		const saved = loadActiveGame();
		if (!saved) return;
		if (!this.game.loadMoves(saved.moves)) {
			clearActiveGame(); // storage didn't replay to a legal game — start fresh
			return;
		}
		this.engineSkill = saved.engineSkill;
		this.evals = saved.evals;
		this.badges = saved.badges;
		this.lastFeedback = saved.lastFeedback;
		this.currentEval = saved.currentEval;
		// currentEval is the eval after the last evaluated ply — the right
		// baseline until start() re-evaluates the position at full depth
		this.baselineEval = saved.currentEval ?? 0;
		this.serverGameId = saved.serverGameId;
		this.completedGameId = saved.completedGameId;
		// queue the server resync before any user input can queue a postMove,
		// so replayed moves and new moves can never arrive out of order
		this.resyncServer(saved.moves);
	}

	/** Queue a job behind all prior engine/eval work; stale jobs from a
	 * previous game (before a reset) are dropped via the generation guard. */
	private inChain(job: () => Promise<void>): void {
		const generation = this.generation;
		this.chain = this.chain
			.then(() => (generation === this.generation && !this.suspended ? job() : undefined))
			.catch((error) => console.error('engine chain:', error));
	}

	private inSync(job: () => Promise<void>): void {
		const generation = this.generation;
		this.sync = this.sync
			.then(() => {
				if (generation !== this.generation || this.suspended || this.serverError) return;
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

	private save(): void {
		if (!this.persistable || !this.started) return;
		saveActiveGame({
			engineSkill: this.engineSkill,
			moves: this.game.moves.map((move) => move.uci),
			evals: [...this.evals],
			badges: [...this.badges],
			lastFeedback: this.lastFeedback,
			currentEval: this.currentEval,
			serverGameId: this.serverGameId,
			completedGameId: this.completedGameId
		});
	}

	/** After a restore, bring the server record back in step with the local
	 * game: moves posted right before the refresh may never have landed, the
	 * record may never have been created, or a finished game may never have
	 * been completed. `moves` is the restored list — moves played afterwards
	 * queue their own postMove jobs behind this one, so nothing double-posts. */
	private resyncServer(moves: string[]): void {
		if (this.completedGameId !== null) return;
		const generation = this.generation;
		this.inSync(async () => {
			let synced = 0;
			if (this.serverGameId !== null) {
				try {
					synced = (await getGame(this.serverGameId)).moves.length;
				} catch (error) {
					if (!(error instanceof ApiError && error.status === 404)) throw error;
					this.serverGameId = null; // record is gone — recreate it below
				}
				if (generation !== this.generation) return;
			}
			if (this.serverGameId === null) {
				const id = (await startGame('engine', usernamePrefs.name ?? undefined)).id;
				if (generation !== this.generation) {
					discardGame(id).catch(() => {});
					return;
				}
				this.serverGameId = id;
				synced = 0;
			}
			for (const uci of moves.slice(synced)) {
				await postMove(this.serverGameId, uci);
			}
			if (generation !== this.generation) return;
			this.save();
			if (this.game.isGameOver && this.completedGameId === null) {
				try {
					await completeGame(this.serverGameId, this.game.result);
				} catch (error) {
					// 409: completed right before the refresh — same review id
					if (!(error instanceof ApiError && error.status === 409)) throw error;
				}
				if (generation !== this.generation) return;
				this.completedGameId = this.serverGameId;
				this.save();
			}
		});
	}

	/** Warm the engine and establish the baseline eval — the starting position
	 * for a fresh session, the current position for a restored one. */
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
		if (this.suspended) return; // page left during warmup — session is dead
		if (this.started) {
			await this.rebaselineRestored();
			if (this.suspended) return;
		}
		if (this.started) {
			// still the restored game (no "New game" raced in during the eval)
			this.engineReady = true;
			if (!this.game.isGameOver && this.game.turnColor !== this.playerColor) {
				// the refresh landed after the user's move but before the reply
				this.engineReply();
			}
			return;
		}
		this.initialEval = await stockfish.evaluate(START_FEN, LIVE_EVAL_DEPTH, IDEAS_MULTIPV);
		this.baselineEval = normalizeEval(this.initialEval);
		this.pendingBestMove = this.initialEval.bestMove;
		this.seedFromInitial();
		this.engineReady = true;
		soundPrefs.play('game-start');
	}

	/** Restored session: evaluate the position where the game left off. The
	 * fen guard drops the result if a move raced in during the search. */
	private async rebaselineRestored(): Promise<void> {
		if (this.game.isGameOver) return;
		const fen = this.game.fen;
		const userToMove = this.game.turnColor === this.playerColor;
		const result = await stockfish.evaluate(fen, LIVE_EVAL_DEPTH, userToMove ? IDEAS_MULTIPV : 1);
		if (this.game.fen !== fen) return;
		this.baselineEval = normalizeEval(result);
		this.pendingBestMove = result.bestMove;
		this.insightEval = { cp: result.cp, mate: result.mate, depth: result.depth };
		if (userToMove) this.ideas = { fen, lines: result.lines };
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
		else soundPrefs.play('illegal');
	}

	private afterMove(played: PlayedMove, byEngine: boolean): void {
		soundPrefs.move(played.san, byEngine);
		this.refreshOpening();
		this.save();

		const generation = this.generation;
		this.inSync(async () => {
			if (this.serverGameId === null) {
				const id = (await startGame('engine', usernamePrefs.name ?? undefined)).id;
				if (generation !== this.generation) {
					// session was reset while the game was being created —
					// the fresh record belongs to an abandoned game; discard it
					discardGame(id).catch(() => {});
					return;
				}
				this.serverGameId = id;
				this.save();
			}
			await postMove(this.serverGameId, played.uci);
		});

		this.inChain(() => this.evaluatePly(played, !byEngine));

		if (this.game.isGameOver) {
			soundPrefs.play('game-end');
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
		this.save();
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
		this.engineError = null;
		const generation = this.generation;
		this.inChain(async () => {
			try {
				// A hung search rejects and self-heals the engine (see stockfish.ts),
				// so a retry runs on a fresh worker. Without this, a single lost
				// `bestmove` would leave the game stuck on the engine's turn — the
				// user can't move, so the board would freeze silently.
				let reply: EngineEval | null = null;
				for (let attempt = 0; attempt < ENGINE_REPLY_ATTEMPTS; attempt++) {
					try {
						reply = await stockfish.play(this.game.fen, this.engineSkill);
						break;
					} catch (error) {
						if (generation !== this.generation) return; // reset/suspended mid-retry
						if (attempt === ENGINE_REPLY_ATTEMPTS - 1) {
							this.engineError =
								error instanceof Error ? error.message : 'the engine stopped responding';
							return;
						}
					}
				}
				// the session may have been reset or suspended mid-search — the
				// reply must not apply (and then sync) under the new generation
				if (!reply || generation !== this.generation) return;
				const played = this.game.applyUci(reply.bestMove);
				if (played) this.afterMove(played, true);
			} finally {
				this.engineThinking = false;
			}
		});
	}

	/** Manual recovery after `engineError`: retry the engine's move on a fresh
	 * worker. No-op unless it's genuinely the engine's turn. */
	retryEngineMove(): void {
		if (!this.started || this.game.isGameOver) return;
		if (this.game.turnColor === this.playerColor) return;
		this.engineError = null;
		this.engineReply();
	}

	/** Every finished game is completed server-side automatically — that is
	 * what queues the analysis job (no user action required). */
	private finish(): void {
		const result = this.game.result;
		this.inSync(async () => {
			// completedGameId set: a restore resync already completed the game
			if (this.serverGameId === null || this.completedGameId !== null) return;
			await completeGame(this.serverGameId, result);
			this.completedGameId = this.serverGameId;
			this.save();
		});
	}

	resign(): void {
		if (!this.started || this.game.isGameOver) return;
		this.game.resign(this.playerColor);
		soundPrefs.play('game-end');
		this.finish();
		// resignation ends persistence — a refresh now starts a fresh board
		clearActiveGame();
		this.persistable = false;
	}

	/** Called when the play screen unmounts. In-flight engine/network work may
	 * outlive the page, but a suspended session must never touch storage or
	 * the server again — the next mount's session owns them from here. */
	suspend(): void {
		this.suspended = true;
		this.generation += 1;
		this.persistable = false;
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
		this.engineError = null;
		this.opening = null;
		this.insightEval = null;
		this.ideas = null;
		clearActiveGame();
		this.persistable = true;
		soundPrefs.play('game-start');
		if (this.initialEval) {
			this.baselineEval = normalizeEval(this.initialEval);
			this.pendingBestMove = this.initialEval.bestMove;
			this.seedFromInitial();
		} else if (this.engineReady) {
			// restored session: the start-position eval was never computed —
			// queued ahead of any move evals, so the first badge's baseline is
			// right even if the user moves immediately
			this.inChain(async () => {
				this.initialEval = await stockfish.evaluate(START_FEN, LIVE_EVAL_DEPTH, IDEAS_MULTIPV);
				this.baselineEval = normalizeEval(this.initialEval);
				this.pendingBestMove = this.initialEval.bestMove;
				if (this.game.moves.length === 0) this.seedFromInitial();
			});
		}
		// engine not ready: start() is still warming up and will now take the
		// fresh-session path, seeding the start position itself
	}
}
