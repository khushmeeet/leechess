import { expect, test, type APIRequestContext } from '@playwright/test';
import { Chess } from 'chess.js';
import { API, hungQueenSans, move, seedGame, waitForAnalysis } from './helpers';

// Phase 3 Puzzles screen: solve flows + attempt recording. Never assumes
// WHICH puzzle the queue serves (earlier specs may have left due puzzles) —
// every test reads /puzzles/next and drives the board from that data.

async function nextPuzzle(request: APIRequestContext) {
	const response = await request.get(`${API}/puzzles/next`);
	expect(response.ok()).toBe(true);
	return response.json();
}

async function attemptCount(request: APIRequestContext, puzzleId: number): Promise<number> {
	const response = await request.get(`${API}/puzzles/${puzzleId}`);
	return (await response.json()).attempts.length;
}

function orientationOf(puzzle: { fen: string }): 'white' | 'black' {
	return puzzle.fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

/** Play the solver's moves of the solution; scripted opponent replies
 * auto-play in between. */
async function playSolution(
	page: import('@playwright/test').Page,
	puzzle: { fen: string; solution: string[] }
) {
	const orientation = orientationOf(puzzle);
	for (let i = 0; i < puzzle.solution.length; i += 2) {
		if (i > 0) await page.waitForTimeout(600); // opponent reply animation
		const uci = puzzle.solution[i];
		await move(page, uci.slice(0, 2), uci.slice(2, 4), orientation);
	}
}

test('solving a puzzle records a correct attempt and advances the box', async ({
	page,
	request
}) => {
	const gameId = await seedGame(request, hungQueenSans);
	await waitForAnalysis(request, gameId);

	const puzzle = await nextPuzzle(request);
	const attemptsBefore = await attemptCount(request, puzzle.id);

	await page.goto('/puzzles');
	await expect(page.getByTestId('puzzle-heading')).toContainText(`Puzzle #${puzzle.id}`);
	await expect(page.getByTestId('puzzle-turn')).toContainText(orientationOf(puzzle));

	await playSolution(page, puzzle);
	await expect(page.getByTestId('puzzle-correct')).toBeVisible();

	// the attempt lands (fire-and-forget from the UI, so poll)
	await expect.poll(() => attemptCount(request, puzzle.id)).toBe(attemptsBefore + 1);
	const detail = await (await request.get(`${API}/puzzles/${puzzle.id}`)).json();
	expect(detail.attempts.at(-1).correct).toBe(true);
	expect(detail.attempts.at(-1).hint_level_used).toBe(0);
	expect(detail.box).toBe(puzzle.box + 1); // Leitner: correct → next box

	// queue moves on to a fresh puzzle
	await page.getByTestId('next-puzzle').click();
	await expect(page.getByTestId('puzzle-heading')).toBeVisible();
	await expect(page.getByTestId('puzzle-heading')).not.toContainText(`Puzzle #${puzzle.id}`);
});

test('wrong move records an incorrect attempt and offers retry + reveal', async ({
	page,
	request
}) => {
	const gameId = await seedGame(request, hungQueenSans);
	await waitForAnalysis(request, gameId);

	const puzzle = await nextPuzzle(request);
	const attemptsBefore = await attemptCount(request, puzzle.id);
	const orientation = orientationOf(puzzle);

	// any legal move that isn't the solution and doesn't mate
	const chess = new Chess(puzzle.fen);
	const wrong = chess.moves({ verbose: true }).find((candidate) => {
		const uci = candidate.from + candidate.to + (candidate.promotion ?? '');
		if (uci === puzzle.solution[0]) return false;
		const probe = new Chess(puzzle.fen);
		probe.move(candidate);
		return !probe.isCheckmate();
	})!;

	await page.goto('/puzzles');
	await expect(page.getByTestId('puzzle-heading')).toContainText(`Puzzle #${puzzle.id}`);

	await move(page, wrong.from, wrong.to, orientation);
	await expect(page.getByTestId('puzzle-retry')).toBeVisible();

	// incorrect attempt recorded immediately, not on puzzle completion
	await expect.poll(() => attemptCount(request, puzzle.id)).toBe(attemptsBefore + 1);

	// reveal-answer escape hatch shows the full line
	await page.getByTestId('reveal-answer').click();
	await expect(page.getByTestId('hint-level-5')).toBeVisible();

	// the board snapped back, so the real solution still plays cleanly
	await playSolution(page, puzzle);
	await expect(page.getByTestId('puzzle-correct')).toBeVisible();

	// still one attempt for this puzzle — retries after a miss are free
	const detail = await (await request.get(`${API}/puzzles/${puzzle.id}`)).json();
	expect(detail.attempts.length).toBe(attemptsBefore + 1);
	expect(detail.attempts.at(-1).correct).toBe(false);
	expect(detail.box).toBe(1); // wrong answer → back to box 1
});
