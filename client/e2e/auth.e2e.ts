import { expect, test } from './fixtures';
import { API, seedGame, scholarsMateSans } from './helpers';

test.use({ signedIn: false });

test('playing needs nothing: one click from the welcome screen to the board', async ({ page }) => {
	await page.goto('/welcome');
	await page.getByTestId('welcome-play').click();

	// No form in between — no name to pick, nothing to fill in.
	await expect(page).toHaveURL(/\/$/);
	await expect(page.locator('cg-board')).toBeVisible();
	await expect(page.getByTestId('nav-username')).toContainText('Anonymous');
});

test('an anonymous session survives a reload', async ({ page }) => {
	await page.goto('/welcome');
	await page.getByTestId('welcome-play').click();
	await expect(page.getByTestId('nav-username')).toContainText('Anonymous');

	await page.reload();

	// Never bounced back through the welcome screen — which is what the layout
	// guard's `ready` gate is there to prevent, for an account and for this.
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByTestId('nav-username')).toContainText('Anonymous');
});

test('an anonymous player has no server session to write anything with', async ({ page }) => {
	await page.goto('/welcome');
	await page.getByTestId('welcome-play').click();
	await expect(page.locator('cg-board')).toBeVisible();
	await expect(page.getByTestId('anonymous-not-saved')).toBeVisible();

	// page.request shares the page's cookie jar, and there is no session cookie
	// in it. That is the whole of "saves nothing": every route that writes is
	// behind an account, so this browser could not reach one if it tried.
	expect((await page.request.get(`${API}/games`)).status()).toBe(401);
});

test('the screens that keep something ask for an account instead of showing it empty', async ({
	page
}) => {
	await page.goto('/welcome');
	await page.getByTestId('welcome-play').click();
	await expect(page.getByTestId('nav-username')).toContainText('Anonymous');

	for (const path of ['/review', '/puzzles', '/endgames', '/progress']) {
		await page.goto(path);
		// "Nothing here yet" would be a lie: nothing played this way will ever
		// arrive, so the screen says what an account would make of it.
		await expect(page.getByTestId('account-gate')).toBeVisible();
	}
});

test('literature stays open to an anonymous player', async ({ page }) => {
	// Nothing on it is anybody's, so an account would be a wall around a
	// reference shelf.
	await page.goto('/welcome');
	await page.getByTestId('welcome-play').click();

	await page.goto('/literature');

	await expect(page.getByTestId('account-gate')).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Literature' })).toBeVisible();
});

test('a gate leads to the sign-up form, and signing up lands back in the app', async ({ page }) => {
	await page.goto('/welcome');
	await page.getByTestId('welcome-play').click();
	await page.goto('/progress');

	await page.getByTestId('gate-sign-up').click();

	// Straight into the form rather than back to the chooser — they already
	// chose by clicking the link.
	await expect(page).toHaveURL(/mode=signup/);
	await page.getByTestId('auth-username').fill('newcomer');
	await page.getByTestId('auth-password').fill('correct-horse');
	await page.getByTestId('auth-submit').click();

	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByTestId('nav-username')).toContainText('newcomer');
	// The anonymous badge is gone with it: this browser is an account now.
	await expect(page.getByTestId('nav-sign-up')).toHaveCount(0);
});

test('an account keeps its games, and signing back in finds them', async ({ page, context }) => {
	await page.goto('/welcome');
	await page.getByTestId('welcome-signup').click();
	await page.getByTestId('auth-username').fill('ada');
	await page.getByTestId('auth-password').fill('correct-horse');
	await page.getByTestId('auth-submit').click();
	await expect(page.getByTestId('nav-username')).toContainText('ada');

	// Through the API so the spec is about the account, not about playing
	// chess — the cookie jar is shared with the page.
	const gameId = await seedGame(context.request, scholarsMateSans, '1-0');

	await page.getByTestId('settings-button').click();
	await page.getByTestId('sign-out').click();
	await expect(page).toHaveURL(/\/welcome$/);

	await page.getByTestId('welcome-signin').click();
	await page.getByTestId('auth-username').fill('ada');
	await page.getByTestId('auth-password').fill('correct-horse');
	await page.getByTestId('auth-submit').click();
	// The guard's redirect is what says the sign-in landed; navigating before
	// it lands would load /review with no cookie yet and bounce right back.
	await expect(page).toHaveURL(/\/$/);

	await page.goto('/review');
	await expect(page.getByTestId('games-list')).toContainText(String(gameId));
});

test('settings offers an anonymous player the account, not a rename', async ({ page }) => {
	await page.goto('/welcome');
	await page.getByTestId('welcome-play').click();

	await page.getByTestId('settings-button').click();

	// There is no account for the name to be the name of, so the field would
	// be a control that changes nothing.
	await expect(page.getByTestId('anonymous-player')).toContainText('Anonymous');
	await expect(page.getByTestId('username-setting-input')).toHaveCount(0);
	await expect(page.getByTestId('sign-up')).toBeVisible();
});

test('leaving anonymous play returns to the welcome screen', async ({ page }) => {
	await page.goto('/welcome');
	await page.getByTestId('welcome-play').click();
	await expect(page.getByTestId('nav-username')).toContainText('Anonymous');

	await page.getByTestId('settings-button').click();
	await page.getByTestId('sign-out').click();

	await expect(page).toHaveURL(/\/welcome$/);
	// And it stays left: the flag that survives a reload has to be gone too.
	await page.goto('/');
	await expect(page).toHaveURL(/\/welcome$/);
});

test('a registered account can rename itself from Settings', async ({ page }) => {
	await page.goto('/welcome');
	await page.getByTestId('welcome-signup').click();
	await page.getByTestId('auth-username').fill('ada');
	await page.getByTestId('auth-password').fill('correct-horse');
	await page.getByTestId('auth-submit').click();
	await expect(page.getByTestId('nav-username')).toContainText('ada');

	await page.getByTestId('settings-button').click();
	const field = page.getByTestId('username-setting-input');
	await field.fill('ada-l');
	await field.blur();

	await expect(page.getByTestId('nav-username')).toContainText('ada-l');
});

test('a rename onto a taken name is refused and the field snaps back', async ({
	page,
	request
}) => {
	await request.post(`${API}/auth/register`, {
		data: { username: 'taken', password: 'correct-horse' }
	});

	await page.goto('/welcome');
	await page.getByTestId('welcome-signup').click();
	await page.getByTestId('auth-username').fill('ada');
	await page.getByTestId('auth-password').fill('correct-horse');
	await page.getByTestId('auth-submit').click();
	await expect(page.getByTestId('nav-username')).toContainText('ada');

	await page.getByTestId('settings-button').click();
	const field = page.getByTestId('username-setting-input');
	await field.fill('taken');
	await field.blur();

	await expect(page.getByTestId('username-setting-error')).toContainText('already taken');
	// The field must not keep showing a name the server refused.
	await expect(field).toHaveValue('ada');
	await expect(page.getByTestId('nav-username')).toContainText('ada');
});
