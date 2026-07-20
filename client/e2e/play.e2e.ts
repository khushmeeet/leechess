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
	const evalBarSize = await page.getByTestId('eval-bar').boundingBox();
	expect(sizeAfter).not.toBeNull();
	expect(evalBarSize).not.toBeNull();
	expect(sizeAfter!.width).toBe(sizeBefore!.width);
	expect(sizeAfter!.height).toBe(sizeBefore!.height);
	expect(evalBarSize!.height).toBe(sizeAfter!.height);
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
	const resultOverlay = page.getByTestId('game-result-overlay');
	await expect(resultOverlay).toHaveAttribute('data-outcome', 'loss');
	await expect(resultOverlay).toContainText('You lost');
	await expect(page.getByTestId('game-result-confetti')).toHaveCount(0);

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

test('winning shows a congratulatory overlay with confetti', async ({ page }) => {
	// Restore a naturally completed Scholar's Mate. Replaying these UCI moves
	// through GameStore derives the terminal result exactly as live play does;
	// the completed id prevents this UI-only fixture from creating server data.
	await page.addInitScript(() => {
		localStorage.setItem(
			'leechess.activeGame',
			JSON.stringify({
				version: 1,
				engineSkill: 5,
				moves: ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'],
				evals: [],
				badges: [],
				lastFeedback: null,
				currentEval: null,
				serverGameId: null,
				completedGameId: 999
			})
		);
	});

	await page.goto('/');
	const resultOverlay = page.getByTestId('game-result-overlay');
	await expect(resultOverlay).toHaveAttribute('data-outcome', 'win');
	await expect(resultOverlay).toContainText('You won!');
	await expect(resultOverlay).toContainText('Final score · 1–0');
	await expect(page.getByTestId('game-result-logo')).toBeVisible();
	await expect(page.getByTestId('game-result-confetti')).toHaveCount(1);

	await page.getByRole('button', { name: 'New game' }).click();
	await expect(resultOverlay).toHaveCount(0);
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

test('playing as Black flips the board, the engine opens, and it survives a refresh', async ({
	page
}) => {
	await page.goto('/');
	await waitForEngineReady(page);

	await page.locator('#play-color').selectOption('black');
	await expect(page.locator('.cg-wrap')).toHaveClass(/orientation-black/);
	await expect(page.getByText('· you play Black')).toBeVisible();

	// the engine (White) opens; once its move lands it is the user's turn
	await expect(page.getByText('(black to move)')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId('move-list').locator('li')).toHaveCount(1);

	// the black game persists: still flipped, same single opener, no re-open
	await page.reload();
	await expect(page.locator('.cg-wrap')).toHaveClass(/orientation-black/);
	await expect(page.getByText('(black to move)')).toBeVisible({ timeout: 15_000 });
	await waitForEngineReady(page);
	await expect(page.getByTestId('move-list').locator('li')).toHaveCount(1);
});

test('promoting a pawn opens the piece picker instead of auto-queening', async ({ page }) => {
	// Restore a position where 5.bxa8 promotes (white pawn on b7, rook on a8).
	await page.addInitScript(() => {
		localStorage.setItem(
			'leechess.activeGame',
			JSON.stringify({
				version: 1,
				engineSkill: 5,
				playerColor: 'white',
				moves: ['a2a4', 'h7h6', 'a4a5', 'h6h5', 'a5a6', 'h5h4', 'a6b7', 'h4h3'],
				evals: [],
				badges: [],
				lastFeedback: null,
				currentEval: null,
				serverGameId: null,
				completedGameId: null
			})
		);
	});
	await page.goto('/');
	await waitForEngineReady(page);

	// cancelling the picker snaps the pawn back without playing a move
	await move(page, 'b7', 'a8');
	await expect(page.getByTestId('promotion-picker')).toBeVisible();
	await page.getByTestId('promotion-backdrop').click();
	await expect(page.getByTestId('promotion-picker')).toHaveCount(0);
	await expect(page.getByTestId('move-list').locator('li')).toHaveCount(4);

	// picking the knight underpromotes
	await move(page, 'b7', 'a8');
	await page.getByTestId('promote-knight').click();
	await expect(page.getByTestId('move-list')).toContainText('bxa8=N');
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
