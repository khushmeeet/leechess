import { type APIRequestContext, type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
	API,
	HUNG_QUEEN,
	clickSquares,
	move,
	moveUntil,
	seedHungQueenPuzzle,
	seedSecondPuzzle
} from './helpers';

// Phase 3 Puzzles screen: solve flows + attempt recording.
//
// Every test starts from an empty database (e2e/fixtures.ts) and seeds the
// puzzle it needs, so the position, the side to move, the solution and a
// deliberately wrong move are all known up front. The specs used to read
// /puzzles/next and derive everything from whatever came back, because earlier
// specs left due puzzles behind — which meant the wrong-move test could pick a
// different move (or a different puzzle, with a different side to move) from
// run to run, and nobody could say what it had exercised.

async function attemptCount(request: APIRequestContext, puzzleId: number): Promise<number> {
	const response = await request.get(`${API}/puzzles/${puzzleId}`);
	return (await response.json()).attempts.length;
}

/** Play the solver's moves of the solution; scripted opponent replies
 * auto-play in between. */
async function playSolution(page: Page, puzzle: { fen: string; solution: string[] }) {
	const orientation = puzzle.fen.split(' ')[1] === 'b' ? 'black' : 'white';
	for (let i = 0; i < puzzle.solution.length; i += 2) {
		const uci = puzzle.solution[i];
		await move(page, uci.slice(0, 2), uci.slice(2, 4), orientation);
	}
}

test('solving a puzzle records a correct attempt and advances the box', async ({
	page,
	request
}) => {
	const { puzzle } = await seedHungQueenPuzzle(request);
	const secondPuzzleId = await seedSecondPuzzle(request, puzzle.id);

	await page.goto('/puzzles');
	await expect(page.getByTestId('puzzle-heading')).toContainText(`Puzzle #${puzzle.id}`);
	await expect(page.getByTestId('puzzle-turn')).toContainText(HUNG_QUEEN.orientation);

	await playSolution(page, puzzle);
	await expect(page.getByTestId('puzzle-correct')).toBeVisible();

	// the attempt lands (fire-and-forget from the UI, so poll)
	await expect.poll(() => attemptCount(request, puzzle.id)).toBe(1);
	const detail = await (await request.get(`${API}/puzzles/${puzzle.id}`)).json();
	expect(detail.attempts.at(-1).correct).toBe(true);
	expect(detail.attempts.at(-1).hint_level_used).toBe(0);
	expect(detail.box).toBe(puzzle.box + 1); // Leitner: correct → next box

	// the queue moves on to the OTHER due puzzle — named, not merely "not this
	// one", which stays true even when the queue has nothing left to serve
	await page.getByTestId('next-puzzle').click();
	await expect(page.getByTestId('puzzle-heading')).toContainText(`Puzzle #${secondPuzzleId}`);
});

test('wrong move records an incorrect attempt and offers retry + reveal', async ({
	page,
	request
}) => {
	const { puzzle } = await seedHungQueenPuzzle(request);

	await page.goto('/puzzles');
	await expect(page.getByTestId('puzzle-heading')).toContainText(`Puzzle #${puzzle.id}`);

	// ...Qe7 blocks the check instead of taking the queen. The board snaps the
	// piece back, so "the position changed" cannot tell an accepted wrong move
	// apart from a click chessground dropped mid-animation — the retry offer
	// appearing is what proves the input landed.
	const retry = page.getByTestId('puzzle-retry');
	await moveUntil(
		page,
		HUNG_QUEEN.wrongMove.slice(0, 2),
		HUNG_QUEEN.wrongMove.slice(2, 4),
		HUNG_QUEEN.orientation,
		() => retry.isVisible(),
		HUNG_QUEEN.wrongMoveSan
	);
	await expect(retry).toBeVisible();

	// incorrect attempt recorded immediately, not on puzzle completion
	await expect.poll(() => attemptCount(request, puzzle.id)).toBe(1);
	const afterMiss = await (await request.get(`${API}/puzzles/${puzzle.id}`)).json();
	expect(afterMiss.attempts.at(-1).correct).toBe(false);

	// reveal-answer escape hatch shows the full line
	await page.getByTestId('reveal-answer').click();
	await expect(page.getByTestId('hint-level-5')).toBeVisible();

	// the board snapped back, so the real solution still plays cleanly
	await playSolution(page, puzzle);
	await expect(page.getByTestId('puzzle-correct')).toBeVisible();

	// still one attempt for this puzzle — retries after a miss are free
	const detail = await (await request.get(`${API}/puzzles/${puzzle.id}`)).json();
	expect(detail.attempts.length).toBe(1);
	expect(detail.attempts.at(-1).correct).toBe(false);
	expect(detail.box).toBe(1); // wrong answer → back to box 1
});

test('an illegal move is refused without counting as a wrong attempt', async ({
	page,
	request
}) => {
	// The board is the first line of defence: chessground never offers an
	// illegal destination, so nothing should reach the session or the API. The
	// wrong-move path above only covers legal-but-wrong.
	const { puzzle } = await seedHungQueenPuzzle(request);

	await page.goto('/puzzles');
	await expect(page.getByTestId('puzzle-heading')).toContainText(`Puzzle #${puzzle.id}`);

	// Black's a8 rook cannot reach a5: its own a7 pawn is in the way, and the
	// king is in check from the queen on e5 besides
	await clickSquares(page, 'a8', 'a5', HUNG_QUEEN.orientation);
	await expect(page.getByTestId('puzzle-retry')).toBeHidden();
	await expect(page.getByTestId('puzzle-correct')).toBeHidden();
	expect(await attemptCount(request, puzzle.id)).toBe(0);

	// and the puzzle is still solvable afterwards
	await playSolution(page, puzzle);
	await expect(page.getByTestId('puzzle-correct')).toBeVisible();
});
