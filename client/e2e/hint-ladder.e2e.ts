import { expect, test } from './fixtures';
import { Chess } from 'chess.js';
import { HUNG_QUEEN, seedHungQueenPuzzle } from './helpers';

// Phase 3: the shared HintLadder's full Levels 1-5, tested once against the
// Puzzles screen (simplest context — Play reuses the same component).
//
// This used to say it was deterministic because it "runs first
// alphabetically", which is not a contract any runner offers — rename a file
// and the queue serves something else. It now seeds its own puzzle into a
// database emptied by e2e/fixtures.ts, so the position is the same whenever
// and in whatever order this spec runs.

test('hint ladder reveals one level at a time and never resets', async ({ page, request }) => {
	const { puzzle } = await seedHungQueenPuzzle(request);

	const chess = new Chess(puzzle.fen);
	const solutionSans = puzzle.solution.map((uci: string) => {
		return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
	});
	expect(solutionSans).toEqual(['Nxe5']);

	await page.goto('/puzzles');
	await expect(page.getByTestId('puzzle-heading')).toContainText(`Puzzle #${puzzle.id}`);

	// no ladder rung revealed yet
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
	await expect(page.getByTestId('hint-level-2')).toContainText(
		HUNG_QUEEN.motif.replaceAll('_', ' ')
	);
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
