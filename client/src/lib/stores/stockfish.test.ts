import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StockfishClient } from './stockfish';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// Same position with Black to move — UCI scores come from the side to move, so
// this is the only way to see the white-POV normalization happen.
const BLACK_TO_MOVE_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
// Well past any real init (20s) or depth-search (15s) ceiling in stockfish.ts;
// init resolves via `uciok` first, so its timer is cleared and only the search
// timeout can fire within this window.
const PAST_ANY_TIMEOUT_MS = 30000;

/** Stand-in for the stockfish Web Worker. Boots (`uci` → `uciok`) by default;
 * how it answers a `go` search is configured per instance so a test can make
 * it respond, hang, or crash. */
class MockWorker {
	constructor(readonly script: string) {}
	onmessage: ((e: { data: string }) => void) | null = null;
	onerror: ((e: { message: string }) => void) | null = null;
	posted: string[] = [];
	terminated = false;
	emitUciok = true;
	onGo: ((w: MockWorker) => void) | null = null;

	postMessage(msg: string): void {
		this.posted.push(msg);
		if (msg === 'uci') {
			if (this.emitUciok) queueMicrotask(() => this.onmessage?.({ data: 'uciok' }));
		} else if (msg.startsWith('go ')) {
			this.onGo?.(this);
		}
	}
	terminate(): void {
		this.terminated = true;
	}
	send(data: string): void {
		this.onmessage?.({ data });
	}
	raiseError(message: string): void {
		this.onerror?.({ message });
	}
}

/** A healthy search: one info line then bestmove, emitted asynchronously. */
function respondNormally(w: MockWorker): void {
	queueMicrotask(() => {
		w.send('info depth 16 score cp 30 multipv 1 pv e2e4 e7e5');
		w.send('bestmove e2e4');
	});
}

let createdWorkers: MockWorker[];
let configureNextWorker: (w: MockWorker) => void;

beforeEach(() => {
	vi.useFakeTimers();
	createdWorkers = [];
	configureNextWorker = (w) => {
		w.onGo = respondNormally;
	};
	vi.stubGlobal(
		'Worker',
		class {
			constructor(script: string) {
				const w = new MockWorker(script);
				createdWorkers.push(w);
				configureNextWorker(w);
				return w as unknown as Worker;
			}
		}
	);
	// Default to the single-threaded boot path; the isolated path has its own
	// describe block below, since production picks it whenever COOP/COEP are
	// in effect — which is everywhere the app actually runs.
	vi.stubGlobal('crossOriginIsolated', false);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('StockfishClient', () => {
	it('parses info/bestmove into an EngineEval on a normal search', async () => {
		const client = new StockfishClient();
		const result = await client.evaluate(START_FEN, 16, 1);
		expect(result.bestMove).toBe('e2e4');
		expect(result.cp).toBe(30); // white to move → score kept as-is
		expect(result.depth).toBe(16);
		expect(result.lines[0].pvUci).toEqual(['e2e4', 'e7e5']);
	});

	it('rejects (instead of hanging) when bestmove never arrives', async () => {
		configureNextWorker = (w) => {
			w.onGo = null; // boots fine, but the search never answers
		};
		const client = new StockfishClient();
		const search = client.evaluate(START_FEN, 16);
		const rejected = expect(search).rejects.toThrow(/timed out/); // attach handler now
		await vi.advanceTimersByTimeAsync(PAST_ANY_TIMEOUT_MS);
		await rejected;
		expect(createdWorkers[0].terminated).toBe(true); // hung worker torn down
	});

	it('rejects when the worker errors during a search', async () => {
		configureNextWorker = (w) => {
			w.onGo = (self) => queueMicrotask(() => self.raiseError('wasm trap'));
		};
		const client = new StockfishClient();
		const search = client.evaluate(START_FEN, 16);
		const rejected = expect(search).rejects.toThrow(/worker error/);
		await vi.advanceTimersByTimeAsync(0);
		await rejected;
	});

	it('recovers on the next search after a timeout by booting a fresh worker', async () => {
		configureNextWorker = (w) => {
			w.onGo = null; // first worker hangs
		};
		const client = new StockfishClient();
		const firstSearch = client.evaluate(START_FEN, 16);
		const firstRejected = expect(firstSearch).rejects.toThrow(/timed out/);
		await vi.advanceTimersByTimeAsync(PAST_ANY_TIMEOUT_MS);
		await firstRejected;

		configureNextWorker = (w) => {
			w.onGo = respondNormally; // recovery worker is healthy
		};
		const result = await client.evaluate(START_FEN, 16, 1);
		expect(result.bestMove).toBe('e2e4');
		expect(createdWorkers.length).toBe(2); // a brand-new worker, not the dead one
		expect(createdWorkers[0].terminated).toBe(true);
	});

	it('normalizes a black-to-move score to white’s perspective', async () => {
		// UCI reports "+50 for the side to move". With Black to move that is
		// -50 for White, and the whole app (eval bar, classification, CPL) reads
		// white-POV. Only exercising white-to-move searches let this flip go
		// unnoticed in either direction.
		configureNextWorker = (w) => {
			w.onGo = (self) =>
				queueMicrotask(() => {
					self.send('info depth 16 score cp 50 multipv 1 pv e7e5 g1f3');
					self.send('bestmove e7e5');
				});
		};
		const client = new StockfishClient();
		const result = await client.evaluate(BLACK_TO_MOVE_FEN, 16, 1);
		expect(result.cp).toBe(-50);
		expect(result.lines[0].cp).toBe(-50);
		expect(result.mate).toBeUndefined();
	});

	it('parses a mate score, signed from white’s perspective', async () => {
		configureNextWorker = (w) => {
			w.onGo = (self) =>
				queueMicrotask(() => {
					self.send('info depth 12 score mate 3 multipv 1 pv d1h5 g7g6');
					self.send('bestmove d1h5');
				});
		};
		const client = new StockfishClient();
		const white = await client.evaluate(START_FEN, 12, 1);
		expect(white.mate).toBe(3);
		expect(white.cp).toBeUndefined();

		// the same "mate in 3 for the side to move", reported with Black to move
		const black = await client.evaluate(BLACK_TO_MOVE_FEN, 12, 1);
		expect(black.mate).toBe(-3);
	});

	it('keeps MultiPV lines in rank order regardless of the order they arrive', async () => {
		// Stockfish interleaves multipv lines across depths; the idea chips read
		// lines[0..2] positionally, so rank — not arrival order — has to decide
		// the slot.
		configureNextWorker = (w) => {
			w.onGo = (self) =>
				queueMicrotask(() => {
					self.send('info depth 14 score cp 5 multipv 3 pv b1c3 e7e5');
					self.send('info depth 14 score cp 20 multipv 2 pv d2d4 d7d5');
					self.send('info depth 14 score cp 31 multipv 1 pv e2e4 e7e5');
					self.send('bestmove e2e4');
				});
		};
		const client = new StockfishClient();
		const result = await client.evaluate(START_FEN, 14, 3);
		expect(result.lines.map((line) => line.pvUci[0])).toEqual(['e2e4', 'd2d4', 'b1c3']);
		expect(result.lines.map((line) => line.cp)).toEqual([31, 20, 5]);
		// the eval itself comes from the primary line, not the last one seen
		expect(result.cp).toBe(31);
		expect(result.bestMove).toBe(result.lines[0].pvUci[0]);
	});

	it('sets skill and MultiPV only when they change', async () => {
		// Both are sticky on the engine process, so play() has to put MultiPV
		// back to 1 or the skill-limited opponent silently pays for a
		// three-line search. Re-sending an unchanged option is pure latency on
		// the 500ms live-badge budget.
		const client = new StockfishClient();
		await client.evaluate(START_FEN, 16, 3);
		await client.evaluate(START_FEN, 16, 3);
		await client.play(START_FEN, 5);
		await client.play(START_FEN, 5);

		const options = createdWorkers[0].posted.filter((msg) => msg.startsWith('setoption'));
		expect(options).toEqual([
			'setoption name MultiPV value 3', // first evaluate: skill is already 20
			'setoption name Skill Level value 5', // first play
			'setoption name MultiPV value 1'
		]);
	});

	it('resets the cached options when a broken worker is replaced', async () => {
		// The cache describes one engine process. After a teardown the next
		// worker boots at Stockfish's defaults (skill 20, MultiPV 1), so a stale
		// cache would skip the setoption the new process needs.
		configureNextWorker = (w) => {
			w.onGo = null; // first worker hangs
		};
		const client = new StockfishClient();
		const hung = client.evaluate(START_FEN, 16, 3);
		const rejected = expect(hung).rejects.toThrow(/timed out/);
		await vi.advanceTimersByTimeAsync(PAST_ANY_TIMEOUT_MS);
		await rejected;

		configureNextWorker = (w) => {
			w.onGo = respondNormally;
		};
		await client.evaluate(START_FEN, 16, 3);
		expect(createdWorkers[1].posted).toContain('setoption name MultiPV value 3');
	});

	it('runs searches one at a time on the single engine process', async () => {
		// One worker, one search: overlapping `position`/`go` pairs would have
		// the second search read the first one's position.
		const goOrder: string[] = [];
		let release: (() => void)[] = [];
		configureNextWorker = (w) => {
			w.onGo = (self) => {
				goOrder.push(self.posted.filter((m) => m.startsWith('position'))!.at(-1)!);
				release.push(() => {
					self.send('info depth 8 score cp 12 multipv 1 pv e2e4');
					self.send('bestmove e2e4');
				});
			};
		};
		const client = new StockfishClient();
		const first = client.evaluate(START_FEN, 8);
		const second = client.evaluate(BLACK_TO_MOVE_FEN, 8);

		await vi.advanceTimersByTimeAsync(0);
		expect(goOrder).toHaveLength(1); // the second search has not started yet
		release.shift()!();
		await first;

		await vi.advanceTimersByTimeAsync(0);
		expect(goOrder).toEqual([`position fen ${START_FEN}`, `position fen ${BLACK_TO_MOVE_FEN}`]);
		release.shift()!();
		await second;
		expect(createdWorkers).toHaveLength(1);
		release = [];
	});

	it('recovers when init itself times out', async () => {
		// A worker that never answers `uci` must not poison initPromise —
		// otherwise every later search re-throws the same boot failure and the
		// engine can never come back.
		configureNextWorker = (w) => {
			w.emitUciok = false;
		};
		const client = new StockfishClient();
		const warm = client.warmup();
		const rejected = expect(warm).rejects.toThrow(/init timed out/);
		await vi.advanceTimersByTimeAsync(PAST_ANY_TIMEOUT_MS);
		await rejected;
		expect(createdWorkers[0].terminated).toBe(true);

		configureNextWorker = (w) => {
			w.onGo = respondNormally;
		};
		const result = await client.evaluate(START_FEN, 16, 1);
		expect(result.bestMove).toBe('e2e4');
		expect(createdWorkers).toHaveLength(2);
	});

	it('boots the single-threaded build when the page is not cross-origin isolated', async () => {
		const client = new StockfishClient();
		await client.warmup();
		expect(createdWorkers[0].script).toBe('/stockfish/stockfish-18-lite-single.js');
		expect(client.flavor).toBe('single-threaded');
		// no SharedArrayBuffer means no threads to configure. (`toContain` on an
		// array compares by identity, so an asymmetric matcher here would pass
		// whatever was posted — hence the explicit filter.)
		expect(createdWorkers[0].posted.filter((msg) => msg.includes('Threads'))).toEqual([]);
	});
});

describe('StockfishClient on a cross-origin-isolated page', () => {
	// This is the path production takes: smoke.e2e.ts asserts
	// crossOriginIsolated === true, so the app always picks the multi-threaded
	// build. Forcing the flag false for every unit test left the branch that
	// chooses the worker — and the Threads option it sends — with no coverage
	// at all, and "silently fell back to single-threaded" is exactly the
	// failure the implementation plan warns about.
	beforeEach(() => {
		vi.stubGlobal('crossOriginIsolated', true);
		vi.stubGlobal('SharedArrayBuffer', class {});
	});

	it('boots the multi-threaded build and leaves one core for the page', async () => {
		vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
		const client = new StockfishClient();
		await client.warmup();

		expect(createdWorkers[0].script).toBe('/stockfish/stockfish-18-lite.js');
		expect(client.flavor).toBe('multi-threaded');
		// 8 cores → 7 wanted, capped at 4
		expect(createdWorkers[0].posted).toContain('setoption name Threads value 4');
	});

	it('caps threads at 4 however many cores there are', async () => {
		vi.stubGlobal('navigator', { hardwareConcurrency: 32 });
		const client = new StockfishClient();
		await client.warmup();
		expect(createdWorkers[0].posted).toContain('setoption name Threads value 4');
	});

	it('never asks for fewer than one thread on a single-core machine', async () => {
		// hardwareConcurrency - 1 is 0 here; `Threads value 0` is rejected by
		// Stockfish and the engine would boot misconfigured.
		vi.stubGlobal('navigator', { hardwareConcurrency: 1 });
		const client = new StockfishClient();
		await client.warmup();
		expect(createdWorkers[0].posted).toContain('setoption name Threads value 1');
	});

	it('sets Threads before any search is issued', async () => {
		vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
		const client = new StockfishClient();
		await client.evaluate(START_FEN, 16, 1);
		const posted = createdWorkers[0].posted;
		expect(posted.indexOf('setoption name Threads value 3')).toBeLessThan(
			posted.findIndex((msg) => msg.startsWith('go '))
		);
	});
});
