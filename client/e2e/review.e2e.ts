import { type APIRequestContext } from '@playwright/test';
import { expect, test } from './fixtures';
import {
	API,
	boardPosition,
	gameNumber,
	move,
	scholarsMateSans,
	seedGame,
	waitForAnalysis
} from './helpers';

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
	// the account's first saved game, whatever row id it landed on
	await expect(page.getByText(`Game #${await gameNumber(request, gameId)}`)).toBeVisible();

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

test('a grade the deeper check changed says so, with what Play showed', async ({
	page,
	request
}) => {
	// Scholar's Mate as Play would send it, with 3…Nf6?? (ply 6) graded only
	// an inaccuracy live — it hangs mate in one, so the analysis job's grade
	// is a blunder at any depth.
	const created = await request.post(`${API}/games`, { data: { mode: 'local' } });
	const gameId = (await created.json()).id;
	for (const san of scholarsMateSans) {
		await request.post(`${API}/games/${gameId}/moves`, { data: { san } });
	}
	const live = [
		{ ply: 5, eval_after: -20, classification: null },
		{ ply: 6, eval_after: 20, classification: 'inaccuracy' },
		{ ply: 4, eval_after: 30, classification: 'book' }
	];
	const completed = await request.post(`${API}/games/${gameId}/complete`, {
		data: { live }
	});
	expect(completed.ok()).toBe(true);
	await waitForAnalysis(request, gameId);

	await page.goto(`/review/${gameId}`);
	await page.getByTestId('move-list').getByRole('button', { name: /Nf6/ }).click();
	const note = page.getByTestId('review-grade-change');
	await expect(note).toContainText(
		'Play’s quick check called Nf6 an inaccuracy (4 points of winning chances lost)'
	);
	await expect(note).toContainText('The deeper check after the game sees more: it is a blunder');

	// a move both checks agree on has no note
	await page.getByTestId('move-list').getByRole('button', { name: /Nc6/ }).click();
	await expect(page.getByTestId('selected-move')).toContainText('Nc6');
	await expect(note).toBeHidden();
});

test('each move shows the threat it had to answer, and whether it did', async ({
	page,
	request
}) => {
	const gameId = await seedCompletedGame(request);
	await page.goto(`/review/${gameId}`);
	await expect
		.poll(
			async () =>
				(await (await request.get(`${API}/games/${gameId}/review`)).json()).analysis_status,
			{ timeout: 60_000 }
		)
		.toBe('complete');
	await expect(page.getByTestId('analysis-status')).toBeHidden({ timeout: 10_000 });

	// 3.Qh5 threatened mate, and 3…Nf6 walked past it
	const moveList = page.getByTestId('move-list');
	await moveList.getByRole('button', { name: /Nf6/ }).click();
	await expect(page.getByTestId('review-threat-text')).toHaveText(
		'White threatens Qxf7#, checkmate.'
	);
	await expect(page.getByTestId('review-threat-ignored')).toContainText('Nf6 left it on the board');
	await expect(page.locator('.cg-shapes line[stroke="#e68f00"]')).toHaveCount(1);

	// the opening move faced nothing, and says nothing
	await moveList.getByRole('button', { name: /^e4/ }).click();
	await expect(page.getByTestId('review-threat')).toBeHidden();
});

test('arrow keys step through the game and yield to text fields', async ({ page, request }) => {
	const gameId = await seedCompletedGame(request);

	// navigation works off the raw move list — no need to wait for analysis
	await page.goto(`/review/${gameId}`);
	const selected = page.getByTestId('selected-move');
	await expect(selected).toContainText('e4');

	// ← / → scrub like the Prev/Next buttons
	await page.keyboard.press('ArrowRight');
	await expect(selected).toContainText('e5');
	await page.keyboard.press('ArrowLeft');
	await expect(selected).toContainText('e4');

	// Home/End jump to the ends (scholar's mate finishes on Qxf7#)
	await page.keyboard.press('End');
	await expect(selected).toContainText('Qxf7#');
	await page.keyboard.press('Home');
	await expect(selected).toContainText('e4');

	// the layout mounts Settings on every page: arrows typed into its username
	// field must move the caret, not the board
	await page.getByTestId('settings-button').click();
	const username = page.getByTestId('username-setting-input');
	await username.fill('ada');
	await username.press('ArrowLeft');
	await expect(selected).toContainText('e4');
	expect(await username.evaluate((el) => (el as HTMLInputElement).selectionStart)).toBe(2);
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
	// Unfinished, so it is not one of the account's games yet and has no
	// number to be shown under.
	await expect(page.getByRole('heading', { name: 'Unfinished game' })).toBeVisible();
	await expect(page.getByTestId('analysis-status')).toBeVisible();
	await expect(page.getByTestId('move-list')).toContainText('e4');
});

test('board shows each color’s eliminated pieces on its side', async ({ page, request }) => {
	const created = await request.post(`${API}/games`, { data: { mode: 'local' } });
	const gameId = (await created.json()).id;
	for (const san of ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3']) {
		const response = await request.post(`${API}/games/${gameId}/moves`, { data: { san } });
		expect(response.ok()).toBe(true);
	}

	await page.goto(`/review/${gameId}`);
	await page.getByTestId('move-list').getByRole('button', { name: 'Nc3' }).click();

	const rows = page.locator('[data-testid^="eliminated-"]');
	await expect(rows.first()).toHaveAttribute('data-testid', 'eliminated-black');
	await expect(rows.last()).toHaveAttribute('data-testid', 'eliminated-white');
	await expect(page.getByTestId('eliminated-black').locator('piece.pawn.black')).toHaveCount(1);
	await expect(page.getByTestId('eliminated-white').locator('piece.pawn.white')).toHaveCount(1);
});

test('the lines from a move can be stepped through, and a move of your own weighed', async ({
	page,
	request
}) => {
	const gameId = await seedCompletedGame(request);
	await expect
		.poll(
			async () =>
				(await (await request.get(`${API}/games/${gameId}/review`)).json()).analysis_status,
			{
				timeout: 60_000
			}
		)
		.toBe('complete');

	// 3…Nf6?? — the move that let Qxf7# in
	await page.goto(`/review/${gameId}?ply=6`);
	await expect(page.getByTestId('selected-move')).toContainText('Nf6');
	await expect(page.getByTestId('review-chances')).toContainText('Black’s winning chances');
	await expect(page.getByTestId('review-chances')).toContainText('→ 0%'); // mated
	await expect(page.getByTestId('engine-line').getByTestId('line-move').first()).toBeVisible();
	const played = page.getByTestId('played-line').getByTestId('line-move');
	await expect(played).toHaveText(['Nf6', 'Qxf7#']);

	// a move of the line puts its position on the board, and back again
	const decision = await boardPosition(page);
	await played.nth(1).click();
	await expect(played.nth(1)).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => boardPosition(page)).not.toBe(decision);
	await page.getByTestId('preview-exit').click();
	await expect.poll(() => boardPosition(page)).toBe(decision);

	// "what if": …g6 shuts the queen out, and the engine weighs it
	await page.getByTestId('explore-start').click();
	await expect(page.getByTestId('explore-panel')).toBeVisible();
	await move(page, 'g7', 'g6');
	await expect(page.getByTestId('explore-moves')).toContainText('g6');
	const verdict = page.getByTestId('explore-verdict');
	await expect(verdict).toContainText('Black’s winning chances', { timeout: 30_000 });
	await expect(verdict).toContainText('in the game, Nf6 left 0%');
	await expect(page.getByTestId('explore-answer').getByTestId('line-move').first()).toBeVisible();

	await page.getByTestId('explore-undo').click();
	await expect(page.getByTestId('explore-moves')).toBeHidden();
	await page.getByTestId('explore-exit').click();
	await expect(page.getByTestId('review-lines')).toBeVisible();
	await expect.poll(() => boardPosition(page)).toBe(decision);
});

test('a move’s position ideas are named: a backward pawn made, an outpost taken', async ({
	page,
	request
}) => {
	// Najdorf: 6…e5 leaves d6 backward, and 10.Nd5 puts a knight on the hole
	const najdorf = [
		'e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6',
		'Be2', 'e5', 'Nb3', 'Be7', 'O-O', 'O-O', 'Be3', 'Be6', 'Nd5'
	]; // prettier-ignore
	const gameId = await seedGame(request, najdorf, '*');
	await waitForAnalysis(request, gameId);

	const position = page.getByTestId('review-position');
	await page.goto(`/review/${gameId}?ply=12`);
	await expect(page.getByTestId('selected-move')).toContainText('e5');
	await expect(position).toHaveText(/e5 leaves Black with a backward pawn on d6\./);

	await page.goto(`/review/${gameId}?ply=19`);
	await expect(page.getByTestId('selected-move')).toContainText('Nd5');
	await expect(position).toContainText(
		'Nd5 puts White’s knight on an outpost: the e4 pawn guards d5, and no Black pawn can chase it away.'
	);

	// a move that changes none of it says nothing
	await page.goto(`/review/${gameId}?ply=14`);
	await expect(page.getByTestId('selected-move')).toContainText('Be7');
	await expect(position).toBeHidden();

	// the Structure overlay marks the hole and the weak pawn on the board
	await page.getByTestId('overlay-structure').click();
	await expect(page.locator('cg-board square.ov-weak-pawn').first()).toBeAttached();
	await expect(page.locator('cg-board square.ov-outpost-w').first()).toBeAttached();
});
