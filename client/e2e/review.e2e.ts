import { expect, test, type APIRequestContext } from '@playwright/test';
import { API, scholarsMateSans } from './helpers';

// Phase 1 Review screen: a completed game's analysis job runs end-to-end
// (real Stockfish, low depth via LEECHESS_ANALYSIS_DEPTH in the e2e server),
// and the Review UI renders classifications, CPL graph, and best-move info.

/** Seed a finished game through the live-game API — deterministic and much
 * faster than driving the board UI again (play.e2e.ts covers that). */
async function seedCompletedGame(request: APIRequestContext): Promise<number> {
	const created = await request.post(`${API}/games`, { data: { mode: 'local' } });
	expect(created.ok()).toBe(true);
	const gameId = (await created.json()).id;
	for (const san of scholarsMateSans) {
		const response = await request.post(`${API}/games/${gameId}/moves`, { data: { san } });
		expect(response.ok()).toBe(true);
	}
	const completed = await request.post(`${API}/games/${gameId}/complete`, { data: {} });
	expect(completed.ok()).toBe(true);
	return gameId;
}

test('completed game gets analyzed and reviewed', async ({ page, request }) => {
	const gameId = await seedCompletedGame(request);

	await page.goto(`/review/${gameId}`);
	await expect(page.getByText(`Game #${gameId}`)).toBeVisible();

	// the page polls while the job runs; wait for the analysis to land
	await expect
		.poll(
			async () => {
				const response = await request.get(`${API}/games/${gameId}/review`);
				return (await response.json()).analysis_status;
			},
			{ timeout: 60_000 }
		)
		.toBe('complete');
	await expect(page.getByTestId('analysis-status')).toBeHidden({ timeout: 10_000 });

	// move list renders every ply with classifications
	const moveList = page.getByTestId('move-list');
	await expect(moveList).toContainText('Qxf7#');
	// 6…Nf6 hangs mate in one — must be classified a blunder
	await expect(moveList.locator('[title="blunder"]').first()).toBeVisible();

	// CPL graph + per-side summary render from the same data
	await expect(page.getByTestId('cpl-graph')).toBeVisible();
	await expect(page.getByTestId('game-summary')).toBeVisible();

	// click-to-jump: select the blunder and see played-vs-best feedback
	await moveList.getByRole('button', { name: /Nf6/ }).click();
	await expect(page.getByTestId('selected-move')).toContainText('Nf6');
	await expect(page.getByTestId('best-move-hint')).toBeVisible();
	await expect(page.getByTestId('best-move-hint')).toContainText('best was');
});

test('motif tags render on flagged moves', async ({ page, request }) => {
	// Phase 2: 3.Qxe5+?? hangs the queen to 3...Nxe5 — a deterministic
	// hanging_piece tag at any depth. Same scripted game as the backend's
	// test_analysis_job.py / test_motifs.py, so both suites exercise
	// identical data.
	const created = await request.post(`${API}/games`, { data: { mode: 'local' } });
	const gameId = (await created.json()).id;
	for (const san of ['e4', 'e5', 'Qh5', 'Nc6', 'Qxe5+', 'Nxe5']) {
		const response = await request.post(`${API}/games/${gameId}/moves`, { data: { san } });
		expect(response.ok()).toBe(true);
	}
	await request.post(`${API}/games/${gameId}/complete`, { data: { result: '0-1' } });

	await page.goto(`/review/${gameId}`);
	await expect
		.poll(
			async () => {
				const response = await request.get(`${API}/games/${gameId}/review`);
				return (await response.json()).analysis_status;
			},
			{ timeout: 60_000 }
		)
		.toBe('complete');

	// select the blunder; its chip names the tactic it allowed
	await page.getByTestId('move-list').getByRole('button', { name: /Qxe5/ }).click();
	await expect(page.getByTestId('motif-tags')).toBeVisible();
	await expect(page.getByTestId('motif-tags')).toContainText('hanging piece');

	// Phase 3: "practice these misses" makes this game's puzzle due now
	await page.getByTestId('practice-misses').click();
	await expect(page.getByTestId('practice-result')).toContainText('1 puzzle queued');
});

test('review shows analyzing state while the job is pending', async ({ page, request }) => {
	// a fresh in-progress game reviewed directly shows the raw moves and no crash
	const created = await request.post(`${API}/games`, { data: { mode: 'local' } });
	const gameId = (await created.json()).id;
	await request.post(`${API}/games/${gameId}/moves`, { data: { san: 'e4' } });

	await page.goto(`/review/${gameId}`);
	await expect(page.getByText(`Game #${gameId}`)).toBeVisible();
	await expect(page.getByTestId('analysis-status')).toBeVisible();
	await expect(page.getByTestId('move-list')).toContainText('e4');
});
