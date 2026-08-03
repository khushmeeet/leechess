// Friend games: the REST handshake (open a game, take a seat) and the URL of
// the socket the game itself runs over. The socket protocol lives in
// stores/live.svelte.ts; this file only knows how to reach it.
import { API_BASE, request } from './client';

export interface LiveSeat {
	name: string | null;
	/** Somebody has taken this seat — the link is only joinable until both are. */
	seated: boolean;
	/** A socket for this seat is open right now. Presence, not membership: a
	 * player who closes the tab keeps their seat and can come back to it. */
	present: boolean;
	/** Whether this side's moves are saved and analyzed when the game ends.
	 * True exactly when the person in the seat was signed in. */
	saves: boolean;
}

export interface LiveState {
	token: string;
	status: 'waiting' | 'playing' | 'finished';
	result: string;
	end_reason: string | null;
	/** UCI, in order — the whole game, every time. */
	moves: string[];
	fen: string;
	turn: 'white' | 'black';
	white: LiveSeat;
	black: LiveSeat;
	joinable: boolean;
	/** The colour that has a draw offer standing, for the two players only. */
	draw_offer_from: 'white' | 'black' | null;
	/** Seconds until this player may claim a game their opponent walked out
	 * of; 0 means now, null means there is nothing to claim. A remaining
	 * duration rather than a deadline, so the two ends never have to agree
	 * about what time it is. */
	claim_wait: number | null;
}

export interface LiveSeated {
	token: string;
	/** The credential for moving as `color`. Kept in localStorage, never shown. */
	seat: string;
	color: 'white' | 'black';
	state: LiveState;
}

/** Open a game and take a seat. `color` defaults to random, because the
 * person sharing the link should not have to think about it. */
export function createLiveGame(
	color: 'white' | 'black' | 'random' = 'random',
	name?: string
): Promise<LiveSeated> {
	return request('/live', {
		method: 'POST',
		body: JSON.stringify({ color, ...(name ? { name } : {}) })
	});
}

/** Take the open seat. Throws ApiError 409 once both are taken — the caller
 * watches instead, which needs nothing asked of them. */
export function joinLiveGame(token: string, name?: string): Promise<LiveSeated> {
	return request(`/live/${encodeURIComponent(token)}/join`, {
		method: 'POST',
		body: JSON.stringify(name ? { name } : {})
	});
}

export function getLiveGame(token: string, seat?: string | null): Promise<LiveState> {
	const suffix = seat ? `?seat=${encodeURIComponent(seat)}` : '';
	return request(`/live/${encodeURIComponent(token)}${suffix}`);
}

/** The socket URL for a game.
 *
 * Derived from the same base the REST calls use, so the dev split (SPA on
 * :5173, API on :8000) and a deploy (one origin) both work without a second
 * setting to keep in step. A relative base means same-origin, which is what
 * the deployed build ships — `location` supplies the rest.
 */
export function liveSocketUrl(token: string, seat?: string | null): string {
	const base = API_BASE || (typeof location === 'undefined' ? '' : location.origin);
	const url = new URL(`/live/${encodeURIComponent(token)}/ws`, base);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	if (seat) url.searchParams.set('seat', seat);
	return url.toString();
}

/** Where a friend game lives. The whole invitation — nothing else has to be
 * sent, and nothing else identifies it. */
export function liveGameLink(token: string): string {
	const origin = typeof location === 'undefined' ? '' : location.origin;
	return `${origin}/play/${token}`;
}
