import { browser } from '$app/environment';

const USERNAME_KEY = 'leechess.username';

/** Player's display name: shown in the nav, sent as "white" when a new game
 * is created, and echoed back by the server in Review. Persisted locally;
 * null until the first-run prompt is answered (or Settings is used later). */
class UsernamePrefs {
	name = $state<string | null>(null);
	/** Session-only — hides the first-run prompt after "Not now" without
	 * writing anything to storage, so it asks again next time there's no
	 * name saved. */
	dismissed = $state(false);

	constructor() {
		if (!browser) return;
		this.name = localStorage.getItem(USERNAME_KEY);
	}

	set(value: string) {
		const trimmed = value.trim();
		if (!trimmed) return;
		this.name = trimmed;
		if (browser) localStorage.setItem(USERNAME_KEY, trimmed);
	}

	dismiss() {
		this.dismissed = true;
	}
}

export const usernamePrefs = new UsernamePrefs();
