import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ApiError,
	completeGame,
	discardGame,
	getNextDrill,
	getNextPuzzle,
	getProgress,
	getWikibookLine,
	listDrills,
	postMove,
	recordAttempt,
	recordDrillAttempt,
	startGame,
	takeBackMoves
} from './client';

// The store tests mock this whole module, and the browser suite only ever
// exercises the happy path against a seeded database — so the fetch wrapper
// itself had no coverage at all. Everything downstream depends on two of its
// behaviours in particular: a failed response becoming an ApiError that
// carries the status (the stores branch on 404 to show an empty queue rather
// than an error), and a 204 not being handed to response.json().

function jsonResponse(body: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body))
	} as Response;
}

function errorResponse(status: number, body = 'boom'): Response {
	return {
		ok: false,
		status,
		json: () => Promise.reject(new Error('should not be read')),
		text: () => Promise.resolve(body)
	} as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn(() => Promise.resolve(jsonResponse({})));
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

/** The (url, init) the wrapper actually passed to fetch. */
function lastCall(): [string, RequestInit] {
	return fetchMock.mock.calls.at(-1) as [string, RequestInit];
}

describe('error handling', () => {
	it('throws an ApiError carrying the status', async () => {
		fetchMock.mockResolvedValue(errorResponse(404, 'No puzzles due'));
		// The stores' empty-queue branch is `e instanceof ApiError && e.status
		// === 404` — both halves of that have to come from here.
		const error = await getNextPuzzle().catch((e) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect(error.status).toBe(404);
	});

	it('puts the method, path, status and body in the message', async () => {
		fetchMock.mockResolvedValue(errorResponse(422, 'illegal move'));
		const error: ApiError = await postMove(7, 'e2e5').catch((e) => e);
		expect(error.message).toContain('POST');
		expect(error.message).toContain('/games/7/moves');
		expect(error.message).toContain('422');
		expect(error.message).toContain('illegal move');
	});

	it('reports a GET without an explicit method as GET', async () => {
		fetchMock.mockResolvedValue(errorResponse(500));
		const error: ApiError = await getProgress().catch((e) => e);
		expect(error.message).toContain('GET /progress failed (500)');
	});

	it('lets a network failure through as-is', async () => {
		fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
		const error = await getNextPuzzle().catch((e) => e);
		expect(error).toBeInstanceOf(TypeError);
		expect(error).not.toBeInstanceOf(ApiError);
	});

	it('does not treat a 2xx as a failure', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ id: 3 }, 201));
		await expect(recordAttempt(3, true, 0)).resolves.toEqual({ id: 3 });
	});
});

describe('204 responses', () => {
	it('resolves to undefined instead of parsing an empty body', async () => {
		// DELETE /games/{id} answers 204; calling response.json() on it throws,
		// and discardGame is fire-and-forget on the abandon path — the throw
		// would surface as an unhandled rejection rather than anything visible.
		const json = vi.fn(() => Promise.reject(new Error('Unexpected end of JSON input')));
		fetchMock.mockResolvedValue({
			ok: true,
			status: 204,
			json,
			text: () => Promise.resolve('')
		} as unknown as Response);

		await expect(discardGame(4)).resolves.toBeUndefined();
		expect(json).not.toHaveBeenCalled();
	});
});

describe('request shape', () => {
	it('sends JSON content-type on every call', async () => {
		await getProgress();
		const [, init] = lastCall();
		expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
	});

	it('builds the puzzle URL, encoding the motif filter', async () => {
		await getNextPuzzle();
		expect(lastCall()[0]).toMatch(/\/puzzles\/next$/);

		await getNextPuzzle('back rank mate');
		expect(lastCall()[0]).toMatch(/\/puzzles\/next\?motif=back%20rank%20mate$/);
	});

	it('builds the drill URLs, encoding the family filter', async () => {
		await getNextDrill();
		expect(lastCall()[0]).toMatch(/\/endgames\/next$/);

		await getNextDrill('kp-key-squares');
		expect(lastCall()[0]).toMatch(/\/endgames\/next\?family=kp-key-squares$/);

		await listDrills('rook-pawn-conversion');
		expect(lastCall()[0]).toMatch(/\/endgames\/drills\?family=rook-pawn-conversion$/);
	});

	it('encodes the wikibook move list', async () => {
		await getWikibookLine(['e4', 'e5', 'Nf3']);
		expect(lastCall()[0]).toMatch(/\/wikibook\/line\?moves=e4%2Ce5%2CNf3$/);
	});

	it('posts an attempt in the server’s snake_case shape', async () => {
		// The store passes camelCase; the API takes hint_level_used. A rename on
		// either side is otherwise only caught by a browser test.
		await recordAttempt(12, false, 3);
		const [url, init] = lastCall();
		expect(url).toMatch(/\/puzzles\/12\/attempt$/);
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body as string)).toEqual({ correct: false, hint_level_used: 3 });
	});

	it('posts a drill attempt in the server’s snake_case shape', async () => {
		await recordDrillAttempt(5, true, 14, 'promoted');
		const [url, init] = lastCall();
		expect(url).toMatch(/\/endgames\/5\/attempt$/);
		expect(JSON.parse(init.body as string)).toEqual({
			success: true,
			moves_played: 14,
			outcome: 'promoted'
		});
	});

	it('posts a takeback as an absolute target ply', async () => {
		// to_ply is a target length, not a count — that is what makes a retried
		// or double-clicked takeback idempotent.
		await takeBackMoves(9, 4);
		const [url, init] = lastCall();
		expect(url).toMatch(/\/games\/9\/takeback$/);
		expect(JSON.parse(init.body as string)).toEqual({ to_ply: 4 });
	});

	it('completes a game with its result', async () => {
		await completeGame(2, '0-1');
		const [url, init] = lastCall();
		expect(url).toMatch(/\/games\/2\/complete$/);
		expect(JSON.parse(init.body as string)).toEqual({ result: '0-1' });
	});

	it('discards with keepalive, so an unload does not cancel it', async () => {
		// The abandon path fires during teardown; without keepalive the browser
		// drops the request and the unfinished game is never deleted.
		await discardGame(6);
		const [url, init] = lastCall();
		expect(url).toMatch(/\/games\/6$/);
		expect(init.method).toBe('DELETE');
		expect(init.keepalive).toBe(true);
	});
});

describe('startGame seating', () => {
	// The server attributes progress and summary stats by user_color, so the
	// name that goes in each seat has to follow the colour the human picked.
	it('seats the human as White by default', async () => {
		await startGame('engine', 'khush', 'white', 'Stockfish (Club)');
		expect(JSON.parse(lastCall()[1].body as string)).toEqual({
			mode: 'engine',
			user_color: 'white',
			white: 'khush',
			black: 'Stockfish (Club)'
		});
	});

	it('swaps the seats when the human plays Black', async () => {
		await startGame('engine', 'khush', 'black', 'Stockfish (Club)');
		expect(JSON.parse(lastCall()[1].body as string)).toEqual({
			mode: 'engine',
			user_color: 'black',
			white: 'Stockfish (Club)',
			black: 'khush'
		});
	});

	it('leaves the server defaults in place when no name is set', async () => {
		await startGame('local');
		expect(JSON.parse(lastCall()[1].body as string)).toEqual({
			mode: 'local',
			user_color: 'white'
		});
	});
});
