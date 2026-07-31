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
	await request.post(`${API}/auth/guest`, { data: { username: 'taken' } });

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

test('a guest renaming onto a taken name is numbered rather than refused', async ({
	page,
	request
}) => {
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

	// The other half of the same rule the welcome screen follows, and the
	// field has to show what was actually stored rather than what was typed.
	await expect(page.getByTestId('nav-username')).toContainText('taken-2');
	await expect(field).toHaveValue('taken-2');
	await expect(page.getByTestId('username-setting-error')).toHaveCount(0);
});
