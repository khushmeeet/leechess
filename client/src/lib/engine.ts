/** Stockfish opponent metadata shared between the play screen (the strength
 * picker) and game labeling (the name stored for the engine's seat). Keeping
 * the presets here means the label on a saved game always matches the option
 * the player actually chose. */

export interface StrengthPreset {
	/** Stockfish "Skill Level" (see stockfish.ts) — the search strength. */
	skill: number;
	/** Human-facing name for the preset, used in the picker and game labels. */
	label: string;
	/** Approximate Elo the skill level plays at, shown in the picker. */
	elo: string;
}

export const strengthPresets: StrengthPreset[] = [
	{ skill: 1, label: 'Beginner', elo: '1470' },
	{ skill: 3, label: 'Casual', elo: '1740' },
	{ skill: 5, label: 'Club', elo: '2200' },
	{ skill: 10, label: 'Strong', elo: '2790' },
	{ skill: 20, label: 'Max', elo: '3200+' }
];

/** Display name for the engine's seat in a game, e.g. "Stockfish (Club)" — so
 * a review row reads "<player> vs Stockfish (Club)" and captures which
 * strength was faced. Falls back to the raw level for any off-preset skill. */
export function engineName(skill: number): string {
	const preset = strengthPresets.find((p) => p.skill === skill);
	return preset ? `Stockfish (${preset.label})` : `Stockfish (level ${skill})`;
}
