/** What each mistake cause means to the player (server app/mistakes.py
 * decides which one a move gets). Each names the step of the thinking
 * routine that broke, and the habit that would have caught it — the thing
 * to practise, which a motif success rate never says. */

export type MistakeCause =
	'missed_threat' | 'hung_piece' | 'allowed_reply' | 'missed_tactic' | 'positional';

export interface CauseCopy {
	/** Short name, for the Progress bars and the Review chip. */
	label: string;
	/** What happened, about one move: "Your move left their threat on the board." */
	what: string;
	/** The habit that would have caught it, as an instruction. */
	habit: string;
}

export const MISTAKE_CAUSES: Record<MistakeCause, CauseCopy> = {
	missed_threat: {
		label: 'Missed their threat',
		what: 'Their last move threatened something, and your move left it on the board.',
		habit: 'Before every move, ask what their last move threatens.'
	},
	hung_piece: {
		label: 'Left a piece hanging',
		what: 'Your move left a piece where they could take it for free.',
		habit: 'Before you move, look at every capture they would have after it.'
	},
	allowed_reply: {
		label: 'Allowed a forcing reply',
		what: 'Your move allowed a check, a mate or a tactic.',
		habit: 'Before you move, look at their checks, captures and threats after it.'
	},
	missed_tactic: {
		label: 'Missed your own tactic',
		what: 'You had a tactic or a free capture, and played something else.',
		habit: 'Look for your own checks, captures and threats first.'
	},
	positional: {
		label: 'Drifted',
		what: 'No single tactic: the position slipped.',
		habit: 'Compare two or three candidate moves before you choose one.'
	}
};

export function isMistakeCause(value: string | null | undefined): value is MistakeCause {
	return value !== null && value !== undefined && value in MISTAKE_CAUSES;
}
