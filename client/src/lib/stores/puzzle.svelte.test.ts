/** PuzzleSession state machine.
 *
 * The browser suite drives one real puzzle end to end, but its data is a
 * one-move solution — so the multi-ply path, the delayed opponent reply, and
 * the timer that reply runs on were never executed by any test. Those are
 * exercised here with fake timers instead, where "the reply lands after
 * 350ms, and not before" is something a test can actually state. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
	getNextPuzzle: vi.fn(),
	recordAttempt: vi.fn()
}));

vi.mock('$lib/api/client', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/api/client')>();
	return { ...actual, ...api };
});
vi.mock('$lib/stores/soundPrefs.svelte', () => ({
	soundPrefs: { enabled: false, play: vi.fn(), move: vi.fn(), setEnabled: vi.fn() }
}));

import { PuzzleSession } from './puzzle.svelte';

// White to move; the winning line underpromotes: e8=N (a queen is not the
// solution and does not mate — Kg7 escapes the check).
const underpromotionPuzzle = {
	id: 1,
	fen: '6k1/4P3/8/8/8/8/8/K7 w - - 0 1',
	solution: ['e7e8n'],
	motif: 'promotion',
	difficulty: null,
	source_move_id: null,
	box: 1,
	due_at: '2026-01-01T00:00:00Z'
};

/** Black to move, two of Black's moves with a White reply in between:
 * 1...Qxg2+ 2.Kxg2 Rh2+. The middle move is scripted, so the session plays
 * it on the reply timer rather than waiting for input. */
const twoMovePuzzle = {
	id: 2,
	fen: '6k1/8/8/8/7r/7q/6P1/6K1 b - - 0 1',
	solution: ['h3g2', 'g1g2', 'h4h2'],
	motif: 'back_rank_mate',
	difficulty: 1400,
	source_move_id: 7,
	box: 1,
	due_at: '2026-01-01T00:00:00Z'
};

beforeEach(() => {
	vi.resetAllMocks();
	api.getNextPuzzle.mockResolvedValue({ ...underpromotionPuzzle });
	api.recordAttempt.mockResolvedValue(undefined);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('promotion moves', () => {
	it('solves when the picked piece matches the solution', async () => {
		const session = new PuzzleSession();
		await session.load();
		session.handleBoardMove('e7', 'e8', 'n');
		expect(session.status).toBe('solved');
		expect(api.recordAttempt).toHaveBeenCalledWith(1, true, 0);
	});

	it('counts a non-mating queen promotion as a wrong try', async () => {
		const session = new PuzzleSession();
		await session.load();
		session.handleBoardMove('e7', 'e8', 'q');
		expect(session.status).toBe('solving');
		expect(session.wrong).toBe(true);
		expect(api.recordAttempt).toHaveBeenCalledWith(1, false, 0);
	});
});

describe('multi-ply solutions', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		api.getNextPuzzle.mockResolvedValue({ ...twoMovePuzzle });
	});

	it('holds the opponent reply back, then plays it and waits for the next move', async () => {
		const session = new PuzzleSession();
		await session.load();
		expect(session.orientation).toBe('black');
		expect(session.solutionSans).toEqual(['Qxg2+', 'Kxg2', 'Rh2+']);

		session.handleBoardMove('h3', 'g2');
		// the solver's move is on the board immediately...
		expect(session.fen.split(' ')[1]).toBe('w');
		expect(session.status).toBe('solving');
		// ...the scripted reply is not, until its beat has passed
		await vi.advanceTimersByTimeAsync(300);
		expect(session.fen.split(' ')[1]).toBe('w');
		await vi.advanceTimersByTimeAsync(100);
		expect(session.fen.split(' ')[1]).toBe('b');
		expect(session.isPlayersTurn).toBe(true);

		// still unsolved and unrecorded — a two-move puzzle is not finished
		// halfway through
		expect(session.status).toBe('solving');
		expect(api.recordAttempt).not.toHaveBeenCalled();

		session.handleBoardMove('h4', 'h2');
		expect(session.status).toBe('solved');
		expect(api.recordAttempt).toHaveBeenCalledExactlyOnceWith(2, true, 0);
	});

	it('names the solver’s next move across the pending reply', async () => {
		// Hint levels 3-4 point at the move the solver plays NEXT, which during
		// the reply beat means looking one move past the board.
		const session = new PuzzleSession();
		await session.load();
		expect(session.nextPlayerMove).toEqual({ san: 'Qxg2+', uci: 'h3g2' });

		session.handleBoardMove('h3', 'g2');
		expect(session.nextPlayerMove).toEqual({ san: 'Rh2+', uci: 'h4h2' });

		await vi.advanceTimersByTimeAsync(400);
		expect(session.nextPlayerMove).toEqual({ san: 'Rh2+', uci: 'h4h2' });
	});

	it('ignores board input while the opponent reply is still pending', async () => {
		const session = new PuzzleSession();
		await session.load();
		session.handleBoardMove('h3', 'g2');
		const duringBeat = session.fen;

		// Kxg2 is White's only legal answer here — which is also the scripted
		// reply. Without the turn guard this click would match `expected` and
		// play the opponent's move early, skipping the beat the animation
		// depends on and letting the solver click through the whole line at
		// once.
		session.handleBoardMove('g1', 'g2');
		expect(session.fen).toBe(duringBeat);
		expect(session.wrong).toBe(false);
		expect(api.recordAttempt).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(400);
		expect(session.fen).not.toBe(duringBeat);
		session.handleBoardMove('h4', 'h2');
		expect(session.status).toBe('solved');
	});

	it('cancels a pending reply when the next puzzle loads', async () => {
		// Loading over a puzzle mid-line used to be able to let the old timer
		// fire into the new session — pushing a move from the previous
		// solution onto the position now on the board.
		const session = new PuzzleSession();
		await session.load();
		session.handleBoardMove('h3', 'g2');

		api.getNextPuzzle.mockResolvedValue({ ...underpromotionPuzzle });
		await session.load();
		const loadedFen = session.fen;
		expect(loadedFen).toBe(underpromotionPuzzle.fen);

		await vi.advanceTimersByTimeAsync(1000);
		expect(session.fen).toBe(loadedFen);
		expect(session.puzzle?.id).toBe(1);
		expect(session.status).toBe('solving');
	});

	it('records one attempt per puzzle, however many tries it takes', async () => {
		// The first miss is what gets recorded; retries after it are free, and
		// the eventual solve must not add a second (correct) attempt on top.
		const session = new PuzzleSession();
		await session.load();

		session.handleBoardMove('g8', 'f8'); // legal, not the solution, no mate
		expect(session.wrong).toBe(true);
		expect(api.recordAttempt).toHaveBeenCalledExactlyOnceWith(2, false, 0);

		session.handleBoardMove('g8', 'f7'); // miss again
		expect(api.recordAttempt).toHaveBeenCalledTimes(1);

		session.handleBoardMove('h3', 'g2');
		await vi.advanceTimersByTimeAsync(400);
		session.handleBoardMove('h4', 'h2');
		expect(session.status).toBe('solved');
		expect(api.recordAttempt).toHaveBeenCalledTimes(1);
	});
});

describe('hint level', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		api.getNextPuzzle.mockResolvedValue({ ...twoMovePuzzle });
	});

	it('records the level the solver climbed to', async () => {
		const session = new PuzzleSession();
		await session.load();
		session.hintLevel = 3;

		session.handleBoardMove('h3', 'g2');
		await vi.advanceTimersByTimeAsync(400);
		session.handleBoardMove('h4', 'h2');
		// Leitner keeps the box when the move itself was shown (level >= 4), so
		// the level has to reach the server, not just the screen
		expect(api.recordAttempt).toHaveBeenCalledExactlyOnceWith(2, true, 3);
	});

	it('reveal-answer records level 5', async () => {
		const session = new PuzzleSession();
		await session.load();
		session.revealAnswer();
		expect(session.hintLevel).toBe(5);

		session.handleBoardMove('h3', 'g2');
		await vi.advanceTimersByTimeAsync(400);
		session.handleBoardMove('h4', 'h2');
		expect(api.recordAttempt).toHaveBeenCalledExactlyOnceWith(2, true, 5);
	});

	it('starts each puzzle back at level 0', async () => {
		const session = new PuzzleSession();
		await session.load();
		session.revealAnswer();
		await session.load();
		expect(session.hintLevel).toBe(0);
		expect(session.wrong).toBe(false);
	});
});

describe('load failures', () => {
	it('reports an empty queue rather than an error', async () => {
		const { ApiError } = await import('$lib/api/client');
		api.getNextPuzzle.mockRejectedValue(new ApiError(404, 'No puzzles due'));
		const session = new PuzzleSession();
		await session.load();
		expect(session.status).toBe('empty');
		expect(session.puzzle).toBeNull();
		expect(session.error).toBeNull();
	});

	it('surfaces any other failure as an error', async () => {
		api.getNextPuzzle.mockRejectedValue(new Error('network down'));
		const session = new PuzzleSession();
		await session.load();
		expect(session.status).toBe('error');
		expect(session.error).toBe('network down');
	});

	it('grades nothing while not solving', async () => {
		api.getNextPuzzle.mockRejectedValue(new Error('network down'));
		const session = new PuzzleSession();
		await session.load();
		session.handleBoardMove('e2', 'e4');
		expect(api.recordAttempt).not.toHaveBeenCalled();
	});
});
