import { expect, test } from './fixtures';
import { API, move } from './helpers';

// Guess the move through a Literature game. The browser engine does the
// weighing; the run's totals are saved to the account as it goes.

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

test('a run is saved as it goes, and shown on the game, its card and Progress', async ({
	page,
	request
}) => {
	await page.goto('/literature/guess/opera-1858');
	// two of Morphy's own moves: scored in full, no engine needed
	await move(page, 'e2', 'e4');
	await expect(page.getByTestId('guess-feedback')).toContainText('5 points');
	await page.getByTestId('guess-next').click();
	await move(page, 'g1', 'f3');
	await expect(page.getByTestId('guess-feedback')).toContainText('5 points');

	await expect
		.poll(async () => (await (await request.get(`${API}/guess/summary`)).json())[0]?.latest)
		.toMatchObject({ points: 10, max_points: 10, matched: 2, guessed: 2, finished: false });

	const started = 'Started as Paul Morphy: 10 of 10 points after 2 guesses, not finished yet.';
	await page.reload();
	await expect(page.getByTestId('guess-record')).toHaveText(started);

	await page.goto('/literature');
	const card = page.getByTestId('game-card').filter({ hasText: 'The Opera Game' });
	await expect(card.getByTestId('guess-card-record')).toHaveText(started);

	await page.goto('/progress');
	const row = page.getByTestId('guessing-row');
	await expect(row).toContainText('The Opera Game');
	await expect(row).toContainText('Paul Morphy');
	await expect(row).toContainText('not finished');
	await expect(row).toContainText('10/10 (100%)');
});
