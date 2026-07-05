import { expect, type Page } from '@playwright/test';

export const API = 'http://localhost:8000';

/** Click-click move input: chessground selects on the first click and moves
 * on the second. Coordinates assume white orientation (default). */
export async function move(page: Page, from: string, to: string) {
	const box = (await page.locator('cg-board').boundingBox())!;
	const square = box.width / 8;
	for (const sq of [from, to]) {
		const file = sq.charCodeAt(0) - 96; // a → 1
		const rank = Number(sq[1]);
		await page.mouse.click(box.x + (file - 0.5) * square, box.y + (8.5 - rank) * square);
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

/** Wait for the client WASM engine to finish warming up — live-feedback
 * timing assertions only make sense once init cost is out of the way. */
export async function waitForEngineReady(page: Page) {
	await expect(page.getByTestId('engine-status')).toHaveText('ready', { timeout: 30_000 });
}
