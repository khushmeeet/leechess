import { expect, test, type Page } from '@playwright/test';
import { move, waitForEngineReady } from './helpers';

// There is nothing to hear from a test runner, so count started sample sources
// and separately assert that the event-specific recordings were requested.

async function countKnocks(page: Page) {
	await page.addInitScript(() => {
		const target = window as unknown as { AudioContext: typeof AudioContext; __knocks: number };
		target.__knocks = 0;
		const Real = target.AudioContext;
		target.AudioContext = class extends Real {
			createBufferSource() {
				const source = super.createBufferSource();
				const start = source.start.bind(source);
				source.start = (when?: number) => {
					target.__knocks += 1;
					start(when);
				};
				return source;
			}
		};
	});
}

const knocks = (page: Page) =>
	page.evaluate(() => (window as unknown as { __knocks: number }).__knocks);

test('a played move makes a sound, and the engine answers with one', async ({ page }) => {
	const errors: string[] = [];
	const soundRequests: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('request', (request) => {
		if (request.url().includes('/sounds/')) soundRequests.push(request.url());
	});

	await countKnocks(page);
	await page.goto('/');
	await waitForEngineReady(page);
	await expect.poll(() => soundRequests.some((url) => url.endsWith('/game-start.mp3'))).toBe(true);

	await move(page, 'e2', 'e4');
	await expect.poll(() => knocks(page)).toBeGreaterThanOrEqual(1);
	await expect.poll(() => soundRequests.some((url) => url.endsWith('/move-self.mp3'))).toBe(true);
	// the engine's reply lands on the board, so it lands in the speakers too
	await expect
		.poll(() => soundRequests.some((url) => url.endsWith('/move-opponent.mp3')), {
			timeout: 15_000
		})
		.toBe(true);

	expect(errors).toEqual([]);
});

test('muting game sounds silences the board', async ({ page }) => {
	await countKnocks(page);
	await page.goto('/');
	await waitForEngineReady(page);

	await page.getByTestId('settings-button').click();
	await page.getByTestId('settings-menu').getByLabel('Game sounds').uncheck();
	await page.keyboard.press('Escape');
	const beforeMove = await knocks(page);

	await move(page, 'e2', 'e4');
	await expect(page.getByTestId('move-badge')).toBeVisible({ timeout: 5_000 });
	expect(await knocks(page)).toBe(beforeMove);
});
