import { Chess } from 'chess.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// judgeDrill and canStillWin are pure, but importing them pulls in the
// session's engine/sound/API seams — stub them the way play.svelte.test.ts
// does so the module graph resolves outside SvelteKit.
const engine = vi.hoisted(() => ({ warmup: vi.fn(), evaluate: vi.fn(), play: vi.fn() }));
const api = vi.hoisted(() => ({ getNextDrill: vi.fn(), recordDrillAttempt: vi.fn() }));

vi.mock('$lib/stores/soundPrefs.svelte', () => ({
	soundPrefs: { enabled: false, play: vi.fn(), move: vi.fn(), setEnabled: vi.fn() }
}));
vi.mock('$lib/stores/stockfish', () => ({ stockfish: engine }));
vi.mock('$lib/api/client', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/api/client')>();
	return { ...actual, ...api };
});

import {
	canStillWin,
	describeOutcome,
	DrillSession,
	judgeDrill,
	MOVE_CAP,
	type DrillOutcome,
	type JudgeContext
} from './endgameDrill.svelte';

/** A deferred promise, for driving the engine seam a step at a time. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Let the session's promise chain drain. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** K+P vs K, White (the user) to move and winning. */
const WIN_DRILL = {
	id: 11,
	key: 'kp-key-squares-1',
	family: 'kp-key-squares',
	fen: '8/8/8/3k4/8/3K4/3P4/8 w - - 0 1',
	player_color: 'white',
	goal: 'win',
	title: 'King and pawn',
	box: 1,
	due_at: '2026-01-01T00:00:00Z'
};

/** The same ending with Black (the engine) to move, so the drill opens with
 * an engine reply before the user has touched anything. */
const ENGINE_OPENS_DRILL = { ...WIN_DRILL, id: 12, fen: '8/8/8/3k4/8/3K4/3P4/8 b - - 0 1' };

/** judgeDrill inspects the position only, so tests build one straight from a
 * FEN — no board, no engine, no session. */
function judge(fen: string, ctx: Partial<JudgeContext> & Pick<JudgeContext, 'goal'>) {
	return judgeDrill(new Chess(fen), {
		playerColor: 'white',
		playerMoves: 0,
		...ctx
	});
}

describe('canStillWin', () => {
	it('is true while the side has a pawn to promote', () => {
		expect(canStillWin(new Chess('8/8/8/3k4/8/3K4/3P4/8 w - - 0 1'), 'white')).toBe(true);
	});

	it('is false for a bare king', () => {
		expect(canStillWin(new Chess('8/8/8/3k4/8/3K4/8/8 w - - 0 1'), 'white')).toBe(false);
	});

	it('is false when both sides still have a rook (dead drawn)', () => {
		expect(canStillWin(new Chess('8/8/8/3k4/8/3K4/r7/7R w - - 0 1'), 'white')).toBe(false);
	});

	it('is true with a rook against a bare king', () => {
		expect(canStillWin(new Chess('8/8/8/3k4/8/3K4/8/7R w - - 0 1'), 'white')).toBe(true);
	});

	it('is true after promoting in a rook ending (Q+R vs R)', () => {
		// the pawn is gone precisely because it queened — being pawnless here
		// must not read as "the win got away"
		expect(canStillWin(new Chess('1Q6/8/8/3k4/8/3K4/r7/7R w - - 0 1'), 'white')).toBe(true);
	});
});

describe('win drills', () => {
	it('passes on a safe promotion', () => {
		// white just played b7b8q; black king is far and cannot take it
		const verdict = judge('1Q6/8/8/7k/8/8/8/K7 b - - 0 1', {
			goal: 'win',
			lastMove: { uci: 'b7b8q', byPlayer: true }
		});
		expect(verdict).toEqual({ done: true, success: true, outcome: 'promoted' });
	});

	it('plays on when the new queen hangs', () => {
		// black rook on a8 takes the fresh queen on b8 next move
		const verdict = judge('rQ6/8/8/7k/8/8/8/K7 b - - 0 1', {
			goal: 'win',
			lastMove: { uci: 'b7b8q', byPlayer: true }
		});
		expect(verdict).toEqual({ done: false });
	});

	it('passes on checkmate', () => {
		const verdict = judge('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1', { goal: 'win' });
		expect(verdict).toEqual({ done: true, success: true, outcome: 'mate' });
	});

	it('fails when the last pawn is captured', () => {
		// K vs K is a dead draw by rule, so that fires before the material check
		const verdict = judge('8/8/8/3k4/8/3K4/8/8 w - - 0 1', { goal: 'win' });
		expect(verdict).toEqual({ done: true, success: false, outcome: 'insufficient' });
	});

	it('fails when the pawn goes in a rook ending but both rooks remain', () => {
		const verdict = judge('8/8/8/3k4/8/3K4/r7/7R w - - 0 1', { goal: 'win' });
		expect(verdict).toEqual({ done: true, success: false, outcome: 'material-lost' });
	});

	it('plays on after winning the enemy rook, even with no pawns left', () => {
		const verdict = judge('8/8/8/3k4/8/3K4/8/7R w - - 0 1', { goal: 'win' });
		expect(verdict).toEqual({ done: false });
	});

	it('fails on stalemate — the win was thrown away', () => {
		const verdict = judge('7k/5Q2/7K/8/8/8/8/8 b - - 0 1', { goal: 'win' });
		expect(verdict).toEqual({ done: true, success: false, outcome: 'stalemate' });
	});

	it('fails at the move cap', () => {
		const verdict = judge('8/8/8/3k4/8/3K4/3P4/8 w - - 0 1', {
			goal: 'win',
			playerMoves: MOVE_CAP
		});
		expect(verdict).toEqual({ done: true, success: false, outcome: 'move-cap' });
	});
});

describe('draw drills', () => {
	const black: Partial<JudgeContext> = { playerColor: 'black' };

	it('passes on stalemate', () => {
		const verdict = judge('7k/5Q2/7K/8/8/8/8/8 b - - 0 1', { goal: 'draw', ...black });
		expect(verdict).toEqual({ done: true, success: true, outcome: 'stalemate' });
	});

	it('passes on insufficient material', () => {
		const verdict = judge('8/8/8/3k4/8/3K4/8/8 w - - 0 1', { goal: 'draw', ...black });
		expect(verdict).toEqual({ done: true, success: true, outcome: 'insufficient' });
	});

	it('passes once the opponent has nothing left to win with', () => {
		// white's pawn is gone and both sides still hold a rook
		const verdict = judge('8/8/8/3k4/8/3K4/r7/7R w - - 0 1', { goal: 'draw', ...black });
		expect(verdict).toEqual({ done: true, success: true, outcome: 'opponent-disarmed' });
	});

	it('fails when the opponent promotes', () => {
		const verdict = judge('1Q6/8/8/7k/8/8/8/K7 b - - 0 1', {
			goal: 'draw',
			...black,
			lastMove: { uci: 'b7b8q', byPlayer: false }
		});
		expect(verdict).toEqual({ done: true, success: false, outcome: 'opponent-promoted' });
	});

	it('fails on being checkmated', () => {
		const verdict = judge('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1', { goal: 'draw', ...black });
		expect(verdict).toEqual({ done: true, success: false, outcome: 'mated' });
	});

	it('passes at the move cap — holding that long is the draw', () => {
		const verdict = judge('4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', {
			goal: 'draw',
			...black,
			playerMoves: MOVE_CAP
		});
		expect(verdict).toEqual({ done: true, success: true, outcome: 'move-cap' });
	});

	it('keeps playing while the pawn is still on the board', () => {
		const verdict = judge('4k3/8/4K3/4P3/8/8/8/8 b - - 0 1', { goal: 'draw', ...black });
		expect(verdict).toEqual({ done: false });
	});
});

describe('describeOutcome', () => {
	// Exact copy, not toBeTruthy(): several outcomes read completely
	// differently depending on whether the player passed ("Stalemate — held")
	// or failed ("Stalemate — the win slipped away"), and a swapped pair would
	// tell someone who just held a draw that they threw it away. A
	// non-emptiness check cannot see that.
	const COPY: Record<DrillOutcome, { pass: string; fail: string }> = {
		mate: { pass: 'Checkmate — converted.', fail: 'Checkmate — converted.' },
		promoted: {
			pass: 'Pawn promoted safely — that’s the win.',
			fail: 'Pawn promoted safely — that’s the win.'
		},
		stalemate: { pass: 'Stalemate — held.', fail: 'Stalemate — the win slipped away.' },
		insufficient: {
			pass: 'Nothing left to mate with — held.',
			fail: 'Not enough material left to win.'
		},
		repetition: {
			pass: 'Threefold repetition — held.',
			fail: 'Repetition — no progress made.'
		},
		'fifty-move': {
			pass: 'Fifty-move rule — held.',
			fail: 'Fifty moves without progress.'
		},
		'opponent-disarmed': {
			pass: 'The pawn is gone — nothing left to defend against.',
			fail: 'The pawn is gone — nothing left to defend against.'
		},
		mated: { pass: 'Checkmated.', fail: 'Checkmated.' },
		'opponent-promoted': {
			pass: 'The pawn queened — the defense broke.',
			fail: 'The pawn queened — the defense broke.'
		},
		'material-lost': {
			pass: 'Your pawn went, and with it the win.',
			fail: 'Your pawn went, and with it the win.'
		},
		'move-cap': {
			pass: 'Held long enough — that’s the draw.',
			fail: 'Ran out of moves without converting.'
		}
	};

	for (const [outcome, copy] of Object.entries(COPY) as [
		DrillOutcome,
		{ pass: string; fail: string }
	][]) {
		it(`words ${outcome} correctly in both directions`, () => {
			expect(describeOutcome(outcome, true)).toBe(copy.pass);
			expect(describeOutcome(outcome, false)).toBe(copy.fail);
		});
	}

	it('covers every outcome judgeDrill can produce', () => {
		// The table above is only exhaustive because DrillOutcome keys it — a
		// new outcome fails typecheck. This asserts the runtime side too: every
		// documented outcome has copy, and none was quietly dropped.
		const produced = new Set<DrillOutcome>([
			'mate',
			'promoted',
			'stalemate',
			'insufficient',
			'repetition',
			'fifty-move',
			'opponent-disarmed',
			'mated',
			'opponent-promoted',
			'material-lost',
			'move-cap'
		]);
		expect(new Set(Object.keys(COPY) as DrillOutcome[])).toEqual(produced);
	});
});

// --- session behaviour ----------------------------------------------------
//
// judgeDrill above is pure and well covered; the session around it — engine
// retries, the generation guard, suspend, and recording an attempt exactly
// once — was previously only exercised by the browser suite playing one drill
// against a real engine. That proves the happy path and nothing else: a
// nondeterministic opponent cannot be made to fail twice, or to answer after
// the user has already loaded the next drill.

describe('DrillSession', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		api.getNextDrill.mockResolvedValue({ ...WIN_DRILL });
		api.recordDrillAttempt.mockResolvedValue(undefined);
		engine.warmup.mockResolvedValue(undefined);
		engine.play.mockResolvedValue({ bestMove: 'd5c5', cp: 0, depth: 20, ms: 1, lines: [] });
	});

	it('reports an empty queue rather than an error, and never starts the engine', async () => {
		const { ApiError } = await import('$lib/api/client');
		api.getNextDrill.mockRejectedValue(new ApiError(404, 'nothing due'));
		const session = new DrillSession();
		await session.load();
		expect(session.status).toBe('empty');
		expect(engine.warmup).not.toHaveBeenCalled();
		expect(session.userCanMove).toBe(false);
	});

	it('surfaces a failed warmup without losing the drill', async () => {
		engine.warmup.mockRejectedValue(new Error('wasm blocked'));
		const session = new DrillSession();
		await session.load();
		expect(session.status).toBe('playing');
		expect(session.engineError).toBe('wasm blocked');
		expect(session.engineReady).toBe(false);
	});

	it('lets the engine open when the drill starts on its turn', async () => {
		api.getNextDrill.mockResolvedValue({ ...ENGINE_OPENS_DRILL });
		const session = new DrillSession();
		await session.load();
		await settle();
		expect(engine.play).toHaveBeenCalledTimes(1);
		expect(session.game.moves.map((m) => m.uci)).toEqual(['d5c5']);
		expect(session.playerMoves).toBe(0); // the engine's move is not the user's
		expect(session.isPlayersTurn).toBe(true);
	});

	it('retries a failed engine search once, then gives up and waits for the user', async () => {
		api.getNextDrill.mockResolvedValue({ ...ENGINE_OPENS_DRILL });
		engine.play.mockRejectedValue(new Error('worker error'));
		const session = new DrillSession();
		await session.load();
		await settle();

		expect(engine.play).toHaveBeenCalledTimes(2); // ENGINE_REPLY_ATTEMPTS
		expect(session.engineError).toBe('worker error');
		expect(session.engineThinking).toBe(false);
		expect(session.game.moves).toHaveLength(0);
		expect(session.status).toBe('playing'); // not failed — recoverable

		// manual recovery runs a fresh search and the drill carries on
		engine.play.mockResolvedValue({ bestMove: 'd5c5', cp: 0, depth: 20, ms: 1, lines: [] });
		session.retryEngineMove();
		await settle();
		expect(session.engineError).toBeNull();
		expect(session.game.moves.map((m) => m.uci)).toEqual(['d5c5']);
	});

	it('recovers when only the first of the two attempts fails', async () => {
		api.getNextDrill.mockResolvedValue({ ...ENGINE_OPENS_DRILL });
		engine.play
			.mockRejectedValueOnce(new Error('worker error'))
			.mockResolvedValue({ bestMove: 'd5c5', cp: 0, depth: 20, ms: 1, lines: [] });
		const session = new DrillSession();
		await session.load();
		await settle();
		expect(engine.play).toHaveBeenCalledTimes(2);
		expect(session.engineError).toBeNull();
		expect(session.game.moves.map((m) => m.uci)).toEqual(['d5c5']);
	});

	it('drops an engine reply that lands after the next drill has loaded', async () => {
		// The generation guard. Without it the previous drill's answer is
		// applied to the position now on the board — or throws trying.
		api.getNextDrill.mockResolvedValue({ ...ENGINE_OPENS_DRILL });
		const slow = deferred<{ bestMove: string }>();
		engine.play.mockReturnValueOnce(slow.promise);

		const session = new DrillSession();
		await session.load();
		await settle();
		expect(session.game.moves).toHaveLength(0); // still waiting on the engine

		api.getNextDrill.mockResolvedValue({ ...WIN_DRILL });
		engine.play.mockResolvedValue({ bestMove: 'd3c3', cp: 0, depth: 20, ms: 1, lines: [] });
		await session.load();
		const fenAfterLoad = session.game.fen;

		slow.resolve({ bestMove: 'd5c5' });
		await settle();
		expect(session.drill?.id).toBe(WIN_DRILL.id);
		expect(session.game.fen).toBe(fenAfterLoad);
		expect(session.game.moves).toHaveLength(0);
	});

	it('drops engine work queued before suspend()', async () => {
		api.getNextDrill.mockResolvedValue({ ...ENGINE_OPENS_DRILL });
		const slow = deferred<{ bestMove: string }>();
		engine.play.mockReturnValueOnce(slow.promise);

		const session = new DrillSession();
		await session.load();
		await settle();

		session.suspend();
		slow.resolve({ bestMove: 'd5c5' });
		await settle();
		expect(session.game.moves).toHaveLength(0);
	});

	it('ignores board input while the engine is still to move', async () => {
		// Kd5-c5 is a legal move here — for BLACK, whose turn it is. Nothing
		// stops the user dragging the engine's king while it thinks, so the
		// session has to refuse on whose turn it is rather than leave it to
		// chess.js to reject an illegal move.
		api.getNextDrill.mockResolvedValue({ ...ENGINE_OPENS_DRILL });
		const slow = deferred<{ bestMove: string }>();
		engine.play.mockReturnValueOnce(slow.promise);
		const session = new DrillSession();
		await session.load();
		await settle();

		expect(session.userCanMove).toBe(false);
		session.handleBoardMove('d5', 'c5');
		expect(session.game.moves).toHaveLength(0);
		expect(session.playerMoves).toBe(0);

		slow.resolve({ bestMove: 'd5c5' });
		await settle();
		expect(session.game.moves.map((m) => m.uci)).toEqual(['d5c5']);
		expect(session.playerMoves).toBe(0); // still none of them the user's
	});

	it('counts only the user’s own moves toward the cap', async () => {
		const session = new DrillSession();
		await session.load();
		await settle();
		expect(session.userCanMove).toBe(true);

		session.handleBoardMove('d3', 'c3'); // user
		await settle();
		expect(session.playerMoves).toBe(1);
		expect(session.game.moves).toHaveLength(2); // plus the engine's answer
	});

	it('records the attempt exactly once when the drill resolves', async () => {
		// A drill one move from promoting: the user queens and it is over.
		api.getNextDrill.mockResolvedValue({
			...WIN_DRILL,
			id: 13,
			fen: '8/1P6/8/7k/8/8/8/K7 w - - 0 1'
		});
		const session = new DrillSession();
		await session.load();
		await settle();

		session.handleBoardMove('b7', 'b8', 'q');
		await settle();

		expect(session.status).toBe('won');
		expect(session.outcome).toBe('promoted');
		expect(api.recordDrillAttempt).toHaveBeenCalledExactlyOnceWith(13, true, 1, 'promoted');
		expect(engine.play).not.toHaveBeenCalled(); // the drill ended first

		// the board is closed to further input once the drill has resolved, so
		// no second attempt can be recorded for it
		session.handleBoardMove('a1', 'a2');
		expect(session.userCanMove).toBe(false);
		expect(session.game.moves).toHaveLength(1);
		expect(api.recordDrillAttempt).toHaveBeenCalledTimes(1);
		expect(session.completedCount).toBe(1);
	});

	it('restart() replays the same drill from the start and can record again', async () => {
		api.getNextDrill.mockResolvedValue({
			...WIN_DRILL,
			id: 13,
			fen: '8/1P6/8/7k/8/8/8/K7 w - - 0 1'
		});
		const session = new DrillSession();
		await session.load();
		await settle();
		session.handleBoardMove('b7', 'b8', 'q');
		await settle();
		expect(session.status).toBe('won');

		session.restart();
		await settle();
		expect(session.status).toBe('playing');
		expect(session.playerMoves).toBe(0);
		expect(session.game.moves).toHaveLength(0);
		expect(session.outcome).toBeNull();

		session.handleBoardMove('b7', 'b8', 'q');
		await settle();
		expect(api.recordDrillAttempt).toHaveBeenCalledTimes(2);
	});
});
