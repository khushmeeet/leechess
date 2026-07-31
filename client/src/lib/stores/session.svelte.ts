import { browser } from '$app/environment';
import {
	getSession,
	login,
	logout,
	onUnauthorized,
	register,
	setUsername,
	type AccountUser
} from '$lib/api/client';
import { clearActiveGame } from './gamePersistence';

/** Pre-accounts, the player's name lived here and nowhere else. Read once on
 * first boot so an existing player finds their name already filled in on the
 * welcome screen instead of being asked cold. Never written again. */
const LEGACY_USERNAME_KEY = 'leechess.username';

/** Set while this browser is playing without an account. The one thing
 * anonymous play writes down, and it says nothing about who is playing —
 * without it a refresh would drop them back on the welcome screen mid-game. */
const ANONYMOUS_KEY = 'leechess.anonymous';

/** What the app calls a player who has no account. Not a name they chose and
 * not one they can change: nothing is being kept, so there is nothing for a
 * name to be attached to. */
export const ANONYMOUS_NAME = 'Anonymous';

/** Stands in for an account id in anything this browser keeps (see `owner`).
 * Not a name and not an identity — only enough to tell an anonymous game
 * apart from an account's, which is the line nothing may cross. */
export const ANONYMOUS_OWNER = 'anonymous';

function storedAnonymous(): boolean {
	return browser && localStorage.getItem(ANONYMOUS_KEY) === '1';
}

/** Who the browser is playing as.
 *
 * Two states, and they are not the same thing. Signed in: an account on the
 * server owns the games, puzzles and progress, hydrated once from GET
 * /auth/session — which answers 200 whether or not there is a session, so
 * being signed out is an ordinary state here rather than a caught error.
 * Anonymous: no account, no request, nothing written server-side — the board
 * and nothing else (see routes/welcome).
 *
 * `ready` is what the layout guard waits on: redirecting before the first
 * answer arrives would bounce every signed-in visitor through the welcome
 * screen on each reload.
 */
class Session {
	user = $state<AccountUser | null>(null);
	/** Playing without an account. Never true at the same time as `user`. */
	anonymous = $state(false);
	/** False until the first /auth/session answer lands. */
	ready = $state(false);

	get authenticated() {
		return this.user !== null;
	}

	/** Signed in or playing anonymously — either way there is somewhere to be
	 * other than the welcome screen. */
	get admitted() {
		return this.authenticated || this.anonymous;
	}

	get name() {
		if (this.user) return this.user.username;
		return this.anonymous ? ANONYMOUS_NAME : null;
	}

	/** Who anything kept in this browser belongs to — the account id, or
	 * `anonymous`. Not the username: a rename is the same player, and two
	 * accounts could hold the same name in turn. Null when nobody is playing
	 * yet, which is nobody to keep anything for. */
	get owner(): string | null {
		if (this.user) return this.user.id;
		return this.anonymous ? ANONYMOUS_OWNER : null;
	}

	/** The name this browser used before accounts existed, if any — a
	 * suggestion for the sign-up form, not an identity. */
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
			// A real session wins over the flag: signing in on a browser that
			// played anonymously before is signing in, not both at once.
			this.anonymous = this.user === null && storedAnonymous();
			this.ready = true;
		}
	}

	/** Start playing with no account. No request, nothing to fill in and
	 * nothing kept — which is the whole offer, and why there is no name to
	 * pick. */
	playAnonymously() {
		this.anonymous = true;
		if (browser) localStorage.setItem(ANONYMOUS_KEY, '1');
	}

	private stopPlayingAnonymously() {
		this.anonymous = false;
		if (browser) localStorage.removeItem(ANONYMOUS_KEY);
	}

	/** Whoever plays next is not whoever played last: drop what the browser was
	 * holding for them. Signing up is the case that matters — the game on the
	 * board belonged to nobody, and an account's first game must be one it
	 * actually played, not the one that happened to be in progress while the
	 * form was being filled in. (The play store refuses a game saved under
	 * another owner as well; this is the same rule applied at the moment the
	 * owner changes, so nothing sits in storage waiting to be refused.) */
	private startFresh() {
		clearActiveGame();
	}

	async register(username: string, password: string) {
		this.user = await register(username, password);
		this.stopPlayingAnonymously();
		this.startFresh();
	}

	async login(username: string, password: string) {
		this.user = await login(username, password);
		this.stopPlayingAnonymously();
		this.startFresh();
	}

	async rename(username: string) {
		this.user = await setUsername(username);
	}

	async signOut() {
		// Anonymous play has no server session to end, so there this is only
		// the flag — but it has to go either way, or signing out of an account
		// on a browser that played anonymously earlier would land back in it.
		this.stopPlayingAnonymously();
		this.startFresh();
		if (!this.authenticated) return;
		try {
			await logout();
		} finally {
			this.user = null;
		}
	}

	/** Called when a request comes back 401 — the cookie expired or the account
	 * is gone, and the app should stop pretending otherwise. The layout guard
	 * watches this, so clearing it is what sends them to /welcome. Deliberately
	 * not a fall back to anonymous play: they had games a moment ago, and
	 * quietly moving them somewhere those games do not exist is worse than
	 * asking them to sign in again. */
	clear() {
		this.user = null;
	}
}

export const session = new Session();

// Registered here rather than imported by the client, which would be a cycle.
onUnauthorized(() => session.clear());
