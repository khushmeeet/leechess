import { expect, test } from './fixtures';
import { move, restoreActiveGame, waitForEngineReady } from './helpers';

// The in-game insight bar — Play's single coaching panel: opening name/ECO
// from the bundled book, the live tactic (motif + why), a rule-based coach
// line, and MultiPV idea chips. Plus the Coach/Ideas toggles (in the nav
// Settings menu) persisting across reloads, and the hint mode deciding which
// of those rows exist at all.

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

test('ideas and coach stay inside the panel on a narrow screen', async ({ page }) => {
	// 377px is the narrowest phone the layout targets. The Ideas row is
	// explicitly `flex-wrap` (see InsightBar.svelte) — three chips are meant to
	// fall onto a second line here rather than overflow, so the contract is
	// "every chip visible and inside the panel", not "all on one row". The
	// previous version of this test asserted a single row, which the component
	// has never produced at this width.
	await page.setViewportSize({ width: 377, height: 900 });
	await page.goto('/');
	await waitForEngineReady(page);

	// warmup eval is MultiPV 3: idea chips + coach line for white's first move
	const ideaButtons = page.getByTestId('ideas-row').locator('button');
	await expect(ideaButtons).toHaveCount(3);
	for (const button of await ideaButtons.all()) {
		await expect(button).toBeVisible();
	}

	const bar = page.getByTestId('insight-bar');
	const barBox = (await bar.boundingBox())!;
	for (const button of await ideaButtons.all()) {
		const chip = (await button.boundingBox())!;
		expect(chip.x).toBeGreaterThanOrEqual(barBox.x - 1);
		expect(chip.x + chip.width).toBeLessThanOrEqual(barBox.x + barBox.width + 1);
		expect(chip.y).toBeGreaterThanOrEqual(barBox.y - 1);
		expect(chip.y + chip.height).toBeLessThanOrEqual(barBox.y + barBox.height + 1);
	}

	// wrapping, not overflowing: the panel itself never scrolls sideways, and
	// it fits the viewport
	const scroll = await bar.evaluate((el) => ({
		scrollWidth: el.scrollWidth,
		clientWidth: el.clientWidth
	}));
	expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
	expect(barBox.x + barBox.width).toBeLessThanOrEqual(377);

	// the chips really did wrap rather than all fitting by luck — otherwise
	// this test would keep passing if flex-wrap were removed
	const tops = await ideaButtons.evaluateAll((buttons) =>
		buttons.map((button) => Math.round(button.getBoundingClientRect().top))
	);
	expect(new Set(tops).size).toBeGreaterThan(1);

	await expect(page.getByTestId('coach-line')).toContainText(
		'Fight for the center and develop quickly.'
	);
	await expect(bar).not.toContainText('Eval');
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

test('tactic, coach and ideas share one panel, gated by the hint mode', async ({ page }) => {
	// a live tactic is needed for the Tactic row to have anything to say:
	// Black has just hung the queen with ...Qh4, so Nxh4 wins it
	await restoreActiveGame(page, { moves: ['e2e4', 'e7e5', 'g1f3', 'd8h4'] });
	await page.goto('/');
	await waitForEngineReady(page);

	const bar = page.getByTestId('insight-bar');
	// one panel, not two stacked cards — every row lives inside the bar
	await expect(bar.getByTestId('tactic-row')).toBeVisible({ timeout: 15_000 });
	await expect(bar.getByTestId('coach-line')).toBeVisible();
	await expect(bar.getByTestId('ideas-row')).toBeVisible();

	// Nudge: the ladder replaces the stated tactic, and the engine's answers go —
	// "Stockfish prefers Nxh4" would skip every rung at once
	await page.getByTestId('hint-mode-nudge').click();
	await expect(bar.getByTestId('hint-ladder')).toBeVisible();
	await expect(page.getByTestId('tactic-row')).toBeHidden();
	await expect(page.getByTestId('coach-line')).toBeHidden();
	await expect(page.getByTestId('ideas-row')).toBeHidden();

	// Off is a real game: nothing but the opening, which is book knowledge
	// rather than a hint about this position
	await page.getByTestId('hint-mode-off').click();
	await expect(page.getByTestId('tactic-row')).toBeHidden();
	await expect(page.getByTestId('hint-ladder')).toBeHidden();
	await expect(page.getByTestId('coach-line')).toBeHidden();
	await expect(page.getByTestId('ideas-row')).toBeHidden();
	await expect(page.getByTestId('opening-name')).toBeVisible();
});
