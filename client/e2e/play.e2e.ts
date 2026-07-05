import { expect, test } from '@playwright/test';
import { API, move, playMoves, scholarsMate, waitForEngineReady } from './helpers';

// Phase 1 acceptance criteria for the Play screen: live classification badge
// within 500ms of a move, Level 0 nudge within 200ms of the opponent's move,
// and every finished game auto-completing server-side (no user action).

test('live classification badge appears within 500ms of a move', async ({ page }) => {
	await page.goto('/');
	await waitForEngineReady(page);

	await move(page, 'e2', 'e4');
	// the real requirement, not "eventually": depth-16 eval + badge in 500ms
	await expect(page.getByTestId('move-badge')).toBeVisible({ timeout: 500 });
	await expect(page.getByTestId('move-badge')).toContainText('e4');
});

test('nudge banner reappears within 200ms of the opponent move', async ({ page }) => {
	await page.goto('/');
	const nudge = page.getByText('Checks, captures, threats?');

	// part of the fixed pre-move ritual: shown at start…
	await expect(nudge).toBeVisible();
	await page.getByRole('button', { name: 'Dismiss hint' }).click();
	await expect(nudge).toBeHidden();

	// …and re-shown after every opponent move (in pass-and-play, each move
	// is the next player's "opponent moved" moment)
	await move(page, 'e2', 'e4');
	await expect(nudge).toBeVisible({ timeout: 200 });
});

test('finished game auto-saves, completes, and queues analysis', async ({ page, request }) => {
	await page.goto('/');
	await waitForEngineReady(page);

	await playMoves(page, scholarsMate);
	await expect(page.getByText('Game over: 1-0')).toBeVisible();

	// completion is automatic — no save button, no user action
	const saved = page.getByText(/Saved as game #\d+, analysis queued/);
	await expect(saved).toBeVisible();
	const gameId = (await saved.textContent())!.match(/#(\d+)/)![1];
	await expect(page.getByRole('link', { name: 'open review' })).toBeVisible();

	const response = await request.get(`${API}/games/${gameId}`);
	expect(response.ok()).toBe(true);
	const game = await response.json();
	expect(game.result).toBe('1-0');
	expect(['analyzing', 'complete']).toContain(game.analysis_status);
	expect(game.moves).toHaveLength(scholarsMate.length);
	expect(game.moves.at(-1).san).toBe('Qxf7#');
	// python-chess re-derived the same final position the client reached
	expect(game.moves.at(-1).fen_after).toContain(
		'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR'
	);
});

test('vs-Stockfish mode: engine replies and the game stays in sync', async ({ page }) => {
	await page.goto('/');
	await waitForEngineReady(page);

	await page.getByLabel('Mode').selectOption('engine');
	await move(page, 'e2', 'e4');
	await expect(page.getByTestId('move-list')).toContainText('e4');

	// the engine (black) answers within a few seconds; move list gains a reply
	await expect(page.getByTestId('move-list').locator('li')).toHaveCount(1);
	await expect
		.poll(
			async () => (await page.getByTestId('move-list').textContent())!.trim().split(/\s+/).length,
			{
				timeout: 15_000
			}
		)
		.toBeGreaterThanOrEqual(3); // "1." + white move + black reply
});
