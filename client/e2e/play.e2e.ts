import { expect, test } from '@playwright/test';
import { API, move, waitForEngineReady } from './helpers';

// Phase 1 acceptance criteria for the Play screen: live classification badge
// within 500ms of a move, and every finished game auto-completing
// server-side (no user action).

test('toggling the eval bar does not resize the board', async ({ page }) => {
	await page.goto('/');

	const board = page.locator('cg-board');
	const sizeBefore = await board.boundingBox();
	expect(sizeBefore).not.toBeNull();

	await page.getByTestId('settings-button').click();
	await page.getByTestId('settings-menu').getByLabel('Eval bar').check();
	await expect(page.getByTestId('eval-bar')).toBeVisible();

	const sizeAfter = await board.boundingBox();
	expect(sizeAfter).not.toBeNull();
	expect(sizeAfter!.width).toBe(sizeBefore!.width);
	expect(sizeAfter!.height).toBe(sizeBefore!.height);
});

test('live classification badge appears within 500ms of a move', async ({ page }) => {
	await page.goto('/');
	await waitForEngineReady(page);

	await move(page, 'e2', 'e4');
	// the real requirement, not "eventually": depth-16 eval + badge in 500ms
	await expect(page.getByTestId('move-badge')).toBeVisible({ timeout: 500 });
	await expect(page.getByTestId('move-list').getByTestId('move-badge')).toContainText(
		/best|good|inaccuracy|mistake|blunder/
	);
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

test('abandoning a game discards it instead of saving it for review', async ({ page, request }) => {
	await page.goto('/');
	await waitForEngineReady(page);

	await move(page, 'e2', 'e4');
	const syncing = page.getByText(/syncing to server as game #\d+/);
	await expect(syncing).toBeVisible();
	const gameId = (await syncing.textContent())!.match(/#(\d+)/)![1];

	// starting a new game abandons the unfinished one — its server record
	// is deleted, so it can never show up on the review page
	await page.getByRole('button', { name: 'New game' }).click();
	await expect(page.getByText('No moves yet.')).toBeVisible();
	await expect.poll(async () => (await request.get(`${API}/games/${gameId}`)).status()).toBe(404);
});

test('game survives a refresh and stays in sync with the server', async ({ page, request }) => {
	await page.goto('/');
	await waitForEngineReady(page);

	await move(page, 'e2', 'e4');
	// anchor on the rendered move first: '(white to move)' alone can pass on
	// stale text from before the move's render flush
	await expect(page.getByTestId('move-list')).toContainText('e4');
	await expect(page.getByText('(white to move)')).toBeVisible({ timeout: 15_000 });
	const syncing = page.getByText(/syncing to server as game #\d+/);
	await expect(syncing).toBeVisible();
	const gameId = (await syncing.textContent())!.match(/#(\d+)/)![1];

	await page.reload();
	// restored: the move pair is back (board + list + badge), the strength is
	// still locked, and it is the same server game — not a new record
	await expect(page.getByTestId('move-list')).toContainText('e4');
	await expect(page.getByTestId('move-list').locator('li')).toHaveCount(1);
	await expect(page.getByTestId('move-badge')).toBeVisible();
	await expect(page.locator('#strength')).toBeDisabled();
	await expect(page.getByText(`syncing to server as game #${gameId}`)).toBeVisible();
	await waitForEngineReady(page);

	// the game continues where it left off; after it ends, the server record
	// holds every move from before and after the refresh
	await move(page, 'g1', 'f3');
	await expect(page.getByTestId('move-list')).toContainText('Nf3');
	await expect(page.getByText('(white to move)')).toBeVisible({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Resign' }).click();
	await expect(page.getByText(/Saved as game #\d+/)).toBeVisible();

	const response = await request.get(`${API}/games/${gameId}`);
	expect(response.ok()).toBe(true);
	const game = await response.json();
	expect(game.result).toBe('0-1');
	expect(game.moves).toHaveLength(4);
	expect(game.moves.at(0).san).toBe('e4');
	expect(game.moves.at(2).san).toBe('Nf3');
});

test('resigning or starting a new game ends persistence', async ({ page }) => {
	await page.goto('/');
	await waitForEngineReady(page);

	await move(page, 'e2', 'e4');
	await expect(page.getByTestId('move-list')).toContainText('e4');
	await page.getByRole('button', { name: 'Resign' }).click();
	await expect(page.getByText('Game over: 0-1')).toBeVisible();

	// a resigned game does not come back after a refresh
	await page.reload();
	await expect(page.getByText('No moves yet.')).toBeVisible();
	await waitForEngineReady(page);

	// neither does one abandoned via New game
	await move(page, 'e2', 'e4');
	await expect(page.getByTestId('move-list')).toContainText('e4');
	await page.getByRole('button', { name: 'New game' }).click();
	await expect(page.getByText('No moves yet.')).toBeVisible();
	await page.reload();
	await expect(page.getByText('No moves yet.')).toBeVisible();
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
});
