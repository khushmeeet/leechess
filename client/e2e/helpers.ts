import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const API = 'http://localhost:8000';

/** Click-click move input: chessground selects on the first click and moves
 * on the second. The board flips for black orientation (puzzles are viewed
 * from the solver's side), so coordinates flip too. */
export async function move(
	page: Page,
	from: string,
	to: string,
	orientation: 'white' | 'black' = 'white'
) {
	const box = (await page.locator('cg-board').boundingBox())!;
	const square = box.width / 8;
	for (const sq of [from, to]) {
		const file = sq.charCodeAt(0) - 96; // a → 1
		const rank = Number(sq[1]);
		const x = orientation === 'white' ? (file - 0.5) * square : (8.5 - file) * square;
		const y = orientation === 'white' ? (8.5 - rank) * square : (rank - 0.5) * square;
		await page.mouse.click(box.x + x, box.y + y);
	}
}

/** Play a scripted sequence, waiting for each SAN to land in the move list —
 * clicks during chessground's move animation are dropped. */
export async function playMoves(page: Page, moves: readonly (readonly [string, string, string])[]) {
	for (const [from, to, san] of moves) {
		await move(page, from, to);
		await expect(page.getByTestId('move-list')).toContainText(san);
	}
}

/** Scholar's mate — shortest deterministic full game (checkmate in 7 plies).
 * The same scripted game is used by the backend's test_analysis_job.py so
 * both suites exercise identical data. */
export const scholarsMate = [
	['e2', 'e4', 'e4'],
	['e7', 'e5', 'e5'],
	['f1', 'c4', 'Bc4'],
	['b8', 'c6', 'Nc6'],
	['d1', 'h5', 'Qh5'],
	['g8', 'f6', 'Nf6'],
	['h5', 'f7', 'Qxf7#']
] as const;

export const scholarsMateSans = scholarsMate.map(([, , san]) => san);

/** 3.Qxe5+?? hangs the queen to 3...Nxe5 — the scripted tactics game shared
 * with the backend suite; analysis deterministically yields one personal
 * puzzle (punish the blunder: play Nxe5). */
export const hungQueenSans = ['e4', 'e5', 'Qh5', 'Nc6', 'Qxe5+', 'Nxe5'] as const;

/** Seed a finished game through the live-game API (fast + deterministic)
 * and return its id. Completing it enqueues the analysis job. */
export async function seedGame(
	request: APIRequestContext,
	sans: readonly string[],
	result = '0-1'
): Promise<number> {
	const created = await request.post(`${API}/games`, { data: { mode: 'local' } });
	expect(created.ok()).toBe(true);
	const gameId = (await created.json()).id;
	for (const san of sans) {
		const response = await request.post(`${API}/games/${gameId}/moves`, { data: { san } });
		expect(response.ok()).toBe(true);
	}
	const completed = await request.post(`${API}/games/${gameId}/complete`, {
		data: { result }
	});
	expect(completed.ok()).toBe(true);
	return gameId;
}

/** Poll until the server-side analysis job finishes for a game. */
export async function waitForAnalysis(request: APIRequestContext, gameId: number) {
	await expect
		.poll(
			async () => {
				const response = await request.get(`${API}/games/${gameId}/review`);
				return (await response.json()).analysis_status;
			},
			{ timeout: 60_000 }
		)
		.toBe('complete');
}

/** Wait for the client WASM engine to finish warming up — live-feedback
 * timing assertions only make sense once init cost is out of the way. */
export async function waitForEngineReady(page: Page) {
	await expect(page.getByTestId('engine-status')).toHaveText('ready', { timeout: 30_000 });
}
