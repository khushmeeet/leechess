/** Unit tests for PlaySession — the play-screen state machine. Everything
 * async in the store is serialized through two promise chains (`chain` for
 * engine/eval work, `sync` for server calls) guarded by a generation counter
 * and a suspended flag; these tests drive those races directly with mocked
 * engine and API seams, which the e2e suite can't do deterministically. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({
	warmup: vi.fn(),
	evaluate: vi.fn(),
	play: vi.fn()
}));

const api = vi.hoisted(() => ({
	startGame: vi.fn(),
	postMove: vi.fn(),
	completeGame: vi.fn(),
	discardGame: vi.fn(),
	getGame: vi.fn()
}));

const persistence = vi.hoisted(() => ({
	loadActiveGame: vi.fn(),
	saveActiveGame: vi.fn(),
	clearActiveGame: vi.fn()
}));

vi.mock('$lib/stores/stockfish', () => ({ stockfish: engine }));
vi.mock('$lib/stores/gamePersistence', () => persistence);
vi.mock('$lib/api/client', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/api/client')>();
	return { ...actual, ...api }; // real ApiError, mocked calls
});
vi.mock('$lib/stores/soundPrefs.svelte', () => ({
	soundPrefs: { enabled: false, play: vi.fn(), move: vi.fn(), setEnabled: vi.fn() }
}));
vi.mock('$lib/stores/username.svelte', () => ({ usernamePrefs: { name: null } }));
vi.mock('$lib/openings', () => ({
	loadOpenings: vi.fn(async () => false),
	openingsReady: () => false,
	openingForFens: vi.fn(() => null)
}));

import { ApiError } from '$lib/api/client';
import { PlaySession } from './play.svelte';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Engine search result: cp white-POV, single line, depth 16. */
function evalResult(cp: number, bestMove = 'd2d4') {
	return { cp, bestMove, depth: 16, ms: 5, lines: [] };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Flush the store's internal promise chains (they never use timers). */
async function settle() {
	for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function startedSession(): Promise<PlaySession> {
	const session = new PlaySession();
	await session.start();
	return session;
}

/** Play a user move and wait until the engine's reply has been applied. */
async function playWithReply(session: PlaySession, orig: string, dest: string) {
	const target = session.game.moves.length + 2;
	session.handleBoardMove(orig as never, dest as never);
	await vi.waitFor(() => {
		expect(session.game.moves.length).toBe(target);
	});
}

beforeEach(() => {
	vi.resetAllMocks();
	persistence.loadActiveGame.mockReturnValue(null);
	engine.warmup.mockResolvedValue(undefined);
	engine.evaluate.mockResolvedValue(evalResult(30));
	engine.play.mockResolvedValue(evalResult(0, 'e7e5'));
	api.startGame.mockResolvedValue({ id: 42 });
	api.postMove.mockResolvedValue({});
	api.completeGame.mockResolvedValue({});
	api.discardGame.mockResolvedValue(undefined);
	api.getGame.mockResolvedValue({ moves: [] });
});

describe('start()', () => {
	it('warms the engine and seeds baseline eval, insight, and ideas', async () => {
		const session = await startedSession();
		expect(engine.warmup).toHaveBeenCalledOnce();
		expect(session.engineReady).toBe(true);
		expect(session.insightEval).toEqual({ cp: 30, mate: undefined, depth: 16 });
		expect(session.ideas?.fen).toBe(START_FEN);
	});
});

describe('live classification', () => {
	it('badges a user move against the baseline captured before the move', async () => {
		const session = await startedSession();
		// baseline 30 (white POV); after e4 white is down to -40 → loss 70 → mistake
		engine.evaluate.mockResolvedValue(evalResult(-40, 'e7e5'));
		await playWithReply(session, 'e2', 'e4');
		expect(session.badges[0]).toBe('mistake');
		expect(session.lastFeedback).toEqual({ ply: 1, san: 'e4', classification: 'mistake' });
		expect(session.badges[1]).toBeUndefined(); // engine moves are never badged
	});

	it("classifies the engine's own suggestion as best even when the eval dips", async () => {
		engine.evaluate.mockResolvedValue(evalResult(30, 'e2e4')); // best move = e4
		const session = await startedSession();
		engine.evaluate.mockResolvedValue(evalResult(-100, 'e7e5'));
		await playWithReply(session, 'e2', 'e4');
		expect(session.badges[0]).toBe('best');
	});
});

describe('server sync chain', () => {
	it('creates the server record on the first move and posts moves in order', async () => {
		const session = await startedSession();
		await playWithReply(session, 'e2', 'e4');
		await settle();
		expect(api.startGame).toHaveBeenCalledExactlyOnceWith(
			'engine',
			undefined,
			'white',
			'Stockfish (Club)'
		);
		expect(api.postMove.mock.calls).toEqual([
			[42, 'e2e4'],
			[42, 'e7e5']
		]);
	});

	it('stops syncing after a failure but the game continues locally', async () => {
		api.postMove.mockRejectedValue(new ApiError(500, 'boom'));
		const session = await startedSession();
		await playWithReply(session, 'e2', 'e4');
		await settle();
		expect(session.serverError).toContain('boom');
		expect(api.postMove).toHaveBeenCalledTimes(1); // engine reply's post skipped
		expect(session.game.moves.length).toBe(2); // local play unaffected
	});
});

describe('generation guard and suspend', () => {
	it('drops an engine reply that lands after newGame()', async () => {
		const session = await startedSession();
		const reply = deferred<ReturnType<typeof evalResult>>();
		engine.play.mockReturnValue(reply.promise);
		session.handleBoardMove('e2' as never, 'e4' as never);
		await vi.waitFor(() => expect(engine.play).toHaveBeenCalled());

		session.newGame();
		reply.resolve(evalResult(0, 'e7e5'));
		await settle();

		expect(session.game.moves.length).toBe(0); // stale reply never applied
		expect(session.serverGameId).toBeNull();
		expect(api.discardGame).toHaveBeenCalledWith(42); // abandoned record deleted
	});

	it('suspend() keeps queued work from applying moves or posting to the server', async () => {
		const session = await startedSession();
		const reply = deferred<ReturnType<typeof evalResult>>();
		engine.play.mockReturnValue(reply.promise);
		session.handleBoardMove('e2' as never, 'e4' as never);
		await vi.waitFor(() => expect(engine.play).toHaveBeenCalled());
		const postsBefore = api.postMove.mock.calls.length;

		session.suspend();
		reply.resolve(evalResult(0, 'e7e5'));
		await settle();

		expect(session.game.moves.length).toBe(1); // reply dropped
		expect(api.postMove.mock.calls.length).toBe(postsBefore);
	});
});

describe('playing as Black', () => {
	it('flipping to black before the first move makes the engine open', async () => {
		engine.play.mockResolvedValue(evalResult(20, 'e2e4'));
		const session = await startedSession();
		session.setPreferredColor('black');
		expect(session.playerColor).toBe('black');
		await vi.waitFor(() => expect(session.game.moves.length).toBe(1));
		expect(session.game.moves[0].san).toBe('e4');
		expect(session.game.turnColor).toBe('black'); // user's move now
		expect(session.badges[0]).toBeUndefined(); // engine openers are never badged
	});

	it('flipping back to white cancels an in-flight engine opener', async () => {
		const opener = deferred<ReturnType<typeof evalResult>>();
		engine.play.mockReturnValue(opener.promise);
		const session = await startedSession();
		session.setPreferredColor('black');
		await vi.waitFor(() => expect(engine.play).toHaveBeenCalled());

		session.setPreferredColor('white');
		opener.resolve(evalResult(20, 'e2e4'));
		await settle();

		expect(session.game.moves.length).toBe(0); // opener dropped, White is the user
		expect(session.playerColor).toBe('white');
	});

	it('a mid-game color change only applies from the next game', async () => {
		const session = await startedSession();
		await playWithReply(session, 'e2', 'e4');
		session.setPreferredColor('black');
		expect(session.playerColor).toBe('white'); // current game unaffected

		engine.play.mockResolvedValue(evalResult(20, 'd2d4'));
		session.newGame();
		expect(session.playerColor).toBe('black');
		await vi.waitFor(() => expect(session.game.moves.length).toBe(1));
		expect(session.game.moves[0].san).toBe('d4');
	});

	it('restoring a black game on the engine turn resumes with its reply', async () => {
		persistence.loadActiveGame.mockReturnValue({
			version: 1,
			engineSkill: 5,
			playerColor: 'black' as const,
			moves: ['e2e4', 'e7e5'], // engine (White) to move
			evals: [20, 15],
			badges: [null, 'good'],
			lastFeedback: null,
			currentEval: 15,
			serverGameId: 7,
			completedGameId: null
		});
		api.getGame.mockResolvedValue({ moves: [{}, {}] });
		engine.play.mockResolvedValue(evalResult(20, 'g1f3'));
		const session = new PlaySession();
		await session.start();
		expect(session.playerColor).toBe('black');
		await vi.waitFor(() => expect(session.game.moves.length).toBe(3));
		expect(session.game.moves[2].san).toBe('Nf3');
	});
});

describe('promotion', () => {
	it('plays the picker-chosen piece instead of auto-queening', async () => {
		// white pawn on b7 with the black rook on a8 — bxa8 must underpromote
		persistence.loadActiveGame.mockReturnValue({
			version: 1,
			engineSkill: 5,
			playerColor: 'white' as const,
			moves: ['a2a4', 'h7h6', 'a4a5', 'h6h5', 'a5a6', 'h5h4', 'a6b7', 'h4h3'],
			evals: [],
			badges: [],
			lastFeedback: null,
			currentEval: null,
			serverGameId: null,
			completedGameId: null
		});
		const session = new PlaySession();
		await session.start();
		session.handleBoardMove('b7' as never, 'a8' as never, 'n');
		expect(session.game.moves.at(-1)?.san).toBe('bxa8=N');
		expect(session.game.moves.at(-1)?.uci).toBe('b7a8n');
	});
});

describe('engine failure recovery', () => {
	it('retries a failed reply once, then pauses with engineError; retryEngineMove recovers', async () => {
		const session = await startedSession();
		engine.play
			.mockRejectedValueOnce(new Error('search timed out'))
			.mockRejectedValueOnce(new Error('search timed out again'));
		session.handleBoardMove('e2' as never, 'e4' as never);
		await vi.waitFor(() => expect(session.engineError).not.toBeNull());
		expect(engine.play).toHaveBeenCalledTimes(2);
		expect(session.game.moves.length).toBe(1); // game paused on the engine's turn

		session.retryEngineMove(); // third play call hits the default resolved mock
		await vi.waitFor(() => expect(session.game.moves.length).toBe(2));
		expect(session.engineError).toBeNull();
	});
});

describe('finishing games', () => {
	it("completes a checkmated game server-side with the board's result", async () => {
		const session = await startedSession();
		engine.play
			.mockResolvedValueOnce(evalResult(0, 'e7e5'))
			.mockResolvedValueOnce(evalResult(0, 'b8c6'))
			.mockResolvedValueOnce(evalResult(0, 'g8f6'));
		await playWithReply(session, 'e2', 'e4');
		await playWithReply(session, 'f1', 'c4');
		await playWithReply(session, 'd1', 'h5');
		session.handleBoardMove('h5' as never, 'f7' as never); // Qxf7#

		await vi.waitFor(() => expect(session.completedGameId).toBe(42));
		expect(session.game.result).toBe('1-0');
		expect(api.completeGame).toHaveBeenCalledExactlyOnceWith(42, '1-0');
	});

	it('resign completes the game server-side and ends persistence', async () => {
		const session = await startedSession();
		await playWithReply(session, 'e2', 'e4');
		await settle();
		persistence.saveActiveGame.mockClear();

		session.resign();
		await settle();
		expect(api.completeGame).toHaveBeenCalledExactlyOnceWith(42, '0-1');
		expect(persistence.clearActiveGame).toHaveBeenCalled();
		expect(persistence.saveActiveGame).not.toHaveBeenCalled(); // resigned games stay cleared
	});
});

describe('restore resync', () => {
	const saved = {
		version: 1,
		engineSkill: 5,
		playerColor: 'white' as const,
		moves: ['e2e4', 'e7e5'],
		evals: [20, 15],
		badges: ['good', null],
		lastFeedback: null,
		currentEval: 15,
		serverGameId: 7,
		completedGameId: null
	};

	it('posts only the moves the server record is missing', async () => {
		persistence.loadActiveGame.mockReturnValue({ ...saved });
		api.getGame.mockResolvedValue({ moves: [{}] }); // server has 1 of 2 plies
		const session = new PlaySession();
		await settle();
		expect(session.game.moves.length).toBe(2); // replayed locally
		expect(api.postMove.mock.calls).toEqual([[7, 'e7e5']]);
		expect(api.startGame).not.toHaveBeenCalled();
	});

	it('recreates a 404ed record and replays every move', async () => {
		persistence.loadActiveGame.mockReturnValue({ ...saved });
		api.getGame.mockRejectedValue(new ApiError(404, 'gone'));
		api.startGame.mockResolvedValue({ id: 99 });
		const session = new PlaySession();
		await settle();
		expect(session.serverGameId).toBe(99);
		expect(api.postMove.mock.calls).toEqual([
			[99, 'e2e4'],
			[99, 'e7e5']
		]);
	});

	it('completes a finished game on restore, tolerating an already-completed 409', async () => {
		const mate = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'];
		persistence.loadActiveGame.mockReturnValue({
			...saved,
			moves: mate,
			evals: mate.map(() => 0),
			badges: mate.map(() => null)
		});
		api.getGame.mockResolvedValue({ moves: mate.map(() => ({})) }); // fully synced
		api.completeGame.mockRejectedValue(new ApiError(409, 'already completed'));
		const session = new PlaySession();
		await settle();
		expect(session.completedGameId).toBe(7); // 409 = completed right before refresh
		expect(api.postMove).not.toHaveBeenCalled();
	});
});
