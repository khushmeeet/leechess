import { browser } from '$app/environment';

const EVAL_BAR_KEY = 'leechess.showEvalBar';
const COACH_KEY = 'leechess.showCoach';
const IDEAS_KEY = 'leechess.showIdeas';
const OPENING_THEORY_KEY = 'leechess.showOpeningTheory';
const HINT_MODE_KEY = 'leechess.hintMode';
const ZEN_MODE_KEY = 'leechess.zenMode';

/** Live in-game hint level (Play). `off` = a "real game" with no help; `nudge`
 * = the pre-move "Checks, captures, threats?" prompt only; `full` = that plus
 * the tactic ladder (Levels 1-5) when a recognized tactic is on the board. */
export type HintMode = 'off' | 'nudge' | 'full';
const HINT_MODES: HintMode[] = ['off', 'nudge', 'full'];

/** Display toggles (eval bar, coach line, ideas row, Review's opening-theory
 * panel, Play's hint mode), set from the nav's Settings menu / Play screen and
 * persisted across sessions — same pattern as boardPrefs. */
class DisplayPrefs {
	showEvalBar = $state(false);
	showCoach = $state(true);
	showIdeas = $state(true);
	showOpeningTheory = $state(false);
	/** Persisted default carried into each new game; changeable per game. */
	hintMode = $state<HintMode>('full');
	/** Play stripped to the board alone — no nav, no panels, no eval bar. Every
	 * other display toggle is about what sits AROUND the board; this one is
	 * about whether anything does, so it overrides them rather than joining
	 * them. Scoped to Play by the layout: the other screens are reading
	 * screens, and hiding the nav on one would leave no way off it. */
	zenMode = $state(false);

	constructor() {
		if (!browser) return;
		const evalBar = localStorage.getItem(EVAL_BAR_KEY);
		if (evalBar !== null) this.showEvalBar = evalBar === 'true';
		if (localStorage.getItem(COACH_KEY) === 'false') this.showCoach = false;
		if (localStorage.getItem(IDEAS_KEY) === 'false') this.showIdeas = false;
		if (localStorage.getItem(OPENING_THEORY_KEY) === 'true') this.showOpeningTheory = true;
		if (localStorage.getItem(ZEN_MODE_KEY) === 'true') this.zenMode = true;
		const hintMode = localStorage.getItem(HINT_MODE_KEY);
		if (hintMode !== null && HINT_MODES.includes(hintMode as HintMode)) {
			this.hintMode = hintMode as HintMode;
		}
	}

	setZenMode(value: boolean) {
		this.zenMode = value;
		if (browser) localStorage.setItem(ZEN_MODE_KEY, String(value));
	}

	setHintMode(value: HintMode) {
		this.hintMode = value;
		if (browser) localStorage.setItem(HINT_MODE_KEY, value);
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

	setOpeningTheory(value: boolean) {
		this.showOpeningTheory = value;
		if (browser) localStorage.setItem(OPENING_THEORY_KEY, String(value));
	}
}

export const displayPrefs = new DisplayPrefs();
