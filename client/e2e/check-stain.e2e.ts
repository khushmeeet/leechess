import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { move, restoreActiveGame, waitForEngineReady } from './helpers';

// The stain on a checked king's square. It is painted under the pieces, by
// chessground's own check square, so what a spec can see is that square and
// the state the board published for it to be styled from — the artwork itself
// is a background image on a pseudo-element.

/** The board wrapper, which carries how bad the check is. */
const board = '[data-check]';

/** Restore a game and land on it. The saved positions below all stop on the
 * *user's* turn, so the engine has nothing to play and the position holds
 * still for the assertions. */
async function position(page: Page, game: Record<string, unknown>) {
	await restoreActiveGame(page, game);
	await page.goto('/');
	await expect(page.locator('cg-board')).toBeVisible();
}

test('a checked king stands in a stain, and mate deepens it', async ({ page }) => {
	// 1. f3 e5 2. Kf2 Qh4+ — white is in check and it is white's move.
	await position(page, { moves: ['f2f3', 'e7e5', 'e1f2', 'd8h4'], playerColor: 'white' });

	await expect(page.locator('cg-board square.check')).toHaveCount(1);
	await expect(page.locator(board)).toHaveAttribute('data-check', 'check');

	const artwork = () =>
		page
			.locator('cg-board square.check')
			.evaluate((square) => getComputedStyle(square, '::before').backgroundImage);
	expect(await artwork()).toContain('/board/check.svg');
});

test('mate paints the heavier stain, and runs with it', async ({ page }) => {
	// Scholar's mate — black is mated, so nothing moves again either way.
	await position(page, {
		moves: ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'],
		playerColor: 'white'
	});

	await expect(page.locator(board)).toHaveAttribute('data-check', 'mate');
	const square = page.locator('cg-board square.check');
	await expect(square).toHaveCount(1);

	const layers = await square.evaluate((el) => ({
		pool: getComputedStyle(el, '::before').backgroundImage,
		runs: getComputedStyle(el, '::after').backgroundImage
	}));
	expect(layers.pool).toContain('/board/mate.svg');
	expect(layers.runs).toContain('/board/mate-drips.svg');
});

test('the stain arrives with the check and leaves with it', async ({ page }) => {
	// The same game one ply earlier: 1. f3 e5 2. Kf2, black (the user) to move
	// and nobody in check yet.
	await position(page, { moves: ['f2f3', 'e7e5', 'e1f2'], playerColor: 'black' });
	await waitForEngineReady(page);

	const stain = page.locator('cg-board square.check');
	await expect(stain).toHaveCount(0);
	await expect(page.locator(board)).not.toHaveAttribute('data-check', /check|mate/);

	await move(page, 'd8', 'h4', 'black');
	await expect(stain).toHaveCount(1);

	// White's reply has to get out of check — every legal move does — and none
	// of them can check back from this position, so the stain must go. It only
	// does if the board keeps telling chessground about check on *every*
	// position: a board that only ever set it would strand this one here.
	await expect(stain).toHaveCount(0);
	await expect(page.locator(board)).not.toHaveAttribute('data-check', /check|mate/);
});

test('the stain is trimmed where it would spill off the board', async ({ page }) => {
	// 1. e4 d5 2. Bb5+ — the black king is on e8, on the board's edge, and the
	// user is playing black so the board is seen from that side.
	await position(page, { moves: ['e2e4', 'd7d5', 'f1b5'], playerColor: 'black' });

	await expect(page.locator(board)).toHaveAttribute('data-check', 'check');
	// e8 is the bottom edge from black's side, so the bottom quarter goes
	const clip = await page
		.locator(board)
		.evaluate((el) => getComputedStyle(el).getPropertyValue('--check-clip').trim());
	expect(clip).toBe('inset(0% 0% 25% 0%)');
});
