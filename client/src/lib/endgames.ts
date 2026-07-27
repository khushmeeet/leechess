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

/** SQLite drops the tzinfo `utcnow()` attaches, so the API serves naive
 * stamps that are really UTC. `new Date()` reads those as *local* time, which
 * shifts every due date by the viewer's offset — enough to show "in 5h" for a
 * drill that is due right now. Append the Z the server didn't send. */
export function parseUtc(iso: string): Date {
	return new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** When a drill comes back around: "due now" once its Leitner interval has
 * elapsed, otherwise a coarse countdown. */
export function dueLabel(dueAt: string, now: Date = new Date()): string {
	const ms = parseUtc(dueAt).getTime() - now.getTime();
	if (ms <= 0) return 'due now';
	if (ms < HOUR) return `in ${Math.max(1, Math.round(ms / MINUTE))}m`;
	if (ms < DAY) return `in ${Math.round(ms / HOUR)}h`;
	return `in ${Math.round(ms / DAY)}d`;
}

export function isDue(dueAt: string, now: Date = new Date()): boolean {
	return parseUtc(dueAt).getTime() <= now.getTime();
}
