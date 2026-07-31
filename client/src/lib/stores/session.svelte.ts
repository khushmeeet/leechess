import { browser } from '$app/environment';
import {
	getSession,
	login,
	logout,
	onUnauthorized,
	register,
	setUsername,
	startAsGuest,
	upgradeAccount,
	type AccountUser
} from '$lib/api/client';

/** Pre-accounts, the player's name lived here and nowhere else. Read once on
 * first boot so an existing player finds their name already filled in on the
 * welcome screen instead of being asked cold. Never written again. */
const LEGACY_USERNAME_KEY = 'leechess.username';

/** Who the browser is signed in as.
 *
 * One instance for the whole app, hydrated once from GET /auth/session — which
 * answers 200 whether or not there is a session, so being signed out is an
 * ordinary state here rather than a caught error. `ready` is what the layout
 * guard waits on: redirecting before the first answer arrives would bounce
 * every signed-in visitor through the welcome screen on each reload.
 */
class Session {
	user = $state<AccountUser | null>(null);
	/** False until the first /auth/session answer lands. */
	ready = $state(false);

	get authenticated() {
		return this.user !== null;
	}

	get isGuest() {
		return this.user?.is_guest ?? false;
	}

	get name() {
		return this.user?.username ?? null;
	}

	/** The name this browser used before accounts existed, if any — a
	 * suggestion for the welcome screen, not an identity. */
	get suggestedName() {
		if (!browser) return null;
		return localStorage.getItem(LEGACY_USERNAME_KEY);
	}

	async load() {
		try {
			this.user = (await getSession()).user;
		} catch {
			// Backend unreachable. Treated as signed out: the welcome screen is
			// the honest thing to show, and it is where a retry starts anyway.
			this.user = null;
		} finally {
			this.ready = true;
		}
	}

	async register(username: string, password: string) {
		this.user = await register(username, password);
	}

	async login(username: string, password: string) {
		this.user = await login(username, password);
	}

	async startAsGuest(username: string) {
		this.user = await startAsGuest(username);
	}

	/** Guest chooses a password. Same account, same id, same games — the
	 * server upgrades the row in place, so there is nothing to re-fetch. */
	async upgrade(password: string) {
		this.user = await upgradeAccount(password);
	}

	async rename(username: string) {
		this.user = await setUsername(username);
	}

	async signOut() {
		try {
			await logout();
		} finally {
			this.user = null;
		}
	}

	/** Called when a request comes back 401 — the cookie expired or the account
	 * is gone, and the app should stop pretending otherwise. The layout guard
	 * watches `user`, so clearing it is what sends them to /welcome. */
	clear() {
		this.user = null;
	}
}

export const session = new Session();

// Registered here rather than imported by the client, which would be a cycle.
onUnauthorized(() => session.clear());
