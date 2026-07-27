import { expect, test } from './fixtures';
import { consoleErrors } from './helpers';

test('play screen renders the board with no console errors', async ({ page }) => {
	const errors = consoleErrors(page);

	await page.goto('/');

	// chessground renders a <cg-board> element inside its wrapper
	await expect(page.locator('cg-board')).toBeVisible();

	// nav links for the five screens
	await expect(page.getByRole('link', { name: 'Play' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Review' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Puzzles' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Progress' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Literature' })).toBeVisible();

	// COOP/COEP headers must be in effect or stockfish silently loses threading
	expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

	expect(errors).toEqual([]);
});
