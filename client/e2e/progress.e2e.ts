import { expect, test } from '@playwright/test';
import { API, hungQueenSans, seedGame, waitForAnalysis } from './helpers';

// Phase 4 Progress screen. Seeds through the API (a real analyzed game +
// puzzle attempts) rather than playing via the UI — faster and deterministic
// for a data-heavy screen. Never assumes WHICH puzzle the queue serves;
// assertions key off the /puzzles/next response.

test('progress screen renders seeded aggregates and drills into the weakest motif', async ({
	page,
	request
}) => {
	// One analyzed game feeds the CPL trend and queues a personal puzzle.
	const gameId = await seedGame(request, hungQueenSans);
	await waitForAnalysis(request, gameId);

	// Three attempts on one puzzle so its motif clears the weakest-motif
	// callout's minimum-sample gate (and 1/3 correct keeps it weak).
	const puzzle = await (await request.get(`${API}/puzzles/next`)).json();
	for (const correct of [false, false, true]) {
		const response = await request.post(`${API}/puzzles/${puzzle.id}/attempt`, {
			data: { correct }
		});
		expect(response.ok()).toBe(true);
	}
	const motifLabel: string = puzzle.motif.replaceAll('_', ' ');

	await page.goto('/progress');

	// streak/solved stat tiles (game + attempts happened today → streak ≥ 1)
	await expect(page.getByTestId('streaks')).toContainText('day streak');
	await expect(page.getByTestId('streaks')).toContainText('puzzles solved');

	// motif chart shows the attempted motif's row with its counts
	await expect(page.getByTestId('motif-chart')).toContainText(motifLabel);
	await expect(page.getByTestId('motif-chart')).toContainText('/');

	// CPL trend renders, and its table view includes the seeded game
	await expect(page.getByTestId('cpl-trend')).toBeVisible();
	await page.getByText('View as table').click();
	await expect(page.getByRole('cell', { name: `#${gameId}` })).toBeVisible();

	// weakest-motif callout → filtered puzzle drill
	const drillLink = page.getByTestId('weakest-motif-link').filter({ hasText: motifLabel }).first();
	await expect(drillLink).toBeVisible();
	await drillLink.click();
	await expect(page).toHaveURL(new RegExp(`/puzzles\\?motif=${puzzle.motif}`));
	await expect(page.getByRole('heading', { name: /Puzzles/ })).toContainText(motifLabel);
});
