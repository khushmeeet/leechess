import { browser } from '$app/environment';

const EVAL_BAR_KEY = 'leechess.showEvalBar';
const COACH_KEY = 'leechess.showCoach';
const IDEAS_KEY = 'leechess.showIdeas';

/** In-game display toggles (eval bar, coach line, ideas row), set from the
 * nav's Settings menu and persisted across sessions — same pattern as
 * boardPrefs. */
class DisplayPrefs {
	showEvalBar = $state(false);
	showCoach = $state(true);
	showIdeas = $state(true);

	constructor() {
		if (!browser) return;
		const evalBar = localStorage.getItem(EVAL_BAR_KEY);
		if (evalBar !== null) this.showEvalBar = evalBar === 'true';
		if (localStorage.getItem(COACH_KEY) === 'false') this.showCoach = false;
		if (localStorage.getItem(IDEAS_KEY) === 'false') this.showIdeas = false;
	}

	setEvalBar(value: boolean) {
		this.showEvalBar = value;
		if (browser) localStorage.setItem(EVAL_BAR_KEY, String(value));
	}

	setCoach(value: boolean) {
		this.showCoach = value;
		if (browser) localStorage.setItem(COACH_KEY, String(value));
	}

	setIdeas(value: boolean) {
		this.showIdeas = value;
		if (browser) localStorage.setItem(IDEAS_KEY, String(value));
	}
}

export const displayPrefs = new DisplayPrefs();
