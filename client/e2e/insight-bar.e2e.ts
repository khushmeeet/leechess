import { expect, test } from '@playwright/test';
import { move, waitForEngineReady } from './helpers';

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

test('tactic, coach and ideas share one panel, gated by the hint mode', async ({ page }) => {
	// a live tactic is needed for the Tactic row to have anything to say:
	// Black has just hung the queen with ...Qh4, so Nxh4 wins it
	await page.addInitScript(() => {
		localStorage.setItem(
			'leechess.activeGame',
			JSON.stringify({
				version: 1,
				engineSkill: 5,
				playerColor: 'white',
				moves: ['e2e4', 'e7e5', 'g1f3', 'd8h4'],
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

	const bar = page.getByTestId('insight-bar');
	// one panel, not two stacked cards — every row lives inside the bar
	await expect(bar.getByTestId('tactic-row')).toBeVisible({ timeout: 15_000 });
	await expect(bar.getByTestId('coach-line')).toBeVisible();
	await expect(bar.getByTestId('ideas-row')).toBeVisible();

	// Nudge: the tactic is flagged but not named, and the engine's answers go —
	// "Stockfish prefers Nxh4" would hand over what the row is withholding
	await page.getByTestId('hint-mode-nudge').click();
	await expect(bar.getByTestId('tactic-row')).toBeVisible();
	await expect(page.getByTestId('tactic-motif')).toBeHidden();
	await expect(page.getByTestId('coach-line')).toBeHidden();
	await expect(page.getByTestId('ideas-row')).toBeHidden();

	// Off is a real game: nothing but the opening, which is book knowledge
	// rather than a hint about this position
	await page.getByTestId('hint-mode-off').click();
	await expect(page.getByTestId('tactic-row')).toBeHidden();
	await expect(page.getByTestId('coach-line')).toBeHidden();
	await expect(page.getByTestId('ideas-row')).toBeHidden();
	await expect(page.getByTestId('opening-name')).toBeVisible();
});
