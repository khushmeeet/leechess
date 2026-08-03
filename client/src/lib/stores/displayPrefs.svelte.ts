import { browser } from '$app/environment';

const EVAL_BAR_KEY = 'leechess.showEvalBar';
const COACH_KEY = 'leechess.showCoach';
const IDEAS_KEY = 'leechess.showIdeas';
const OPENING_THEORY_KEY = 'leechess.showOpeningTheory';
const HINT_MODE_KEY = 'leechess.hintMode';
const ZEN_MODE_KEY = 'leechess.zenMode';
const FRIEND_EVAL_BAR_KEY = 'leechess.friendEvalBar';
const FRIEND_BADGES_KEY = 'leechess.friendBadges';
const FRIEND_MOVE_LIST_KEY = 'leechess.friendMoveList';

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

	// ── Friend games ───────────────────────────────────────────────────────
	// A game against a person is a different thing from a game against the
	// engine, so it gets its own settings rather than inheriting these.
	//
	// The coach line and the ideas row have no toggle here at all: both state
	// what Stockfish would play, and an engine reading out the best move
	// beside a live opponent is not a display preference, it is the other
	// player being cheated. They are off in a friend game and stay off. What
	// is left is furniture — an eval bar, the classification badges, the move
	// list — and those default to a bare board, because the person who asked
	// for a chessboard and a link should get a chessboard and a link.

	/** Eval bar beside a friend game's board. */
	friendEvalBar = $state(false);
	/** Live Best-through-Blunder badges on your own moves in a friend game.
	 * Off by default: it runs the engine on every position, which is a
	 * strong hint about the one you are looking at. */
	friendBadges = $state(false);
	/** The move list. Not engine help — it is the game's own record — so this
	 * is the one that starts on. */
	friendMoveList = $state(true);

	constructor() {
		if (!browser) return;
		const evalBar = localStorage.getItem(EVAL_BAR_KEY);
		if (evalBar !== null) this.showEvalBar = evalBar === 'true';
		if (localStorage.getItem(COACH_KEY) === 'false') this.showCoach = false;
		if (localStorage.getItem(IDEAS_KEY) === 'false') this.showIdeas = false;
		if (localStorage.getItem(OPENING_THEORY_KEY) === 'true') this.showOpeningTheory = true;
		if (localStorage.getItem(ZEN_MODE_KEY) === 'true') this.zenMode = true;
		if (localStorage.getItem(FRIEND_EVAL_BAR_KEY) === 'true') this.friendEvalBar = true;
		if (localStorage.getItem(FRIEND_BADGES_KEY) === 'true') this.friendBadges = true;
		if (localStorage.getItem(FRIEND_MOVE_LIST_KEY) === 'false') this.friendMoveList = false;
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

	setFriendEvalBar(value: boolean) {
		this.friendEvalBar = value;
		if (browser) localStorage.setItem(FRIEND_EVAL_BAR_KEY, String(value));
	}

	setFriendBadges(value: boolean) {
		this.friendBadges = value;
		if (browser) localStorage.setItem(FRIEND_BADGES_KEY, String(value));
	}

	setFriendMoveList(value: boolean) {
		this.friendMoveList = value;
		if (browser) localStorage.setItem(FRIEND_MOVE_LIST_KEY, String(value));
	}
}

export const displayPrefs = new DisplayPrefs();
