/** Playing a friend, in two browsers.
 *
 * This is the one thing the unit suites cannot show. The store tests drive a
 * fake socket and the backend tests drive the server directly; only here do
 * two real browsers, two real sockets and one real FastAPI process have to
 * agree that a piece moved. So these specs are deliberately about the seam:
 * a link opened in a second context, a move crossing between them, and what
 * each side is left with when the game ends.
 */
import { expect, test } from './fixtures';
import { boardPosition, clickSquares, consoleErrors, move } from './helpers';
import type { BrowserContext, Page } from '@playwright/test';

/** The friend: a second browser with its own cookies and its own
 * localStorage, which is what makes them a different player rather than the
 * same one in a second tab. Signed out, because a friend game must work for
 * someone who has never been here. */
async function friendPage(context: BrowserContext, link: string): Promise<Page> {
	const page = await context.browser()!.newContext();
	const friend = await page.newPage();
	await friend.goto(link);
	return friend;
}

/** Start a game from the welcome screen and hand back the link to send. */
async function hostAGame(page: Page): Promise<string> {
	await page.goto('/welcome');
	await page.getByTestId('welcome-play-friend').click();
	await expect(page).toHaveURL(/\/play\/[\w-]+$/);
	await expect(page.getByTestId('friend-invite')).toBeVisible();
	return page.getByTestId('friend-link').inputValue();
}

test.use({ signedIn: false });

test('a link is all it takes to start playing', async ({ page, context }) => {
	const errors = consoleErrors(page);
	const link = await hostAGame(page);

	// Nobody has arrived yet, so the host is told so rather than left with a
	// board that silently does nothing.
	await expect(page.getByTestId('friend-status')).toContainText('Waiting for your friend');

	const friend = await friendPage(context, link);

	// No sign-up, no name, no lobby — opening the link took the other seat.
	await expect(friend.getByTestId('friend-game')).toBeVisible();
	await expect(page.getByTestId('presence-white')).toHaveText('here');
	await expect(page.getByTestId('presence-black')).toHaveText('here');
	await expect(page.getByTestId('friend-invite')).toHaveCount(0);
	expect(errors).toEqual([]);
});

test('moves cross between the two players', async ({ page, context }) => {
	const link = await hostAGame(page);
	const friend = await friendPage(context, link);
	await expect(page.getByTestId('presence-black')).toHaveText('here');

	const [white, black] = await orientedPlayers(page, friend);
	const blackBefore = await boardPosition(black.page);
	await move(white.page, 'e2', 'e4', white.orientation);
	await expect
		.poll(() => boardPosition(black.page), {
			timeout: 15_000,
			message: 'the other player never saw the move'
		})
		.not.toBe(blackBefore);

	// And back the other way, which is the half a one-directional transport
	// would quietly fail.
	const whiteBefore = await boardPosition(white.page);
	await move(black.page, 'e7', 'e5', black.orientation);
	await expect.poll(() => boardPosition(white.page), { timeout: 15_000 }).not.toBe(whiteBefore);

	await expect(white.page.getByTestId('friend-move-list')).toContainText('e4');
	await expect(black.page.getByTestId('friend-move-list')).toContainText('e5');
});

test('the board refuses a move that is not yours to make', async ({ page, context }) => {
	const link = await hostAGame(page);
	const friend = await friendPage(context, link);
	await expect(page.getByTestId('presence-black')).toHaveText('here');
	const [, black] = await orientedPlayers(page, friend);

	// It is White's move, so Black's board must not move a Black piece — the
	// clicks are issued for real and the position has to be unchanged after.
	await expect(black.page.getByTestId('friend-status')).toContainText('Waiting for');
	const before = await boardPosition(black.page);
	await clickSquares(black.page, 'e7', 'e5', black.orientation);
	await black.page.waitForTimeout(500);

	expect(await boardPosition(black.page)).toBe(before);
});

test('resigning ends the game for both players', async ({ page, context }) => {
	const link = await hostAGame(page);
	const friend = await friendPage(context, link);
	await expect(page.getByTestId('presence-black')).toHaveText('here');

	await page.getByTestId('friend-resign').click();

	await expect(page.getByTestId('friend-result')).toBeVisible();
	await expect(friend.getByTestId('friend-result')).toBeVisible();
	// The resigner lost; their opponent won. Both are told, on their own screen.
	await expect(page.getByTestId('friend-result')).toContainText('You lost');
	await expect(friend.getByTestId('friend-result')).toContainText('You won');
});

test('a friend game is a board and nothing else', async ({ page, context }) => {
	const link = await hostAGame(page);
	await friendPage(context, link);

	// Everything the engine screen wraps around its board reads out what
	// Stockfish would play. Against a person that is not a display preference,
	// so none of it is here — not hidden behind a toggle, absent.
	await expect(page.getByTestId('insight-bar')).toHaveCount(0);
	await expect(page.getByTestId('tactic-row')).toHaveCount(0);
	await expect(page.getByTestId('hint-mode')).toHaveCount(0);
	await expect(page.getByTestId('takeback-offer')).toHaveCount(0);
});

test('an anonymous game keeps nothing, and says so before it ends', async ({ page, context }) => {
	const link = await hostAGame(page);
	const friend = await friendPage(context, link);
	await expect(page.getByTestId('presence-black')).toHaveText('here');

	// Stated on the board while the game is on, not discovered afterwards on
	// an empty Review screen.
	await expect(page.getByTestId('friend-seats')).toContainText('Nothing is saved');

	await page.getByTestId('friend-resign').click();

	await expect(page.getByTestId('friend-result')).toContainText('Nothing was saved');
	await expect(friend.getByTestId('friend-result')).toContainText('Nothing was saved');
	await expect(page.getByTestId('friend-review-link')).toHaveCount(0);
});

test('a signed-in player gets the game in their review', async ({ page, context }) => {
	// The other half of the bargain: an account is what turns a finished game
	// into something to look back at, and a friend game is no exception.
	await page.goto('/welcome');
	await page.getByTestId('welcome-signup').click();
	await page.getByTestId('auth-username').fill('host-account');
	await page.getByTestId('auth-password').fill('correct-horse');
	await page.getByTestId('auth-submit').click();
	await expect(page).toHaveURL(/\/$/);

	await page.getByTestId('settings-button').click();
	await page.getByTestId('settings-play-friend').click();
	await expect(page).toHaveURL(/\/play\/[\w-]+$/);
	const link = await page.getByTestId('friend-link').inputValue();

	await expect(page.getByTestId('friend-seats')).toContainText('saved and analyzed');
	const friend = await friendPage(context, link);
	await expect(page.getByTestId('presence-black')).toHaveText('here');

	// A game with no moves is not one to look back at, so play one first.
	const [white, black] = await orientedPlayers(page, friend);
	await move(white.page, 'e2', 'e4', white.orientation);
	await expect(black.page.getByTestId('friend-move-list')).toContainText('e4');

	await friend.getByTestId('friend-resign').click();

	await expect(page.getByTestId('friend-review-link')).toBeVisible({ timeout: 15_000 });
	await page.getByTestId('friend-review-link').click();
	await expect(page).toHaveURL(/\/review\/\d+$/);
});

/** Which page holds which side, and the orientation its board is drawn at.
 *
 * The creator's colour is random — deliberately, so neither player has to
 * choose — which means no spec may assume it. Read from the seat panel's
 * data-you rather than its text: "(you)" sits in its own element beside the
 * name, so innerText puts a newline between the two and a match on
 * "White (you)" quietly never fires, leaving every move in the spec played by
 * the wrong side.
 */
async function orientedPlayers(host: Page, guest: Page) {
	const seats = host.getByTestId('friend-seats');
	await expect(seats).toHaveAttribute('data-you', /^(white|black)$/);
	const hostIsWhite = (await seats.getAttribute('data-you')) === 'white';
	// Returned in move order: White moves first.
	return [
		{ page: hostIsWhite ? host : guest, orientation: 'white' as const },
		{ page: hostIsWhite ? guest : host, orientation: 'black' as const }
	];
}
