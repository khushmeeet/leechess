import { expect, test } from '@playwright/test';

test('play screen renders the board with no console errors', async ({ page }) => {
	const errors: string[] = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(msg.text());
	});
	page.on('pageerror', (err) => errors.push(err.message));

	await page.goto('/');

	// chessground renders a <cg-board> element inside its wrapper
	await expect(page.locator('cg-board')).toBeVisible();

	// nav links for the four screens
	await expect(page.getByRole('link', { name: 'Play' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Review' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Puzzles' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Progress' })).toBeVisible();

	// Level 0 nudge is part of the fixed pre-move ritual
	await expect(page.getByText('Checks, captures, threats?')).toBeVisible();

	// COOP/COEP headers must be in effect or stockfish silently loses threading
	expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

	expect(errors).toEqual([]);
});
