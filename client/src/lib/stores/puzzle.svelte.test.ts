/** Unit tests for PuzzleSession promotion handling — the board's picker
 * passes the chosen piece through, so an underpromotion solution only
 * matches when that exact piece was picked. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeEach(() => {
	vi.resetAllMocks();
	api.getNextPuzzle.mockResolvedValue({ ...underpromotionPuzzle });
	api.recordAttempt.mockResolvedValue(undefined);
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
