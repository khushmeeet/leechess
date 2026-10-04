import { expect, test } from './fixtures';
import { move, moveUntil, restoreActiveGame, waitForEngineReady } from './helpers';

// "Think first": at a critical moment the move is held back until the player
// has marked candidates and had them weighed. The fixture switches it off for
// every other spec; this one turns it back on.

test.beforeEach(async ({ context }) => {
	await context.addInitScript(() => localStorage.setItem('leechess.thinkFirst', 'true'));
});

/** Black has just hung the queen with …Qh4, so Nxh4 is far better than
 * anything else: a critical moment whatever depth the engine reaches. */
async function restoreHangingQueen(page: import('@playwright/test').Page) {
	await restoreActiveGame(page, { moves: ['e2e4', 'e7e5', 'g1f3', 'd8h4'] });
}

test('a critical moment asks for candidates, weighs them, then lets the move through', async ({
	page
}) => {
	await restoreHangingQueen(page);
	await page.goto('/');
	await waitForEngineReady(page);
	await page.getByTestId('hint-mode-full').click();

	const card = page.getByTestId('think-card');
	await expect(card).toContainText('Critical moment', { timeout: 15_000 });
	// the rows that would hand over the answer wait for the thinking
	await expect(page.getByTestId('tactic-row')).toBeHidden();
	await expect(page.getByTestId('engine-row')).toBeHidden();

	// moves on the board are marked, not played
	const candidates = card.getByTestId('think-candidate');
	await moveUntil(page, 'd2', 'd3', 'white', async () => (await candidates.count()) === 1);
	await moveUntil(page, 'f3', 'h4', 'white', async () => (await candidates.count()) === 2);
	await expect(candidates).toHaveText([/^d3/, /^Nxh4/]);
	await expect(page.getByTestId('move-list')).not.toContainText('d3');

	await card.getByTestId('think-check').click();
	await expect(card).toHaveAttribute('data-status', 'graded', { timeout: 30_000 });
	await expect(card.getByTestId('think-grade')).toContainText(
		'The engine’s move, Nxh4, was on your list.'
	);
	await expect(card.getByTestId('think-record')).toContainText('1 of 1 found');
	// the answer rows are back, and the move itself now plays
	await expect(page.getByTestId('tactic-row')).toBeVisible();
	await move(page, 'f3', 'h4');
	await expect(page.getByTestId('move-list')).toContainText('Nxh4');
});

test('skipping lets the move through at once, and Off never asks', async ({ page }) => {
	await restoreHangingQueen(page);
	await page.goto('/');
	await waitForEngineReady(page);
	await page.getByTestId('hint-mode-full').click();

	await page.getByTestId('think-skip').click({ timeout: 15_000 });
	await expect(page.getByTestId('think-card')).toBeHidden();

	await page.getByTestId('hint-mode-off').click();
	await expect(page.getByTestId('think-card')).toBeHidden();
	await move(page, 'f3', 'h4');
	await expect(page.getByTestId('move-list')).toContainText('Nxh4');
});
