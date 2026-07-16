import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StockfishClient } from './stockfish';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// Well past any real init (20s) or depth-search (15s) ceiling in stockfish.ts;
// init resolves via `uciok` first, so its timer is cleared and only the search
// timeout can fire within this window.
const PAST_ANY_TIMEOUT_MS = 30000;

/** Stand-in for the stockfish Web Worker. Boots (`uci` → `uciok`) by default;
 * how it answers a `go` search is configured per instance so a test can make
 * it respond, hang, or crash. */
class MockWorker {
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
			constructor() {
				const w = new MockWorker();
				createdWorkers.push(w);
				configureNextWorker(w);
				return w as unknown as Worker;
			}
		}
	);
	// Force the single-threaded boot path (no `navigator.hardwareConcurrency`).
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
});
