import { expect, test } from './fixtures';
import { consoleErrors } from './helpers';

// Signed out, and staying that way: these are about the screen itself.
// auth.e2e.ts covers what each of its three buttons leads to.
test.use({ signedIn: false });

test('a signed-out visitor is sent to the welcome screen', async ({ page }) => {
	const errors = consoleErrors(page);

	await page.goto('/');

	await expect(page).toHaveURL(/\/welcome$/);
	await expect(page.getByTestId('welcome')).toBeVisible();
	expect(errors).toEqual([]);
});

test('a protected screen redirects rather than rendering empty', async ({ page }) => {
	await page.goto('/progress');

	await expect(page).toHaveURL(/\/welcome$/);
});

test('the welcome screen explains what leechess is', async ({ page }) => {
	await page.goto('/welcome');

	// The primer, not just a login box: someone arriving cold should be able to
	// tell what this is before deciding whether to sign up.
	await expect(page.getByRole('heading', { name: 'Play', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Puzzles', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Endgames', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Literature', exact: true })).toBeVisible();
});

test('all three ways in are offered, and what playing costs is stated', async ({ page }) => {
	await page.goto('/welcome');

	await expect(page.getByTestId('welcome-play')).toBeVisible();
	await expect(page.getByTestId('welcome-signup')).toBeVisible();
	await expect(page.getByTestId('welcome-signin')).toBeVisible();

	// "Play now" keeps nothing, and that has to be said where the choice is
	// made rather than discovered afterwards on an empty Review screen.
	await expect(page.getByTestId('play-now-terms')).toContainText('keeps nothing');
});

test('the app nav is not offered while signed out', async ({ page }) => {
	await page.goto('/welcome');

	await expect(page.getByRole('link', { name: 'Review' })).toHaveCount(0);
	await expect(page.getByTestId('settings-button')).toHaveCount(0);
});

test('signing up warns that there is no password reset', async ({ page }) => {
	await page.goto('/welcome');
	await page.getByTestId('welcome-signup').click();

	// A deliberate product decision, so it has to be said where the password is
	// chosen rather than buried somewhere nobody reads.
	await expect(page.getByTestId('no-recovery-warning')).toBeVisible();
});

test('a taken username is reported instead of failing silently', async ({ page, request }) => {
	await request.post('http://localhost:8123/auth/register', {
		data: { username: 'taken', password: 'correct-horse' }
	});

	await page.goto('/welcome');
	await page.getByTestId('welcome-signup').click();
	await page.getByTestId('auth-username').fill('taken');
	await page.getByTestId('auth-password').fill('correct-horse');
	await page.getByTestId('auth-submit').click();

	await expect(page.getByTestId('auth-error')).toContainText('already taken');
	await expect(page).toHaveURL(/\/welcome$/);
});

test('nobody is asked for a name before they can play', async ({ page }) => {
	await page.goto('/welcome');

	// The one thing that used to stand between arriving and playing. A name is
	// only asked for where it is a login identifier, which is the sign-up form.
	await expect(page.getByTestId('auth-username')).toHaveCount(0);

	await page.getByTestId('welcome-play').click();

	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByTestId('auth-username')).toHaveCount(0);
});

test('a short password is reported', async ({ page }) => {
	await page.goto('/welcome');
	await page.getByTestId('welcome-signup').click();
	await page.getByTestId('auth-username').fill('newcomer');
	await page.getByTestId('auth-password').fill('short');
	await page.getByTestId('auth-submit').click();

	await expect(page.getByTestId('auth-error')).toContainText('8 characters');
});

test('signing in with the wrong password is reported', async ({ page, request }) => {
	await request.post('http://localhost:8123/auth/register', {
		data: { username: 'ada', password: 'correct-horse' }
	});

	await page.goto('/welcome');
	await page.getByTestId('welcome-signin').click();
	await page.getByTestId('auth-username').fill('ada');
	await page.getByTestId('auth-password').fill('wrong-one');
	await page.getByTestId('auth-submit').click();

	await expect(page.getByTestId('auth-error')).toContainText("don't match");
});

test('nothing on the welcome screen is behind a scroll on a desktop viewport', async ({ page }) => {
	// It is the first thing anyone sees; a landing page that opens mid-scroll
	// reads as broken. Both entry states are checked because the form is the
	// taller of the two. 1366x768 is the smallest desktop worth supporting.
	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto('/welcome');
	await expect(page.getByTestId('welcome')).toBeVisible();

	const overflow = () =>
		page.evaluate(() => ({
			down: document.documentElement.scrollHeight - window.innerHeight,
			across: document.documentElement.scrollWidth - document.documentElement.clientWidth
		}));

	expect(await overflow()).toEqual({ down: 0, across: 0 });

	await page.getByTestId('welcome-signup').click();
	await expect(page.getByTestId('no-recovery-warning')).toBeVisible();
	expect(await overflow()).toEqual({ down: 0, across: 0 });
});

test('the nav bar is not repeated above the welcome screen', async ({ page }) => {
	await page.goto('/welcome');

	// The page carries its own wordmark, and signed out there is nowhere to
	// navigate to — so the bar would duplicate the page beneath it.
	await expect(page.locator('nav')).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'leechess' })).toBeVisible();
});
