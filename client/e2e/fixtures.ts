import { test as base, expect } from '@playwright/test';
import { API } from './helpers';

/** Every spec imports `test` from here instead of '@playwright/test'.
 *
 * Three guarantees the raw Playwright `test` cannot give:
 *
 * 1. The backend is the one playwright.config.ts started. The reset endpoint
 *    only exists when LEECHESS_TEST_RESET=on, which the config sets and a
 *    developer's ordinary `make dev` does not — so if the suite ever finds
 *    itself pointed at a real server, it fails loudly on the first test
 *    instead of quietly mutating that server's database.
 *
 * 2. A clean database per test. The suite used to delete data/e2e.db once at
 *    startup and let all 32 specs share whatever followed, which made
 *    assertions depend on the order files happen to run in ("this spec runs
 *    first alphabetically" is not a fixture contract) and on rows other specs
 *    left behind. Each test now starts from the same state: no games, no
 *    puzzles, no attempts, and a freshly seeded endgame catalog.
 *
 * 3. A signed-in account. Every screen but /welcome now needs one. Specs that
 *    are about being signed out opt back out with `test.use({ signedIn:
 *    false })`.
 *
 * Browser state needs no equivalent hook — Playwright already gives each test
 * its own context, so localStorage starts empty.
 */
export const test = base.extend<{ signedIn: boolean; cleanDatabase: void }>({
	signedIn: [true, { option: true }],

	cleanDatabase: [
		async ({ request, context, signedIn }, use) => {
			const response = await request.post(`${API}/testing/reset`);
			if (response.status() === 404) {
				throw new Error(
					`${API} is not the e2e backend: POST /testing/reset returned 404, which ` +
						'means LEECHESS_TEST_RESET is off there. Refusing to run against a ' +
						'server this suite did not start — its database is not a throwaway.'
				);
			}
			expect(response.ok()).toBe(true);
			// The catalog is startup state the endgame specs need; an empty
			// reseed would mean the endpoint cleared it without putting it back.
			expect((await response.json()).drills_seeded).toBeGreaterThan(0);

			if (signedIn) {
				// After the reset, never before: the truncate above clears `users`
				// too, so signing in first would leave the browser holding a
				// perfectly valid cookie whose subject no longer exists — and
				// every request in the spec would 401 for no visible reason.
				const guest = await request.post(`${API}/auth/guest`, {
					data: { username: 'e2e-player' }
				});
				expect(guest.ok()).toBe(true);

				// `request` and the browser context are separate cookie jars, and
				// specs use both — seeding games through `request`, then asserting
				// on them in the page. Copying the session across makes them the
				// same account, without which the seeded rows belong to nobody the
				// page is signed in as. Cookies ignore ports, so one set by the
				// API on :8123 is sent by the SPA on :4173.
				await context.addCookies((await request.storageState()).cookies);
			}

			await use();
		},
		{ auto: true }
	]
});

export { expect };
