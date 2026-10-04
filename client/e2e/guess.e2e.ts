import { expect, test } from './fixtures';
import { move } from './helpers';

// Guess the move through a Literature game. Nothing is saved: the browser
// engine does the weighing.

test('guessing through a landmark game: exact, close, and shown moves', async ({ page }) => {
	await page.goto('/literature');
	const card = page.getByTestId('game-card').filter({ hasText: 'The Opera Game' });
	await card.getByTestId('guess-link').click();
	await expect(page).toHaveURL(/\/literature\/guess\/opera-1858$/);
	await expect(page.getByTestId('guess-heading')).toContainText('The Opera Game');
	// Morphy won with White, so White is the side to guess
	await expect(page.getByTestId('guess-side-white')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('guess-prompt')).toContainText('Move 1.');

	// the master's own move: full points, no engine needed
	await move(page, 'e2', 'e4');
	await expect(page.getByTestId('guess-feedback')).toHaveText(
		'e4 — the move Paul Morphy played. 5 points.'
	);
	await page.getByTestId('guess-next').click();
	await expect(page.getByTestId('guess-prompt')).toContainText('Move 2.');

	// a different move: weighed against Morphy's 2.Nf3 by the engine
	await move(page, 'b1', 'c3');
	await expect(page.getByTestId('guess-feedback')).toContainText('Nc3 keeps', {
		timeout: 30_000
	});
	await expect(page.getByTestId('guess-feedback')).toContainText('Nf3');
	await page.getByTestId('guess-next').click();

	// shown on request, for nothing
	await page.getByTestId('guess-skip').click();
	await expect(page.getByTestId('guess-feedback')).toHaveText('Paul Morphy played d4.');
	await expect(page.getByTestId('guess-score')).toContainText('/ 10 points · 1 exact');
});

test('the other side can be guessed instead', async ({ page }) => {
	await page.goto('/literature/guess/opera-1858');
	await page.getByTestId('guess-side-black').click();
	// 1.e4 is played for you; Black's first move is the first guess
	await expect(page.getByTestId('guess-prompt')).toContainText('Move 1…');
	await move(page, 'e7', 'e5', 'black');
	await expect(page.getByTestId('guess-feedback')).toContainText('the move');
});
