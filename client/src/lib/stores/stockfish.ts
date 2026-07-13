/** UCI-over-postMessage wrapper around stockfish.wasm running in a Web Worker.
 *
 * Picks the multi-threaded lite build when the page is cross-origin isolated
 * (COOP/COEP headers set → SharedArrayBuffer available), otherwise falls back
 * to the single-threaded build. Check `stockfish.flavor` to see which one
 * actually loaded — a silent single-threaded fallback is the failure mode the
 * implementation plan warns about.
 *
 * There is one engine process, so requests are serialized through a promise
 * queue: evaluate() (full strength, used for classification) and play()
 * (skill-limited, the engine opponent) can be issued freely and run in order.
 */

/** One candidate line from a (possibly MultiPV) search, scores white-POV. */
export interface EngineLine {
	cp?: number;
	mate?: number;
	depth: number;
	pvUci: string[];
}

export interface EngineEval {
	/** Centipawns from white's perspective (undefined when a mate was found). */
	cp?: number;
	/** Moves to mate, signed from white's perspective. */
	mate?: number;
	bestMove: string;
	depth: number;
	/** Wall-clock time for the search, ms. */
	ms: number;
	/** Candidate lines, best first; lines[0] matches bestMove. */
	lines: EngineLine[];
}

interface SearchOptions {
	depth?: number;
	movetimeMs?: number;
	/** Stockfish "Skill Level" (0-20). 20 = full strength. */
	skill: number;
	/** Number of candidate lines to search (UCI MultiPV). */
	multiPv?: number;
}

const FULL_STRENGTH = 20;

class StockfishClient {
	private worker: Worker | null = null;
	private initPromise: Promise<void> | null = null;
	private queue: Promise<unknown> = Promise.resolve();
	private currentSkill = FULL_STRENGTH;
	private currentMultiPv = 1;

	flavor: 'multi-threaded' | 'single-threaded' | null = null;

	private init(): Promise<void> {
		this.initPromise ??= new Promise((resolve, reject) => {
			const isolated = typeof SharedArrayBuffer !== 'undefined' && crossOriginIsolated;
			this.flavor = isolated ? 'multi-threaded' : 'single-threaded';
			const script = isolated
				? '/stockfish/stockfish-18-lite.js'
				: '/stockfish/stockfish-18-lite-single.js';

			const worker = new Worker(script);
			worker.onerror = (e) => reject(new Error(`stockfish worker failed: ${e.message}`));
			worker.onmessage = (e: MessageEvent<string>) => {
				if (e.data === 'uciok') {
					if (isolated) {
						const threads = Math.min(4, Math.max(1, navigator.hardwareConcurrency - 1));
						worker.postMessage(`setoption name Threads value ${threads}`);
					}
					this.worker = worker;
					resolve();
				}
			};
			worker.postMessage('uci');
		});
		return this.initPromise;
	}

	/** Compile the WASM and load the network up front so the first real
	 * search doesn't pay the init cost (live badges must land in 500ms). */
	warmup(): Promise<void> {
		return this.init();
	}

	private enqueue<T>(job: () => Promise<T>): Promise<T> {
		const run = this.queue.then(job, job);
		this.queue = run.catch(() => {});
		return run;
	}

	/** Full-strength eval of a FEN — feeds move classification, and (with
	 * multiPv > 1) the insight bar's candidate-move ideas. */
	evaluate(fen: string, depth = 16, multiPv = 1): Promise<EngineEval> {
		return this.enqueue(() => this.search(fen, { depth, skill: FULL_STRENGTH, multiPv }));
	}

	/** The engine opponent: skill-limited, time-boxed pick of a move. */
	play(fen: string, skill: number, movetimeMs = 400): Promise<EngineEval> {
		return this.enqueue(() => this.search(fen, { movetimeMs, skill }));
	}

	private async search(fen: string, options: SearchOptions): Promise<EngineEval> {
		await this.init();
		const worker = this.worker!;

		if (options.skill !== this.currentSkill) {
			worker.postMessage(`setoption name Skill Level value ${options.skill}`);
			this.currentSkill = options.skill;
		}

		// MultiPV is sticky on the engine process — reset to 1 for play() so the
		// skill-limited opponent never pays the multi-line search cost.
		const multiPv = options.multiPv ?? 1;
		if (multiPv !== this.currentMultiPv) {
			worker.postMessage(`setoption name MultiPV value ${multiPv}`);
			this.currentMultiPv = multiPv;
		}

		const whiteToMove = fen.split(' ')[1] !== 'b';
		const start = performance.now();

		return new Promise<EngineEval>((resolve) => {
			let lastCp: number | undefined;
			let lastMate: number | undefined;
			let lastDepth = 0;
			const lines: EngineLine[] = [];

			worker.onmessage = (e: MessageEvent<string>) => {
				const line = e.data;
				if (line.startsWith('info ') && line.includes(' score ')) {
					const depthMatch = line.match(/\bdepth (\d+)/);
					const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
					if (depthMatch && scoreMatch) {
						const depth = Number(depthMatch[1]);
						// UCI scores are from the side to move; normalize to white's view.
						const sign = whiteToMove ? 1 : -1;
						const cp = scoreMatch[1] === 'cp' ? sign * Number(scoreMatch[2]) : undefined;
						const mate = scoreMatch[1] === 'mate' ? sign * Number(scoreMatch[2]) : undefined;

						// the primary line (multipv 1 or no multipv token) drives the eval
						const rank = Number(line.match(/\bmultipv (\d+)/)?.[1] ?? 1);
						if (rank === 1) {
							lastDepth = depth;
							lastCp = cp;
							lastMate = mate;
						}
						const pvMatch = line.match(/\bpv (.+)$/);
						if (pvMatch) {
							lines[rank - 1] = { cp, mate, depth, pvUci: pvMatch[1].split(' ') };
						}
					}
				} else if (line.startsWith('bestmove ')) {
					resolve({
						cp: lastCp,
						mate: lastMate,
						bestMove: line.split(' ')[1],
						depth: lastDepth,
						ms: Math.round(performance.now() - start),
						lines
					});
				}
			};

			worker.postMessage(`position fen ${fen}`);
			worker.postMessage(
				options.movetimeMs ? `go movetime ${options.movetimeMs}` : `go depth ${options.depth}`
			);
		});
	}
}

export const stockfish = new StockfishClient();
