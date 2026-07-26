/** Endgame-family display helpers. Slugs come from the server catalog
 * (server/app/endgame_drills.py) — keep the two lists in step. */

const FAMILY_LABELS: Record<string, string> = {
	'kp-key-squares': 'King and pawn — key squares',
	lucena: 'Lucena — building the bridge',
	philidor: 'Philidor — third-rank defense',
	'rook-pawn-conversion': 'Rook and pawn — conversion'
};

export function familyLabel(family: string): string {
	return FAMILY_LABELS[family] ?? family.replaceAll('-', ' ');
}
