import { browser } from '$app/environment';
import { BOARD_THEMES, PIECE_SETS, type BoardTheme, type PieceSetId } from '$lib/boardThemes';

const THEME_KEY = 'leechess.boardTheme';
const PIECES_KEY = 'leechess.pieceSet';

/** User's board look, shared by every Board on every screen and persisted
 * locally. Defaults to Walnut × Merida — the pairing of the app's visual
 * identity — until the user picks their own in Settings. */
class BoardPrefs {
	themeName = $state<string>('walnut');
	pieceSet = $state<PieceSetId>('merida');

	constructor() {
		if (!browser) return;
		const theme = localStorage.getItem(THEME_KEY);
		if (theme && BOARD_THEMES.some((t) => t.name === theme)) this.themeName = theme;
		const pieces = localStorage.getItem(PIECES_KEY);
		if (pieces && PIECE_SETS.some((s) => s.id === pieces)) {
			this.pieceSet = pieces as PieceSetId;
		}
	}

	get theme(): BoardTheme {
		return BOARD_THEMES.find((t) => t.name === this.themeName) ?? BOARD_THEMES[0];
	}

	setTheme(name: string) {
		this.themeName = name;
		if (browser) localStorage.setItem(THEME_KEY, name);
	}

	setPieceSet(id: PieceSetId) {
		this.pieceSet = id;
		if (browser) localStorage.setItem(PIECES_KEY, id);
	}
}

export const boardPrefs = new BoardPrefs();
