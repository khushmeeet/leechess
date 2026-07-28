import { expect, test } from './fixtures';
import { API, hungQueenSans, scholarsMateSans, seedGame, waitForAnalysis } from './helpers';

// Phase 4 Progress screen. Seeds through the API (a real analyzed game +
// puzzle attempts) rather than playing via the UI — faster and deterministic
// for a data-heavy screen. The database is emptied before each test
// (e2e/fixtures.ts), so the games and attempts on screen are exactly the ones
// seeded here.

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
	// endgame drills are training too — the tile links through to them
	await expect(page.getByTestId('drills-passed')).toContainText('endgames drilled');
	await expect(page.getByTestId('drills-passed')).toHaveAttribute('href', '/endgames');

	// motif chart shows the attempted motif's row with its counts
	await expect(page.getByTestId('motif-chart')).toContainText(motifLabel);
	await expect(page.getByTestId('motif-chart')).toContainText('/');

	// CPL trend renders, and its table view includes the seeded game
	await expect(page.getByTestId('cpl-trend')).toBeVisible();

	// with one game charted, the nearest point is that game wherever the
	// pointer goes
	await page.getByTestId('cpl-trend').hover();
	await expect(page.getByTestId('cpl-tooltip')).toContainText(`Game #${gameId}`);

	// legend entries isolate one phase and toggle back off; "Overall" is the one
	// series every analyzed game has
	const isolate = page.getByRole('button', { name: 'Overall' });
	await expect(isolate).toHaveAttribute('aria-pressed', 'false');
	await isolate.click();
	await expect(isolate).toHaveAttribute('aria-pressed', 'true');
	await isolate.click();
	await expect(isolate).toHaveAttribute('aria-pressed', 'false');

	await page.getByText('View as table').click();
	await expect(page.getByRole('cell', { name: `#${gameId}` })).toBeVisible();

	// weakest-motif callout → filtered puzzle drill
	const drillLink = page.getByTestId('weakest-motif-link').filter({ hasText: motifLabel }).first();
	await expect(drillLink).toBeVisible();
	await drillLink.click();
	await expect(page).toHaveURL(new RegExp(`/puzzles\\?motif=${puzzle.motif}`));
	await expect(page.getByRole('heading', { name: /Puzzles/ })).toContainText(motifLabel);
});

test('the CPL tooltip reads out the point nearest the pointer, not the newest game', async ({
	page,
	request
}) => {
	// Two games, so "nearest" is a claim about where the pointer is rather
	// than a coincidence. Hovering anywhere and expecting the newest game is
	// what the previous version of this assertion did — it passed only while
	// the chart had one point, and reported the wrong game the moment earlier
	// specs had left others behind.
	const oldest = await seedGame(request, hungQueenSans);
	await waitForAnalysis(request, oldest);
	const newest = await seedGame(request, scholarsMateSans, '1-0');
	await waitForAnalysis(request, newest);

	await page.goto('/progress');
	const chart = page.getByTestId('cpl-trend');
	await expect(chart).toBeVisible();
	const box = (await chart.boundingBox())!;
	const midY = box.y + box.height / 2;

	// the chart plots games oldest-first, left to right
	await page.mouse.move(box.x + box.width * 0.02, midY);
	await expect(page.getByTestId('cpl-tooltip')).toContainText(`Game #${oldest}`);

	await page.mouse.move(box.x + box.width * 0.98, midY);
	await expect(page.getByTestId('cpl-tooltip')).toContainText(`Game #${newest}`);

	// and back again, so this cannot pass on a tooltip that simply never
	// changes after the first hover
	await page.mouse.move(box.x + box.width * 0.02, midY);
	await expect(page.getByTestId('cpl-tooltip')).toContainText(`Game #${oldest}`);
});
