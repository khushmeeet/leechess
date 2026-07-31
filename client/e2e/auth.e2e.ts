import { expect, test } from './fixtures';
import { API, seedGame, scholarsMateSans } from './helpers';

test.use({ signedIn: false });

test('a guest can start playing straight from the welcome screen', async ({ page }) => {
	await page.goto('/welcome');
	await page.getByTestId('welcome-guest').click();
	await page.getByTestId('auth-username').fill('drifter');
	await page.getByTestId('auth-submit').click();

	await expect(page).toHaveURL(/\/$/);
	await expect(page.locator('cg-board')).toBeVisible();
	await expect(page.getByTestId('nav-username')).toContainText('drifter');
});

test('a guest session survives a reload', async ({ page }) => {
	await page.goto('/welcome');
	await page.getByTestId('welcome-guest').click();
	await page.getByTestId('auth-username').fill('drifter');
	await page.getByTestId('auth-submit').click();
	await expect(page.getByTestId('nav-username')).toContainText('drifter');

	await page.reload();

	// Still signed in, and never bounced back through the welcome screen —
	// which is what the layout guard's `ready` gate is there to prevent.
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByTestId('nav-username')).toContainText('drifter');
});

test('a guest with a game is offered a password, and keeps everything on taking it', async ({
	page,
	context
}) => {
	await page.goto('/welcome');
	await page.getByTestId('welcome-guest').click();
	await page.getByTestId('auth-username').fill('drifter');
	await page.getByTestId('auth-submit').click();
	await expect(page.getByTestId('nav-username')).toContainText('drifter');

	// A game to lose. Through the API so the spec is about the upgrade, not
	// about playing chess — the cookie jar is shared with the page.
	const gameId = await seedGame(context.request, scholarsMateSans, '1-0');

	await page.goto('/review');
	// The prompt is deliberately late: it appears only once there is something
	// worth keeping.
	await expect(page.getByTestId('upgrade-prompt')).toBeVisible();

	await page.getByTestId('upgrade-open').click();
	// The username comes prefilled with the name they have been playing under —
	// it is a login from here, but it does not have to change to become one.
	await expect(page.getByTestId('upgrade-username')).toHaveValue('drifter');
	await page.getByTestId('upgrade-password').fill('correct-horse');
	await page.getByTestId('upgrade-submit').click();

	await expect(page.getByTestId('upgrade-done')).toBeVisible();
	// Same account, same games — the upgrade is in place, not a migration.
	await expect(page.getByTestId('nav-username')).toContainText('drifter');
	const games = await (await context.request.get(`${API}/games`)).json();
	expect(games.map((game: { id: number }) => game.id)).toContain(gameId);
});

test('a guest is offered a way to keep the account rather than a way to lose it', async ({
	page
}) => {
	await page.goto('/welcome');
	await page.getByTestId('welcome-guest').click();
	await page.getByTestId('auth-username').fill('drifter');
	await page.getByTestId('auth-submit').click();
	await expect(page.getByTestId('nav-username')).toContainText('drifter');

	await page.getByTestId('settings-button').click();

	// Signing out of an account with no password is signing out for good.
	await expect(page.getByTestId('sign-up')).toBeVisible();
	await expect(page.getByTestId('sign-out')).toHaveCount(0);
});

test('the password set as a guest signs the same account back in', async ({ page }) => {
	await page.goto('/welcome');
	await page.getByTestId('welcome-guest').click();
	await page.getByTestId('auth-username').fill('drifter');
	await page.getByTestId('auth-submit').click();
	await expect(page.getByTestId('nav-username')).toContainText('drifter');

	// Through Settings rather than the API: this is the path a guest who went
	// looking for it takes, and the one that turns Sign up back into Sign out.
	await page.getByTestId('settings-button').click();
	await page.getByTestId('sign-up').click();
	await expect(page.getByTestId('sign-up-username')).toHaveValue('drifter');
	await page.getByTestId('sign-up-password').fill('correct-horse');
	await page.getByTestId('sign-up-submit').click();

	await expect(page.getByTestId('sign-up-done')).toBeVisible();
	await page.getByTestId('sign-out').click();
	await expect(page).toHaveURL(/\/welcome$/);

	await page.getByTestId('welcome-signin').click();
	await page.getByTestId('auth-username').fill('drifter');
	await page.getByTestId('auth-password').fill('correct-horse');
	await page.getByTestId('auth-submit').click();

	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByTestId('nav-username')).toContainText('drifter');
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
	// Registered, so the name is a login worth protecting — a guest holding it
	// would not be (see the guest rename spec below).
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

test('a guest can rename onto a name somebody else is using', async ({ page, request }) => {
	await request.post(`${API}/auth/guest`, { data: { username: 'taken' } });

	await page.goto('/welcome');
	await page.getByTestId('welcome-guest').click();
	await page.getByTestId('auth-username').fill('drifter');
	await page.getByTestId('auth-submit').click();
	await expect(page.getByTestId('nav-username')).toContainText('drifter');

	await page.getByTestId('settings-button').click();
	const field = page.getByTestId('username-setting-input');
	await field.fill('taken');
	await field.blur();

	// Two guests may answer to one name; neither of them can be signed in to,
	// so there is nothing for the other to take.
	await expect(page.getByTestId('nav-username')).toContainText('taken');
	await expect(page.getByTestId('username-setting-error')).toHaveCount(0);
});

test('signing up is where the username is finally checked', async ({ page, request }) => {
	// A registered account holding the name this guest has been playing under.
	await request.post(`${API}/auth/register`, {
		data: { username: 'taken', password: 'correct-horse' }
	});

	await page.goto('/welcome');
	await page.getByTestId('welcome-guest').click();
	await page.getByTestId('auth-username').fill('taken');
	await page.getByTestId('auth-submit').click();
	// Playing under it was never a problem.
	await expect(page.getByTestId('nav-username')).toContainText('taken');

	await page.getByTestId('settings-button').click();
	await page.getByTestId('sign-up').click();
	await page.getByTestId('sign-up-password').fill('another-one');
	await page.getByTestId('sign-up-submit').click();

	// Turning it into a login is. The field is right there to change.
	await expect(page.getByTestId('sign-up-error')).toContainText('already taken');
	await page.getByTestId('sign-up-username').fill('settled');
	await page.getByTestId('sign-up-submit').click();

	await expect(page.getByTestId('sign-up-done')).toBeVisible();
	await expect(page.getByTestId('nav-username')).toContainText('settled');
});
