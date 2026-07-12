import { expect, test } from '@playwright/test';
import { API, move, waitForEngineReady } from './helpers';

// Phase 1 acceptance criteria for the Play screen: live classification badge
// within 500ms of a move, Level 0 nudge re-shown after the opponent's move,
// and every finished game auto-completing server-side (no user action).

test('live classification badge appears within 500ms of a move', async ({ page }) => {
	await page.goto('/');
	await waitForEngineReady(page);

	await move(page, 'e2', 'e4');
	// the real requirement, not "eventually": depth-16 eval + badge in 500ms
	await expect(page.getByTestId('move-badge')).toBeVisible({ timeout: 500 });
	await expect(page.getByTestId('move-badge')).toContainText('e4');
});

test('nudge banner reappears after the opponent (engine) move', async ({ page }) => {
	await page.goto('/');
	await waitForEngineReady(page);
	const nudge = page.getByText('Checks, captures, threats?');

	// part of the fixed pre-move ritual: shown at start…
	await expect(nudge).toBeVisible();
	await page.getByRole('button', { name: 'Dismiss hint' }).click();
	await expect(nudge).toBeHidden();

	// …and re-shown once the engine replies
	await move(page, 'e2', 'e4');
	await expect(nudge).toBeVisible({ timeout: 15_000 });
});

test('finished game auto-saves, completes, and queues analysis', async ({ page, request }) => {
	await page.goto('/');
	await waitForEngineReady(page);

	// resignation ends the game deterministically (an engine opponent
	// doesn't produce a scriptable checkmate line to click through)
	await move(page, 'e2', 'e4');
	await expect(page.getByTestId('move-list')).toContainText('e4');
	await page.getByRole('button', { name: 'Resign' }).click();
	await expect(page.getByText('Game over: 0-1')).toBeVisible();

	// completion is automatic — no save button, no user action
	const saved = page.getByText(/Saved as game #\d+, analysis queued/);
	await expect(saved).toBeVisible();
	const gameId = (await saved.textContent())!.match(/#(\d+)/)![1];
	await expect(page.getByRole('link', { name: 'open review' })).toBeVisible();

	const response = await request.get(`${API}/games/${gameId}`);
	expect(response.ok()).toBe(true);
	const game = await response.json();
	expect(game.result).toBe('0-1');
	expect(['analyzing', 'complete']).toContain(game.analysis_status);
	expect(game.moves).toHaveLength(1);
	expect(game.moves.at(0).san).toBe('e4');
});

test('engine replies and the game stays in sync', async ({ page }) => {
	await page.goto('/');
	await waitForEngineReady(page);

	await move(page, 'e2', 'e4');
	await expect(page.getByTestId('move-list')).toContainText('e4');

	// the engine (black) answers within a few seconds: the turn indicator only
	// returns to "white to move" once its reply has been applied to the board.
	// (Don't count words in the move list — classification badge letters make
	// that pass before the reply lands.)
	await expect(page.getByText('(white to move)')).toBeVisible({ timeout: 15_000 });
	// still one move pair: white's move + the engine reply, nothing extra
	await expect(page.getByTestId('move-list').locator('li')).toHaveCount(1);
	// and the nudge is re-shown after the opponent's (engine's) move
	await expect(page.getByText('Checks, captures, threats?')).toBeVisible();
});
