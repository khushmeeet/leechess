import { expect, test } from '@playwright/test';
import { Chess } from 'chess.js';
import { API, hungQueenSans, seedGame, waitForAnalysis } from './helpers';

// Phase 3: the shared HintLadder's full Levels 1-5, tested once against the
// Puzzles screen (simplest context — Play reuses the same component). This
// spec runs first alphabetically, so the seeded hung-queen puzzle is the
// only one in the queue and every assertion is deterministic.

test('hint ladder reveals one level at a time and never resets', async ({ page, request }) => {
	const gameId = await seedGame(request, hungQueenSans);
	await waitForAnalysis(request, gameId);

	// /puzzles/next is read-only — the UI is about to load this same puzzle
	const puzzle = await (await request.get(`${API}/puzzles/next`)).json();
	const chess = new Chess(puzzle.fen);
	const solutionSans = puzzle.solution.map((uci: string) => {
		return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
	});

	await page.goto('/puzzles');
	await expect(page.getByTestId('puzzle-heading')).toContainText(`Puzzle #${puzzle.id}`);

	// Level 0: the nudge is up, no ladder rung revealed yet
	await expect(page.getByText('Checks, captures, threats?')).toBeVisible();
	for (const level of [1, 2, 3, 4, 5]) {
		await expect(page.getByTestId(`hint-level-${level}`)).toBeHidden();
	}

	const reveal = page.getByTestId('hint-reveal');

	// Level 1 — category, nothing more
	await reveal.click();
	await expect(page.getByTestId('hint-level-1')).toContainText('tactic');
	await expect(page.getByTestId('hint-level-2')).toBeHidden();

	// Level 2 — motif name; level 1 stays visible (no skip, no reset)
	await reveal.click();
	await expect(page.getByTestId('hint-level-2')).toContainText(puzzle.motif.replaceAll('_', ' '));
	await expect(page.getByTestId('hint-level-1')).toBeVisible();

	// Level 3 — squares highlighted on the board, move still hidden
	await reveal.click();
	await expect(page.getByTestId('hint-level-3')).toBeVisible();
	await expect(page.locator('.cg-shapes circle').first()).toBeVisible();
	await expect(page.getByTestId('hint-level-4')).toBeHidden();

	// Level 4 — the move plus a one-line reason
	await reveal.click();
	await expect(page.getByTestId('hint-level-4')).toContainText(solutionSans[0]);

	// Level 5 — full line; the ladder is exhausted
	await reveal.click();
	await expect(page.getByTestId('hint-level-5')).toContainText(solutionSans.join(' '));
	await expect(reveal).toBeHidden();

	// all earlier rungs still shown
	for (const level of [1, 2, 3, 4]) {
		await expect(page.getByTestId(`hint-level-${level}`)).toBeVisible();
	}
});
