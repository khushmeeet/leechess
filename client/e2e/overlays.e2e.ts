import { expect, test } from './fixtures';
import { clickSquare, restoreActiveGame, waitForEngineReady } from './helpers';

// Board overlays: each a way of looking at the position, switched on from
// chips beside the board, persisted, and — being help — absent in Off.

/** Black has just played …Qh4, where the knight on f3 takes it for free. */
async function restoreHangingQueen(page: import('@playwright/test').Page) {
	await restoreActiveGame(page, { moves: ['e2e4', 'e7e5', 'g1f3', 'd8h4'] });
}

test('loose pieces and control show on the board, and survive a reload', async ({ page }) => {
	await restoreHangingQueen(page);
	await page.goto('/');
	await waitForEngineReady(page);
	await page.getByTestId('hint-mode-full').click();

	const hanging = page.locator('cg-board square.ov-hanging');
	await expect(hanging).toHaveCount(0);
	await page.getByTestId('overlay-loose').click();
	await expect(page.getByTestId('overlay-loose')).toHaveAttribute('aria-pressed', 'true');
	// the queen on h4 (Nxh4), the e5 pawn (Nxe5) and the e4 pawn (…Qxe4+)
	await expect(hanging).toHaveCount(3);

	await page.getByTestId('overlay-control').click();
	await expect(page.locator('cg-board square.ov-control-w').first()).toBeAttached();

	await page.reload();
	await waitForEngineReady(page);
	await expect(page.getByTestId('overlay-loose')).toHaveAttribute('aria-pressed', 'true');
	await expect(hanging).toHaveCount(3);

	// Off is a real game: no overlays, and no chips to turn them on
	await page.getByTestId('hint-mode-off').click();
	await expect(page.getByTestId('overlay-toggles')).toBeHidden();
	await expect(hanging).toHaveCount(0);
});

test('a pin is drawn from the pinning piece to the king', async ({ page }) => {
	// 3.Bb5 d6: the knight on c6 now shields the king on e8 from the bishop
	await restoreActiveGame(page, {
		moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'd7d6']
	});
	await page.goto('/');
	await waitForEngineReady(page);
	await page.getByTestId('hint-mode-full').click();
	await page.getByTestId('overlay-pins').click();
	await expect(page.locator('cg-board square.ov-pinned')).toHaveCount(1);
	await expect(page.locator('.cg-shapes line[stroke="#68217a"]')).toHaveCount(1);
});

test('overlays never hide the dots that show where a piece can go', async ({ page }) => {
	// 1.e4 d5 2.exd5: White has no e-pawn, so the e-file is half-open — the
	// Files overlay stripes it, and the knight on g1 can go to e2
	await restoreActiveGame(page, { moves: ['e2e4', 'd7d5', 'e4d5', 'g8f6'] });
	await page.goto('/');
	await waitForEngineReady(page);
	await page.getByTestId('hint-mode-full').click();
	for (const overlay of ['files', 'control', 'king']) {
		await page.getByTestId(`overlay-${overlay}`).click();
	}

	await clickSquare(page, 'g1');
	await expect(page.locator('cg-board square.move-dest').first()).toBeAttached();
	// every destination still paints its dot (a radial gradient), stripe or not
	const backgrounds = await page.locator('cg-board square.move-dest').evaluateAll((squares) =>
		squares.map((square) => ({
			key: (square as HTMLElement & { cgKey?: string }).cgKey,
			image: getComputedStyle(square).backgroundImage
		}))
	);
	expect(backgrounds.map((square) => square.key).sort()).toEqual(['e2', 'f3', 'h3']);
	for (const square of backgrounds) expect(square.image, square.key).toContain('radial-gradient');
});
