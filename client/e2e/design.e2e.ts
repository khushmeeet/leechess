import { expect, test } from './fixtures';
import { hungQueenSans, move, seedGame, waitForAnalysis, waitForEngineReady } from './helpers';

async function expectNoOverflow(page: import('@playwright/test').Page) {
	const overflow = await page.evaluate(() => ({
		width: document.documentElement.scrollWidth,
		viewport: window.innerWidth,
		elements: [...document.querySelectorAll('main *')]
			.filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
			.slice(0, 8)
			.map((el) => ({
				tag: el.tagName,
				class: el.className,
				width: el.getBoundingClientRect().width
			}))
	}));
	expect(overflow.width, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport);
}

test('the study remains navigable at phone widths, including settings', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 320, height: 740 });
	await page.goto('/');
	await expect(page.locator('cg-board')).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
	await expectNoOverflow(page);
	for (const label of ['Review', 'Puzzles', 'Endgames', 'Progress', 'Literature', 'Play']) {
		const link = page
			.getByRole('navigation', { name: 'Main navigation' })
			.getByRole('link', { name: label, exact: true });
		await link.click();
		await expect(link).toHaveAttribute('aria-current', 'page');
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		await expectNoOverflow(page);
	}
	await page.getByTestId('settings-button').click();
	await expect(page.getByTestId('settings-menu')).toBeVisible();
	await page.getByTestId('eval-bar-toggle').check();
	await page.getByTestId('settings-button').click();
	await expect(page.getByTestId('eval-bar')).toBeVisible();
	await expectNoOverflow(page);
});

test('theme and board choices survive navigation and reload', async ({ page }, testInfo) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.goto('/');
	await expect(page.locator('cg-board')).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
	await expect(page.locator('cg-board')).toBeInViewport({ ratio: 1 });
	await expect(page.getByRole('button', { name: 'New game', exact: true })).toBeInViewport({
		ratio: 1
	});
	await page.screenshot({ path: testInfo.outputPath('play.png'), fullPage: true });
	await page.getByTestId('settings-button').click();
	await page.screenshot({
		path: testInfo.outputPath('settings.png'),
		fullPage: true,
		animations: 'disabled'
	});
	await page
		.getByRole('group', { name: 'Theme', exact: true })
		.getByRole('button', { name: 'Dark', exact: true })
		.click();
	await page
		.getByTestId('settings-menu')
		.getByRole('button', { name: 'Walnut', exact: true })
		.click();
	await page.getByTestId('settings-button').click();
	await page
		.getByRole('navigation', { name: 'Main navigation' })
		.getByRole('link', { name: 'Endgames' })
		.click();
	await expect(page.locator('html')).toHaveClass(/dark/);
	await expect(page.getByTestId('drill-heading')).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath('dark.png'), fullPage: true });
	await page.reload();
	await page.getByTestId('settings-button').click();
	await expect(
		page
			.getByRole('group', { name: 'Theme', exact: true })
			.getByRole('button', { name: 'Dark', exact: true })
	).toHaveAttribute('aria-pressed', 'true');
	await expect(
		page.getByTestId('settings-menu').getByRole('button', { name: 'Walnut', exact: true })
	).toHaveAttribute('aria-pressed', 'true');
});

test('settings returns keyboard focus to its trigger, including with reduced motion', async ({
	page
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto('/');
	const trigger = page.getByTestId('settings-button');
	await trigger.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('settings-menu')).toBeVisible();
	await page.keyboard.press('Tab');
	await expect(page.getByRole('textbox', { name: 'Username' })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('settings-menu')).toBeHidden();
	await expect(trigger).toBeFocused();
});

test('the move ledger marks the latest reply and keeps the board usable', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.goto('/');
	await waitForEngineReady(page);
	await move(page, 'e2', 'e4');
	await expect(page.getByTestId('moves-panel')).toContainText('white to move');
	const latestReply = page.getByTestId('move-list').locator('li:last-child > span:last-child');
	await expect(latestReply).toHaveClass(/latest-move/);
	await expect(latestReply).not.toBeEmpty();
	await expect(page.locator('.latest-move')).toHaveCount(1);
	await expect(page.getByTestId('eliminated-white').locator('.side-label')).toContainText(
		'to move'
	);
	await page.screenshot({
		path: testInfo.outputPath('practice-in-play.png'),
		fullPage: true,
		animations: 'disabled'
	});
});

test('review detail keeps Review marked as the current navigation destination', async ({
	page,
	request
}, testInfo) => {
	const id = await seedGame(request, hungQueenSans);
	await waitForAnalysis(request, id);
	await page.goto(`/review/${id}`);
	await expect(
		page
			.getByRole('navigation', { name: 'Main navigation' })
			.getByRole('link', { name: 'Review', exact: true })
	).toHaveAttribute('aria-current', 'page');
	await expect(page.locator('cg-board')).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath('review.png'), fullPage: true });
	await page.goto('/progress');
	await expect(page.getByTestId('cpl-trend')).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath('progress.png'), fullPage: true });
});

test.describe('signed-out study', () => {
	test.use({ signedIn: false });
	test('welcome and account gates reflow, with a keyboard path into the content', async ({
		page
	}, testInfo) => {
		await page.setViewportSize({ width: 1366, height: 768 });
		await page.goto('/welcome');
		await expect(page.getByTestId('welcome-play')).toBeVisible();
		await page.evaluate(() => document.fonts.ready);
		await page.screenshot({ path: testInfo.outputPath('welcome.png'), fullPage: true });
		await page.keyboard.press('Tab');
		await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
		await page.setViewportSize({ width: 390, height: 844 });
		await expectNoOverflow(page);
		await page.getByTestId('welcome-play').click();
		await page
			.getByRole('navigation', { name: 'Main navigation' })
			.getByRole('link', { name: 'Review' })
			.click();
		await expect(page.getByTestId('account-gate')).toBeVisible();
		await expectNoOverflow(page);
		await page.getByTestId('gate-sign-up').click();
		await expect(page.getByTestId('auth-username')).toBeVisible();
		await expectNoOverflow(page);
	});
});
