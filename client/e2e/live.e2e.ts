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
import { boardPosition, clickSquares, consoleErrors, hold, move } from './helpers';
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
	await expect(page.getByTestId('presence-white')).toHaveText('joined');
	await expect(page.getByTestId('presence-black')).toHaveText('joined');
	await expect(page.getByTestId('friend-invite')).toHaveCount(0);
	expect(errors).toEqual([]);
});

test('moves cross between the two players', async ({ page, context }) => {
	const link = await hostAGame(page);
	const friend = await friendPage(context, link);
	await expect(page.getByTestId('presence-black')).toHaveText('joined');

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
	await expect(page.getByTestId('presence-black')).toHaveText('joined');
	const [, black] = await orientedPlayers(page, friend);

	// It is White's move, so Black's board must not move a Black piece — the
	// clicks are issued for real and the position has to be unchanged after.
	// Whose turn it is is read off the seat rows: the rail says nothing above
	// them during an ordinary turn, so this is the assertion that the spec is
	// on the right screen at the right moment.
	await expect(black.page.getByTestId('seat-white')).toContainText('to move');
	await expect(black.page.getByTestId('seat-black')).not.toContainText('to move');
	const before = await boardPosition(black.page);
	await clickSquares(black.page, 'e7', 'e5', black.orientation);
	await black.page.waitForTimeout(500);

	expect(await boardPosition(black.page)).toBe(before);
});

test('resigning ends the game for both players', async ({ page, context }) => {
	const link = await hostAGame(page);
	const friend = await friendPage(context, link);
	await expect(page.getByTestId('presence-black')).toHaveText('joined');

	// The way off this screen keeps to the end of the game: with a person
	// waiting on the other end there is nothing to leave for, and an exit
	// under Hold to resign is a slip away from abandoning them.
	await expect(page.getByTestId('friend-leave')).toHaveCount(0);

	await hold(page, page.getByTestId('friend-resign'));

	// The board says it, over the position it happened on.
	await expect(page.getByTestId('friend-result')).toBeVisible();
	await expect(friend.getByTestId('friend-result')).toBeVisible();
	await expect(page.getByTestId('friend-result')).toContainText('You lost');

	// The resigner lost; their opponent won. Both are told, on their own screen
	// — and the rail is where it is written down.
	await expect(page.getByTestId('friend-status')).toContainText('You lost');
	await expect(friend.getByTestId('friend-status')).toContainText('You won');
	await expect(page.getByTestId('friend-status')).toContainText('by resignation');

	// And the score is written where the game was played out: a point beside
	// each name, in the slot that carried their presence a moment ago.
	const hostIsWhite = (await page.getByTestId('friend-seats').getAttribute('data-you')) === 'white';
	await expect(page.getByTestId(hostIsWhite ? 'score-white' : 'score-black')).toHaveText('0');
	await expect(page.getByTestId(hostIsWhite ? 'score-black' : 'score-white')).toHaveText('1');

	// And now both have the way out, whichever end of the resignation they
	// were on.
	await expect(page.getByTestId('friend-leave')).toBeVisible();
	await expect(friend.getByTestId('friend-leave')).toBeVisible();

	// The overlay says the result and nothing else: what became of the game and
	// what to do about it are the rail's, said once each.
	await expect(page.getByTestId('friend-result')).not.toContainText('saved');
	await expect(page.getByTestId('friend-result')).not.toContainText('Play again');
});

test('play again starts the next game on the same link', async ({ page, context }) => {
	// A rematch is the link the friend already has, played again — nobody has
	// to send a second URL after every game. It takes both players: the rail
	// carries a signed-in player's link to their saved game, and one press
	// must not clear it while the other is still reading it.
	const link = await hostAGame(page);
	const friend = await friendPage(context, link);
	await expect(page.getByTestId('presence-black')).toHaveText('joined');

	const [white, black] = await orientedPlayers(page, friend);
	await move(white.page, 'e2', 'e4', white.orientation);
	await expect(black.page.getByTestId('friend-move-list')).toContainText('e4');

	await hold(page, page.getByTestId('friend-resign'));
	await expect(page.getByTestId('friend-result')).toBeVisible();
	await expect(friend.getByTestId('friend-result')).toBeVisible();

	// One press asks. The other player's finished game is left exactly as it
	// was, with the asking shown on it.
	const hostWasWhite =
		(await page.getByTestId('friend-seats').getAttribute('data-you')) === 'white';
	await page.getByTestId('friend-play-again').click();
	await expect(page.getByTestId('rematch-waiting')).toBeVisible();
	await expect(friend.getByTestId('rematch-offer')).toBeVisible();
	await expect(friend.getByTestId('friend-result')).toBeVisible();
	await expect(friend.getByTestId('friend-status')).toContainText('by resignation');

	// The second press starts it — same URL, empty board, colours swapped. The
	// finished game is gone from both: no overlay, no verdict in the rail, no
	// score beside a name.
	await friend.getByTestId('friend-play-again').click();

	await expect(page).toHaveURL(link);
	await expect(page.getByTestId('friend-result')).toHaveCount(0);
	await expect(friend.getByTestId('friend-result')).toHaveCount(0);
	await expect(page.getByTestId('friend-status')).toHaveCount(0);
	await expect(page.getByTestId('score-white')).toHaveCount(0);
	await expect(page.getByTestId('friend-moves')).toContainText('No moves yet');
	await expect(page.getByTestId('friend-seats')).toHaveAttribute(
		'data-you',
		hostWasWhite ? 'black' : 'white'
	);

	// And it is a game rather than a reset screen: whoever holds White now
	// moves, and it crosses to the other board.
	const [nowWhite, nowBlack] = await orientedPlayers(page, friend);
	await move(nowWhite.page, 'd2', 'd4', nowWhite.orientation);
	await expect(nowBlack.page.getByTestId('friend-move-list')).toContainText('d4');
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
	await expect(page.getByTestId('presence-black')).toHaveText('joined');

	// Stated on the board while the game is on, not discovered afterwards on
	// an empty Review screen.
	await expect(page.getByTestId('friend-seats')).toContainText('Nothing is saved');

	await hold(page, page.getByTestId('friend-resign'));

	// Same line, same place, now in the past tense: what was a promise while
	// the game was on is what became of it once it ended.
	await expect(page.getByTestId('friend-seats')).toContainText('Nothing was saved');
	await expect(friend.getByTestId('friend-seats')).toContainText('Nothing was saved');
	await expect(page.getByTestId('friend-review-link')).toHaveCount(0);
});

test('an opponent who leaves can be claimed, not just resigned to', async ({ page, context }) => {
	// The whole point of the claim: without it the only ways out of a game
	// your opponent left are to resign — recording a loss you did not suffer —
	// or to walk away and let it be swept.
	const link = await hostAGame(page);
	const friend = await friendPage(context, link);
	await expect(page.getByTestId('presence-black')).toHaveText('joined');

	// Somebody has to move first: an unplayed game is aborted, not won.
	const [white, black] = await orientedPlayers(page, friend);
	await move(white.page, 'e2', 'e4', white.orientation);
	await expect(black.page.getByTestId('friend-move-list')).toContainText('e4');

	// Nothing to claim while they are still here.
	await expect(page.getByTestId('claim-panel')).toHaveCount(0);

	await friend.close();

	// Closing the tab is a deliberate departure, so it is the short wait —
	// the countdown appears first, then the button.
	await expect(page.getByTestId('claim-countdown')).toBeVisible();
	await expect(page.getByTestId('claim-win')).toBeVisible({ timeout: 20_000 });
	await page.getByTestId('claim-win').click();

	await expect(page.getByTestId('friend-status')).toContainText('You won');
	await expect(page.getByTestId('friend-status')).toContainText('by abandonment');
});

test('leaving a finished friend game goes to the welcome screen', async ({ page, context }) => {
	// The invite route is exempt from the layout guard so a link works for
	// someone who has never been here. That exemption is for arriving: it used
	// to swallow the redirect on the way out too, so Leave cleared the session,
	// the nav vanished with it, and the player was left on a board with no way
	// off it — which looks exactly like zen mode with the controls stuck.
	const link = await hostAGame(page);
	const friend = await friendPage(context, link);
	await expect(page.getByTestId('presence-black')).toHaveText('joined');

	await hold(friend, friend.getByTestId('friend-resign'));
	await expect(page.getByTestId('friend-result')).toBeVisible();

	await page.getByTestId('settings-button').click();
	await page.getByTestId('sign-out').click();

	await expect(page).toHaveURL(/\/welcome$/);
	await expect(page.getByTestId('welcome')).toBeVisible();
});

test('after leaving, an invite link still works in the same tab', async ({ page }) => {
	// The other half of the same guard. Remembering "has been admitted" as a
	// bare flag fixes the trap above and breaks this: leaving one game would
	// hold against every link opened afterwards, bouncing each one to the
	// welcome screen. It is remembered per screen, and forgotten on the way out.
	const first = await hostAGame(page);
	await page.getByTestId('settings-button').click();
	await page.getByTestId('sign-out').click();
	await expect(page).toHaveURL(/\/welcome$/);

	// A fresh link, and the one they just left — both have to open.
	const second = await hostAGame(page);
	expect(second).not.toBe(first);
	await page.goto(first);

	await expect(page.getByTestId('friend-game')).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`${first.split('/play/')[1]}$`));
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
	await expect(page.getByTestId('presence-black')).toHaveText('joined');

	// A game with no moves is not one to look back at, so play one first.
	const [white, black] = await orientedPlayers(page, friend);
	await move(white.page, 'e2', 'e4', white.orientation);
	await expect(black.page.getByTestId('friend-move-list')).toContainText('e4');

	await hold(friend, friend.getByTestId('friend-resign'));

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
