import { expect, test, type Page } from '@playwright/test';

// Phase 0 exit criteria, automated: play a full legal game on the board,
// submit it, and confirm the server stored a games row plus one moves row per
// ply. Also checks the WASM engine returns a depth-16 eval in under 1s.

/** Click-click move input: chessground selects on the first click and moves
 * on the second. Coordinates assume white orientation (default). */
async function move(page: Page, from: string, to: string) {
	const box = (await page.locator('cg-board').boundingBox())!;
	const square = box.width / 8;
	for (const sq of [from, to]) {
		const file = sq.charCodeAt(0) - 96; // a → 1
		const rank = Number(sq[1]);
		await page.mouse.click(box.x + (file - 0.5) * square, box.y + (8.5 - rank) * square);
	}
}

// Scholar's mate — shortest deterministic full game (checkmate in 7 plies).
const scholarsMate: [string, string, string][] = [
	['e2', 'e4', 'e4'],
	['e7', 'e5', 'e5'],
	['f1', 'c4', 'Bc4'],
	['b8', 'c6', 'Nc6'],
	['d1', 'h5', 'Qh5'],
	['g8', 'f6', 'Nf6'],
	['h5', 'f7', 'Qxf7#']
];

test('full game → submit → rows in games/moves tables', async ({ page, request }) => {
	await page.goto('/');
	await expect(page.locator('cg-board')).toBeVisible();

	for (const [from, to, san] of scholarsMate) {
		await move(page, from, to);
		// wait for the move to land before the next one — clicks during
		// chessground's move animation are dropped
		await expect(page.getByTestId('move-list')).toContainText(san);
	}
	await expect(page.getByText('Game over: 1-0')).toBeVisible();
	await expect(page.getByTestId('move-list')).toContainText('Qxf7#');

	await page.getByRole('button', { name: 'Save game to server' }).click();
	const saved = page.getByText(/Saved as game #\d+/);
	await expect(saved).toBeVisible();
	const gameId = (await saved.textContent())!.match(/#(\d+)/)![1];

	const response = await request.get(`http://localhost:8000/games/${gameId}`);
	expect(response.ok()).toBe(true);
	const game = await response.json();
	expect(game.result).toBe('1-0');
	expect(game.analysis_status).toBe('pending');
	expect(game.moves).toHaveLength(scholarsMate.length);
	expect(game.moves.at(-1).san).toBe('Qxf7#');
	// python-chess re-derived the same final position the client reached
	expect(game.moves.at(-1).fen_after).toContain(
		'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR'
	);
});

test('client WASM engine evaluates at depth 16 in under 1s', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Eval position (depth 16)' }).click();

	// generous timeout for engine init (wasm compile + nnue load), then the
	// search itself must have taken <1s of wall clock per the exit criteria
	await expect(page.getByText(/^\d+ms$/)).toBeVisible({ timeout: 30_000 });
	const ms = Number((await page.getByText(/^\d+ms$/).textContent())!.replace('ms', ''));
	expect(ms).toBeLessThan(1000);

	await expect(page.getByText('multi-threaded', { exact: true })).toBeVisible();
	const depth = await page.locator('dd').nth(2).textContent();
	expect(Number(depth)).toBeGreaterThanOrEqual(16);
});
