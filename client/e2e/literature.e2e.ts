import { expect, test } from '@playwright/test';

test('literature: glossary, history, and landmark games render with no console errors', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(msg.text());
	});
	page.on('pageerror', (err) => errors.push(err.message));

	await page.goto('/');
	await page.getByRole('link', { name: 'Literature' }).click();
	await expect(page).toHaveURL(/\/literature$/);

	// the full glossary renders
	const entries = page.getByTestId('term-entry');
	expect(await entries.count()).toBeGreaterThan(100);

	// search narrows it to the matching entries
	await page.getByTestId('term-search').fill('zugzwang');
	await expect(entries.first()).toContainText('Zugzwang');
	expect(await entries.count()).toBeLessThan(10);

	// category filter: tactics only — no endgame entries left
	await page.getByTestId('term-search').fill('');
	await page.getByTestId('term-filter-tactics').click();
	await expect(entries.filter({ hasText: 'Fork' }).first()).toBeVisible();
	await expect(entries.filter({ hasText: 'Lucena position' })).toHaveCount(0);

	// history timeline and landmark games, each with a final-position diagram
	await expect(page.getByTestId('history-era')).toHaveCount(8);
	await expect(page.getByTestId('game-card')).toHaveCount(11);
	// the Opera Game diagram renders all 20 pieces of its final position
	await expect(page.locator('[aria-label="Final position of The Opera Game"] piece')).toHaveCount(
		20
	);

	expect(errors).toEqual([]);
});
