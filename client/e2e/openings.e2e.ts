import { expect, test } from './fixtures';
import { API, waitForAnalysis } from './helpers';

// The opening repertoire: Review names the opening and flags the first move
// off the book; Progress lists the openings you play, by side, with where
// you leave the book.

// The Italian, Classical Center Attack, then 6.Ke2 — off every known line
const ITALIAN_OFF_BOOK = [
	'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4', 'Ke2'
]; // prettier-ignore

async function seedEngineGame(request: import('@playwright/test').APIRequestContext) {
	const created = await request.post(`${API}/games`, {
		data: { mode: 'engine', user_color: 'white' }
	});
	expect(created.ok()).toBe(true);
	const gameId = (await created.json()).id;
	for (const san of ITALIAN_OFF_BOOK) {
		expect((await request.post(`${API}/games/${gameId}/moves`, { data: { san } })).ok()).toBe(true);
	}
	expect(
		(await request.post(`${API}/games/${gameId}/complete`, { data: { result: '1-0' } })).ok()
	).toBe(true);
	return gameId;
}

test('Review names the opening and shows where the game left the book', async ({
	page,
	request
}) => {
	const gameId = await seedEngineGame(request);
	await page.goto(`/review/${gameId}`);

	await expect(page.getByTestId('review-opening')).toContainText(
		'C54 Italian Game: Classical Variation, Center Attack'
	);
	await expect(page.getByTestId('move-left-book')).toHaveCount(1);
	await page.getByTestId('review-left-book-link').click();
	await expect(page.getByTestId('selected-move')).toContainText('Ke2');
	await expect(page.getByTestId('review-left-book')).toHaveText(
		'Book Ke2 left the opening book. Book moves here: O-O, b4, cxd4, e5.'
	);
});

test('Progress lists your openings with where you leave the book', async ({ page, request }) => {
	const gameId = await seedEngineGame(request);
	await waitForAnalysis(request, gameId);

	await page.goto('/progress');
	const line = page.getByTestId('repertoire-line');
	await expect(line).toHaveCount(1);
	await expect(line).toContainText('C54');
	await expect(line).toContainText('Italian Game');
	await expect(line).toContainText('white');
	await expect(line).toContainText('1–0–0');
	await expect(line.getByTestId('repertoire-exit')).toContainText('6.Ke2');
	await expect(line.getByTestId('repertoire-exit')).toContainText('book: O-O, b4, cxd4, e5');
});
