import { browser } from '$app/environment';

const THEME_KEY = 'leechess.theme';

export type ThemeMode = 'light' | 'dark' | 'system';

const MEDIA_QUERY = '(prefers-color-scheme: dark)';

function isThemeMode(value: string | null): value is ThemeMode {
	return value === 'light' || value === 'dark' || value === 'system';
}

/** Light/dark toggle, set from the nav's Settings menu and persisted across
 * sessions — same pattern as boardPrefs/displayPrefs. 'system' follows the
 * OS preference and stays live if it changes underneath the tab. The
 * resolved class is also set synchronously in app.html, ahead of hydration,
 * so there's no flash of the wrong theme on load. */
class ThemePrefs {
	mode = $state<ThemeMode>('system');

	constructor() {
		if (!browser) return;
		const stored = localStorage.getItem(THEME_KEY);
		if (isThemeMode(stored)) this.mode = stored;
		this.apply(this.mode);

		window.matchMedia(MEDIA_QUERY).addEventListener('change', () => {
			if (this.mode === 'system') this.apply('system');
		});
	}

	private apply(mode: ThemeMode) {
		const dark = mode === 'dark' || (mode === 'system' && window.matchMedia(MEDIA_QUERY).matches);
		document.documentElement.classList.toggle('dark', dark);
	}

	setMode(mode: ThemeMode) {
		this.mode = mode;
		if (browser) {
			localStorage.setItem(THEME_KEY, mode);
			this.apply(mode);
		}
	}
}

export const themePrefs = new ThemePrefs();
