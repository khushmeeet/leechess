import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { move, restoreActiveGame, waitForEngineReady } from './helpers';

// The glow on a checked king's square. It is a background gradient on
// chessground's own check square, so what a spec can see is that square and
// the state the board published for it to be styled from.

/** The board wrapper, while it is carrying how bad the check is. The attribute
 * is absent entirely when nobody is in check, so this selector matching
 * nothing is itself the "no check" assertion. */
const board = '[data-check]';

/** The glow, as the browser resolves it. Both states share these colours and
 * differ only in alpha, so the test for "which one" is the alpha of the core.
 */
const glow = (square: Element) => getComputedStyle(square).backgroundImage;

/** Restore a game and land on it. The saved positions below all stop on the
 * *user's* turn, so the engine has nothing to play and the position holds
 * still for the assertions. */
async function position(page: Page, game: Record<string, unknown>) {
	await restoreActiveGame(page, game);
	await page.goto('/');
	await expect(page.locator('cg-board')).toBeVisible();
}

test('a checked king sits in a red glow', async ({ page }) => {
	// 1. f3 e5 2. Kf2 Qh4+ — white is in check and it is white's move.
	await position(page, { moves: ['f2f3', 'e7e5', 'e1f2', 'd8h4'], playerColor: 'white' });

	await expect(page.locator('cg-board square.check')).toHaveCount(1);
	await expect(page.locator(board)).toHaveAttribute('data-check', 'check');

	const painted = await page.locator('cg-board square.check').evaluate(glow);
	expect(painted).toContain('radial-gradient');
	expect(painted).toContain('rgba(248, 72, 51, 0.765)');
});

test('mate turns the same glow up', async ({ page }) => {
	// Scholar's mate — black is mated, so nothing moves again either way.
	await position(page, {
		moves: ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'],
		playerColor: 'white'
	});

	await expect(page.locator(board)).toHaveAttribute('data-check', 'mate');
	const square = page.locator('cg-board square.check');
	await expect(square).toHaveCount(1);

	// same hue, opaque core — the check state's core is 0.765
	const painted = await square.evaluate(glow);
	expect(painted).toContain('rgb(248, 72, 51)');
	expect(painted).not.toContain('rgba(248, 72, 51, 0.765)');
});

test('the glow arrives with the check and leaves with it', async ({ page }) => {
	// The same game one ply earlier: 1. f3 e5 2. Kf2, black (the user) to move
	// and nobody in check yet.
	await position(page, { moves: ['f2f3', 'e7e5', 'e1f2'], playerColor: 'black' });
	await waitForEngineReady(page);

	const lit = page.locator('cg-board square.check');
	await expect(lit).toHaveCount(0);
	// Absence, not a falsy value: the board sets data-check to null when nobody
	// is in check, and Svelte drops the attribute rather than emptying it — so
	// there is no element here to assert an attribute *on*.
	await expect(page.locator(board)).toHaveCount(0);

	await move(page, 'd8', 'h4', 'black');
	await expect(lit).toHaveCount(1);

	// White's reply has to get out of check — every legal move does — and none
	// of them can check back from this position, so the glow must go. It only
	// does if the board keeps telling chessground about check on *every*
	// position: a board that only ever set it would strand this one here.
	await expect(lit).toHaveCount(0);
	await expect(page.locator(board)).toHaveCount(0);
});

test('the glow stays inside the square it is on', async ({ page }) => {
	// 1. e4 d5 2. Bb5+ — the black king is on e8, against the board's edge,
	// which is where anything drawn wider than the square would show up: on the
	// page, over the captured-pieces row. The gradient runs to 130%, so this is
	// the case that proves the overspill is clipped rather than merely unused.
	await position(page, { moves: ['e2e4', 'd7d5', 'f1b5'], playerColor: 'black' });
	await expect(page.locator(board)).toHaveAttribute('data-check', 'check');

	const painted = await page.locator('cg-board square.check').evaluate((square) => ({
		square: square.getBoundingClientRect().width,
		eighth: square.parentElement!.getBoundingClientRect().width / 8,
		// a background is clipped to its own box; a pseudo-element is not, and
		// is how the glow would get out of the square again
		before: getComputedStyle(square, '::before').content,
		after: getComputedStyle(square, '::after').content
	}));

	expect(painted.square).toBeCloseTo(painted.eighth, 1);
	expect(painted.before).toBe('none');
	expect(painted.after).toBe('none');
});
