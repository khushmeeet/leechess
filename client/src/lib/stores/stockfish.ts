/** UCI-over-postMessage wrapper around stockfish.wasm running in a Web Worker.
 *
 * Picks the multi-threaded lite build when the page is cross-origin isolated
 * (COOP/COEP headers set → SharedArrayBuffer available), otherwise falls back
 * to the single-threaded build. Check `stockfish.flavor` to see which one
 * actually loaded — a silent single-threaded fallback is the failure mode the
 * implementation plan warns about.
 */

export interface EngineEval {
	/** Centipawns from white's perspective (undefined when a mate was found). */
	cp?: number;
	/** Moves to mate, signed from white's perspective. */
	mate?: number;
	bestMove: string;
	depth: number;
	/** Wall-clock time for the search, ms. */
	ms: number;
}

class StockfishClient {
	private worker: Worker | null = null;
	private initPromise: Promise<void> | null = null;
	private busy = false;

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

	/** Evaluate a FEN at the given depth. Rejects if a search is already running. */
	async evaluate(fen: string, depth = 16): Promise<EngineEval> {
		await this.init();
		const worker = this.worker!;
		if (this.busy) throw new Error('engine is busy');
		this.busy = true;

		const whiteToMove = fen.split(' ')[1] !== 'b';
		const start = performance.now();

		return new Promise<EngineEval>((resolve) => {
			let lastCp: number | undefined;
			let lastMate: number | undefined;
			let lastDepth = 0;

			worker.onmessage = (e: MessageEvent<string>) => {
				const line = e.data;
				if (line.startsWith('info ') && line.includes(' score ')) {
					const depthMatch = line.match(/\bdepth (\d+)/);
					const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
					if (depthMatch && scoreMatch) {
						lastDepth = Number(depthMatch[1]);
						// UCI scores are from the side to move; normalize to white's view.
						const sign = whiteToMove ? 1 : -1;
						if (scoreMatch[1] === 'cp') {
							lastCp = sign * Number(scoreMatch[2]);
							lastMate = undefined;
						} else {
							lastMate = sign * Number(scoreMatch[2]);
							lastCp = undefined;
						}
					}
				} else if (line.startsWith('bestmove ')) {
					this.busy = false;
					resolve({
						cp: lastCp,
						mate: lastMate,
						bestMove: line.split(' ')[1],
						depth: lastDepth,
						ms: Math.round(performance.now() - start)
					});
				}
			};

			worker.postMessage('ucinewgame');
			worker.postMessage(`position fen ${fen}`);
			worker.postMessage(`go depth ${depth}`);
		});
	}
}

export const stockfish = new StockfishClient();
