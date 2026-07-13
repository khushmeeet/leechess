import { expect, test } from '@playwright/test';
import { move, waitForEngineReady } from './helpers';

// The in-game insight bar: opening name/ECO from the bundled book, a
// rule-based coach line, and MultiPV idea chips — plus the Coach/Ideas
// toggles (in the nav Settings menu) persisting across reloads.

test('opening name appears once the book position is reached', async ({ page }) => {
	await page.goto('/');
	await waitForEngineReady(page);

	const bar = page.getByTestId('insight-bar');
	await expect(bar).toContainText('Starting position');

	// asserted right after the user's own move — independent of the engine
	// reply, 1.e4 is already the deepest book hit
	await move(page, 'e2', 'e4');
	await expect(bar).toContainText('B00', { timeout: 10_000 });
	await expect(page.getByTestId('opening-name')).toContainText("King's Pawn Game");
	await expect(page.getByTestId('opening-subtitle')).toContainText('Known book position');
});

test('ideas and coach render for the starting position', async ({ page }) => {
	await page.setViewportSize({ width: 377, height: 900 });
	await page.goto('/');
	await waitForEngineReady(page);

	// warmup eval is MultiPV 3: idea chips + coach line for white's first move
	const ideaButtons = page.getByTestId('ideas-row').locator('button');
	await expect(ideaButtons).toHaveCount(3);
	const ideaTops = await ideaButtons.evaluateAll((buttons) =>
		buttons.map((button) => button.getBoundingClientRect().top)
	);
	expect(new Set(ideaTops).size).toBe(1);
	const [barBox, lastIdeaBox] = await Promise.all([
		page.getByTestId('insight-bar').boundingBox(),
		ideaButtons.last().boundingBox()
	]);
	expect(barBox).not.toBeNull();
	expect(lastIdeaBox).not.toBeNull();
	expect(lastIdeaBox!.x + lastIdeaBox!.width).toBeLessThanOrEqual(barBox!.x + barBox!.width);
	await expect(page.getByTestId('coach-line')).toContainText(
		'Fight for the center and develop quickly.'
	);
	await expect(page.getByTestId('insight-bar')).not.toContainText('Eval');
});

test('coach and ideas toggles hide the rows and persist across reloads', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByTestId('coach-line')).toBeVisible();
	await expect(page.getByTestId('ideas-row')).toBeVisible();

	await page.getByTestId('settings-button').click();
	await page.getByTestId('settings-menu').getByLabel('Coach').uncheck();
	await page.getByTestId('settings-menu').getByLabel('Ideas').uncheck();
	await expect(page.getByTestId('coach-line')).toBeHidden();
	await expect(page.getByTestId('ideas-row')).toBeHidden();

	await page.reload();
	await expect(page.getByTestId('insight-bar')).toBeVisible();
	await expect(page.getByTestId('coach-line')).toBeHidden();
	await expect(page.getByTestId('ideas-row')).toBeHidden();

	await page.getByTestId('settings-button').click();
	await expect(page.getByTestId('settings-menu').getByLabel('Coach')).not.toBeChecked();
	await expect(page.getByTestId('settings-menu').getByLabel('Ideas')).not.toBeChecked();
});
