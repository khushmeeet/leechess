import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { boardPosition, move, waitForEngineReady } from './helpers';

// Zen mode: Play stripped to the board alone. Everything the screen normally
// carries — nav, panels, eval bar — goes, and the only way back to any of it
// is a control strip that stays out of sight until asked for.

/** Turn zen on from the Settings menu and wait for the stage to take over.
 *
 * `click`, not `check`: the toggle lives in the nav, and turning zen on takes
 * the nav away — so Playwright's post-click read of the checkbox would find a
 * detached element and time out waiting for it to report itself checked. The
 * stage appearing is the better signal anyway. */
async function enterZen(page: Page) {
	await page.getByTestId('settings-button').click();
	await page.getByTestId('settings-menu').getByLabel('Zen mode').click();
	await expect(page.getByTestId('zen-stage')).toBeVisible();
}

/** Wait out the linger the controls are shown for on entry. */
async function waitForControlsToFade(page: Page) {
	await expect(page.getByTestId('zen-controls')).not.toHaveClass(/shown/, { timeout: 10_000 });
}

/** The gesture the mode is built on: a pointer press on the stage beside the
 * board. Deliberately not `.click()` on the stage — Playwright would aim at
 * its centre, which is the board, and the press only counts where it lands on
 * the space around it. */
async function tapBesideBoard(page: Page) {
	const stage = (await page.getByTestId('zen-stage').boundingBox())!;
	const block = (await page.locator('.zen-board').boundingBox())!;
	// Everything above the board block belongs to the stage. Asserted rather
	// than assumed: if the layout ever leaves no room there, this helper would
	// otherwise start clicking the board and the specs would fail somewhere
	// far from the cause.
	const gap = block.y - stage.y;
	expect(gap, 'zen leaves no space beside the board to tap').toBeGreaterThan(20);
	await page.mouse.click(stage.x + stage.width / 2, stage.y + gap / 2);
}

test('zen leaves the board and nothing else', async ({ page }) => {
	await page.goto('/');
	await page.getByTestId('settings-button').click();
	await page.getByTestId('settings-menu').getByLabel('Eval bar').check();
	await expect(page.getByTestId('eval-bar')).toBeVisible();
	await page.getByTestId('settings-menu').getByLabel('Zen mode').click();
	await expect(page.getByTestId('zen-stage')).toBeVisible();

	// The board survives, and so do the two things the mode is meant to keep:
	// the side labels and the pieces each side has lost.
	await expect(page.locator('cg-board')).toBeVisible();
	await expect(page.getByTestId('eliminated-white')).toBeVisible();
	await expect(page.getByTestId('eliminated-black')).toBeVisible();

	// Everything else, including the nav the settings menu itself lives in.
	await expect(page.getByRole('navigation')).toBeHidden();
	await expect(page.getByTestId('settings-button')).toBeHidden();
	await expect(page.getByTestId('moves-panel')).toBeHidden();
	await expect(page.getByTestId('hint-mode')).toBeHidden();
	await expect(page.getByTestId('eval-bar')).toBeHidden();
});

test('the controls are taught once, then fade — and a tap brings them back', async ({ page }) => {
	await page.goto('/');
	await enterZen(page);

	// Shown on entry: this is the only place the gesture is taught, so it
	// cannot start out of sight.
	const controls = page.getByTestId('zen-controls');
	await expect(controls).toHaveClass(/shown/);
	await waitForControlsToFade(page);

	await tapBesideBoard(page);
	await expect(controls).toHaveClass(/shown/);
	// Resign is absent until a move has been played — `session.started`, the
	// same condition the full screen's button carries. The other two are always
	// there, because starting over and getting out always apply.
	await expect(page.getByTestId('zen-new-game')).toBeVisible();
	await expect(page.getByTestId('zen-leave')).toBeVisible();

	// ...and the same tap puts them away again, without waiting out the timer.
	await tapBesideBoard(page);
	await expect(controls).not.toHaveClass(/shown/);
});

test('revealing the controls never moves the board', async ({ page }) => {
	await page.goto('/');
	await waitForEngineReady(page);
	await enterZen(page);
	await waitForControlsToFade(page);

	const board = page.locator('cg-board');
	const before = (await board.boundingBox())!;
	await tapBesideBoard(page);
	await expect(page.getByTestId('zen-controls')).toHaveClass(/shown/);
	const after = (await board.boundingBox())!;

	// chessground caches the board's viewport rectangle. If the strip took up
	// space only while shown, the board would shift under it and every click
	// after that would resolve to the square it used to be over — a failure
	// invisible except as moves that quietly don't happen.
	expect(after).toEqual(before);

	// So assert the consequence too, with the controls up. `move` retries and
	// fails loudly if chessground never accepts the clicks.
	const start = await boardPosition(page);
	await move(page, 'e2', 'e4');
	const played = await boardPosition(page);
	expect(played).not.toBe(start);
	await expect
		.poll(() => boardPosition(page), { message: 'the engine never replied in zen' })
		.not.toBe(played);
});

test('resigning from the strip ends the game on the board', async ({ page }) => {
	await page.goto('/');
	await waitForEngineReady(page);
	await move(page, 'e2', 'e4');
	await enterZen(page);

	// No tap needed: entering zen shows the strip, and it is still up.
	await expect(page.getByTestId('zen-controls')).toHaveClass(/shown/);
	await page.getByTestId('zen-resign').click();

	// The result overlay is drawn inside the board, so it is the one piece of
	// chrome zen keeps — and the strip pins itself open, since starting the
	// next game is now the only thing left to do.
	await expect(page.getByTestId('game-result-overlay')).toBeVisible();
	await expect(page.getByTestId('zen-controls')).toHaveClass(/shown/);
	await expect(page.getByTestId('zen-resign')).toBeHidden();
	await expect(page.getByTestId('zen-new-game')).toBeVisible();

	// Pinned, not lingering: nothing else on screen can start the next game.
	await page.waitForTimeout(6000);
	await expect(page.getByTestId('zen-controls')).toHaveClass(/shown/);

	await page.getByTestId('zen-new-game').click();
	await expect(page.getByTestId('game-result-overlay')).toBeHidden();
});

test('zen is left by the strip or by Escape, and survives a reload until then', async ({
	page
}) => {
	await page.goto('/');
	await enterZen(page);

	// The preference persists, which is what makes the way out matter.
	await page.reload();
	await expect(page.getByTestId('zen-stage')).toBeVisible();
	await expect(page.getByRole('navigation')).toBeHidden();

	await page.keyboard.press('Escape');
	await expect(page.getByTestId('zen-stage')).toBeHidden();
	await expect(page.getByRole('navigation')).toBeVisible();
	await expect(page.getByTestId('moves-panel')).toBeVisible();

	// Escape turned the setting off for good, not just this view of it.
	await page.reload();
	await expect(page.getByTestId('zen-stage')).toBeHidden();

	await enterZen(page);
	await page.getByTestId('zen-leave').click();
	await expect(page.getByTestId('zen-stage')).toBeHidden();
	await expect(page.getByRole('navigation')).toBeVisible();
});

test('zen belongs to Play alone', async ({ page }) => {
	await page.goto('/');
	await enterZen(page);

	// The other screens are reading screens with no way out of their own, so
	// hiding the nav on one would strand the visitor there.
	await page.goto('/puzzles');
	await expect(page.getByRole('navigation')).toBeVisible();
	await expect(page.getByTestId('zen-stage')).toBeHidden();

	// Still on, where it belongs.
	await page.goto('/');
	await expect(page.getByTestId('zen-stage')).toBeVisible();
});

test('the controls are reachable without a pointer', async ({ page }) => {
	await page.goto('/');
	await enterZen(page);
	await waitForControlsToFade(page);

	// Tapping beside the board is the whole gesture, and a keyboard cannot
	// make it. One Tab has to reach the way in.
	await page.keyboard.press('Tab');
	await expect(page.getByTestId('zen-reveal')).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('zen-controls')).toHaveClass(/shown/);

	// Hidden, the strip is inert — Tab must not stop on anything inside it.
	await tapBesideBoard(page);
	await expect(page.getByTestId('zen-controls')).not.toHaveClass(/shown/);
	await page.keyboard.press('Tab');
	await expect(page.getByTestId('zen-reveal')).toBeFocused();
	await page.keyboard.press('Tab');
	const focusInStrip = await page.evaluate(() => {
		const strip = document.querySelector('[data-testid="zen-controls"]');
		return !!strip && !!document.activeElement && strip.contains(document.activeElement);
	});
	expect(focusInStrip, 'Tab stopped inside the hidden strip').toBe(false);
});

test.describe('on a phone', () => {
	// iPhone-ish: the viewport zen has least room in, and the one where a
	// board sized against 100vh would run off the bottom of the screen.
	test.use({ viewport: { width: 390, height: 664 } });

	test('the whole board and both eliminated rows fit without scrolling', async ({ page }) => {
		await page.goto('/');
		await enterZen(page);

		const viewport = page.viewportSize()!;
		for (const testid of ['eliminated-black', 'eliminated-white']) {
			const row = (await page.getByTestId(testid).boundingBox())!;
			expect(row.y, `${testid} is off the top`).toBeGreaterThanOrEqual(0);
			expect(row.y + row.height, `${testid} is off the bottom`).toBeLessThanOrEqual(
				viewport.height
			);
		}

		const board = (await page.locator('cg-board').boundingBox())!;
		expect(board.y).toBeGreaterThanOrEqual(0);
		expect(board.y + board.height).toBeLessThanOrEqual(viewport.height);
		expect(Math.abs(board.height - board.width), 'the board is not square').toBeLessThan(2);
		// Worth playing on, rather than shrunk into a corner to make room.
		expect(board.width).toBeGreaterThan(viewport.width * 0.7);

		// The page itself must not scroll behind the stage.
		const scrollable = await page.evaluate(
			() => document.documentElement.scrollHeight > window.innerHeight + 1
		);
		expect(scrollable).toBe(false);

		// And the tap gesture still finds empty space at this size.
		await waitForControlsToFade(page);
		await tapBesideBoard(page);
		await expect(page.getByTestId('zen-controls')).toHaveClass(/shown/);
	});
});
