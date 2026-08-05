/** Seat credentials for friend games, one per game.
 *
 * A seat token is what lets this browser move for a side, and it is the only
 * identity a friend game has — the whole point is that neither player needs
 * an account. So it has to survive a refresh, which is what this is for.
 *
 * Deliberately not `leechess.activeGame`. That key holds the engine game and
 * is a single slot keyed by owner (see gamePersistence.ts); a friend game
 * writing there would destroy whatever game was on the board when the link
 * was opened, and signing in clears it, which would strand a live game
 * mid-move. These are separate keys with separate lifetimes.
 */

const PREFIX = 'leechess.liveSeat.';

function storage(): Storage | null {
	// `typeof` guard rather than $app/environment, so this module stays
	// importable from node-side unit tests — same reason gamePersistence does it.
	return typeof localStorage === 'undefined' ? null : localStorage;
}

export interface StoredSeat {
	seat: string;
	color: 'white' | 'black';
}

export function loadSeat(token: string): StoredSeat | null {
	const raw = storage()?.getItem(PREFIX + token);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed?.seat !== 'string' || !parsed.seat) return null;
		if (parsed.color !== 'white' && parsed.color !== 'black') return null;
		return { seat: parsed.seat, color: parsed.color };
	} catch {
		return null;
	}
}

export function saveSeat(token: string, seat: StoredSeat): void {
	try {
		storage()?.setItem(PREFIX + token, JSON.stringify(seat));
	} catch {
		// quota / private mode: the seat just doesn't survive a refresh, and
		// the player rejoins as a spectator rather than losing the game
	}
}

export function clearSeat(token: string): void {
	storage()?.removeItem(PREFIX + token);
}

/** Drop every seat this browser is holding.
 *
 * For signing in and signing out. A seat token is a credential with no expiry
 * and no account behind it — whoever holds it may move as that side — so
 * leaving them in storage means the next person at a shared browser inherits
 * every friend game the last one was playing. `clearActiveGame` has always
 * done this for the engine game; these keys were simply missed.
 */
export function clearAllSeats(): void {
	const store = storage();
	if (!store) return;
	const keys: string[] = [];
	for (let index = 0; index < store.length; index += 1) {
		const key = store.key(index);
		if (key?.startsWith(PREFIX)) keys.push(key);
	}
	// Collected first: removing while iterating shifts the indices underneath.
	for (const key of keys) store.removeItem(key);
}
