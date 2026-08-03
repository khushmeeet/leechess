import { ApiError } from '$lib/api/client';
import {
	createLiveGame,
	getLiveGame,
	joinLiveGame,
	liveSocketUrl,
	type LiveSeat,
	type LiveState
} from '$lib/api/live';
import { GameStore, type PlayedMove } from './game.svelte';
import { clearSeat, loadSeat, saveSeat } from './liveSeat';
import { soundPrefs } from './soundPrefs.svelte';
import type { Key } from 'chessground/types';

/** How long to wait before each reconnect attempt, in ms. Doubles up to a
 * ceiling: a machine that fly.toml stopped comes back in seconds, and a
 * player who left the tab open overnight should not be hammering it. */
const RECONNECT_DELAYS = [500, 1000, 2000, 5000, 10000];

/** Sent on an interval so an idle game keeps its socket. Nothing in chess
 * says a player has to move within any particular minute, and a proxy that
 * closes quiet connections would otherwise disconnect the person thinking. */
const HEARTBEAT_MS = 25_000;

export type LiveStatus = 'connecting' | 'waiting' | 'playing' | 'finished' | 'gone';

/** Where this player's finished game was saved. Null for a seat with no
 * account — the game happened, and that is all. */
export interface SavedWhere {
	gameId: number;
	number: number | null;
}

/** One friend game as this browser sees it.
 *
 * The server is authoritative for everything: legality, whose turn it is,
 * when the game ended. This applies its own moves optimistically so the board
 * feels immediate, then reconciles against every state the server sends —
 * which it sends with every event, so there is only ever one way to be
 * corrected and it is exercised constantly rather than only after a failure.
 */
export class LiveSession {
	readonly token: string;

	game = new GameStore();

	/** The side this browser plays. Null while joining, and for a spectator —
	 * anyone who opened the link after both seats were taken. */
	color = $state<'white' | 'black' | null>(null);
	status = $state<LiveStatus>('connecting');
	/** True once a socket is open. False during a reconnect, which the screen
	 * says out loud rather than leaving a board that silently does nothing. */
	connected = $state(false);
	result = $state('*');
	endReason = $state<string | null>(null);
	white = $state<LiveSeat>(emptySeat());
	black = $state<LiveSeat>(emptySeat());
	drawOfferFrom = $state<'white' | 'black' | null>(null);
	/** Set when the server refused something — an illegal move, a move out of
	 * turn. Cleared on the next successful action. */
	error = $state<string | null>(null);
	saved = $state<SavedWhere | null>(null);

	/** Seconds until this player may claim a game their opponent left; 0 means
	 * now, null means there is nothing to claim. Seeded from the server and
	 * counted down locally — the server is asked again for real when the
	 * button is pressed, so this only has to be close enough to read. */
	claimWait = $state<number | null>(null);

	private socket: WebSocket | null = null;
	private seat: string | null = null;
	private attempt = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private closed = false;
	/** Plies the server has confirmed. An optimistic move sits beyond this
	 * until the echo arrives, and is rolled back if it never does. */
	private confirmedPlies = 0;
	private claimTimer: ReturnType<typeof setInterval> | null = null;

	constructor(token: string) {
		this.token = token;
	}

	get isSpectator(): boolean {
		return this.color === null;
	}

	get myTurn(): boolean {
		return this.status === 'playing' && this.color !== null && this.game.turnColor === this.color;
	}

	/** The seat opposite this one, or White's when watching. */
	get opponent(): LiveSeat {
		return this.color === 'white' ? this.black : this.white;
	}

	get me(): LiveSeat {
		return this.color === 'black' ? this.black : this.white;
	}

	/** Board orientation: your own side, or White's when watching. */
	get orientation(): 'white' | 'black' {
		return this.color ?? 'white';
	}

	/** Whether this player's game will be kept. Said on the screen, because it
	 * is the one thing that differs between the two ways of playing. */
	get willSave(): boolean {
		return this.me.saves;
	}

	/** The opponent left and the wait is over — the game can be taken. */
	get canClaim(): boolean {
		return this.claimWait !== null && this.claimWait <= 0;
	}

	/** They left, but not long enough ago yet. */
	get claimCountdown(): number | null {
		return this.claimWait !== null && this.claimWait > 0 ? Math.ceil(this.claimWait) : null;
	}

	/** Take a seat if there is one, then connect.
	 *
	 * Joining is automatic and asks nothing: the whole feature is that a link
	 * is enough. A browser that already has a seat for this game (a refresh,
	 * a second visit) reuses it rather than taking the other one.
	 */
	async start(): Promise<void> {
		const stored = loadSeat(this.token);
		if (stored) {
			this.seat = stored.seat;
			this.color = stored.color;
		} else {
			await this.claimSeat();
		}
		if (this.closed) return;
		this.connect();
	}

	private async claimSeat(): Promise<void> {
		try {
			const seated = await joinLiveGame(this.token);
			this.seat = seated.seat;
			this.color = seated.color;
			saveSeat(this.token, { seat: seated.seat, color: seated.color });
		} catch (error) {
			// 409: both seats taken, so this visitor watches. 404: no such game.
			// Neither is a failure to report — the socket says which it is.
			if (error instanceof ApiError && error.status === 404) this.status = 'gone';
		}
	}

	private connect(): void {
		if (this.closed) return;
		const socket = new WebSocket(liveSocketUrl(this.token, this.seat));
		this.socket = socket;

		socket.onopen = () => {
			if (this.closed) return socket.close();
			this.connected = true;
			this.attempt = 0;
			this.startHeartbeat();
		};
		socket.onmessage = (event) => this.receive(event.data);
		socket.onclose = () => {
			if (socket !== this.socket) return; // superseded by a newer socket
			this.connected = false;
			this.stopHeartbeat();
			this.scheduleReconnect();
		};
		// A failed connection also fires close; nothing to do here but keep the
		// error off the console as an unhandled event.
		socket.onerror = () => {};
	}

	private scheduleReconnect(): void {
		// A finished game has nothing left to deliver, and a link that does not
		// exist will not start existing.
		if (this.closed || this.status === 'finished' || this.status === 'gone') return;
		const delay = RECONNECT_DELAYS[Math.min(this.attempt, RECONNECT_DELAYS.length - 1)];
		this.attempt += 1;
		this.reconnectTimer = setTimeout(() => this.connect(), delay);
	}

	private startHeartbeat(): void {
		this.stopHeartbeat();
		this.heartbeatTimer = setInterval(() => {
			if (this.socket?.readyState === WebSocket.OPEN) {
				this.socket.send(JSON.stringify({ type: 'ping' }));
			}
		}, HEARTBEAT_MS);
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
		this.heartbeatTimer = null;
	}

	private receive(raw: string): void {
		let message: Record<string, unknown>;
		try {
			message = JSON.parse(raw);
		} catch {
			return;
		}
		const type = message.type;

		if (type === 'pong') return;
		if (type === 'saved') {
			this.saved = {
				gameId: message.game_id as number,
				number: (message.number as number | null) ?? null
			};
			return;
		}
		if (type === 'error') {
			this.error = (message.message as string) ?? 'That move was refused.';
			// The state rides along with a refusal, so a board that had drifted
			// is put back rather than left showing something that never happened.
			if (message.state) this.apply(message.state as LiveState);
			return;
		}
		if (message.state) {
			if (type === 'move') this.error = null;
			this.apply(message.state as LiveState);
		}
	}

	/** Reconcile with the server's version of the game.
	 *
	 * The move list is replayed rather than diffed: it is the whole game every
	 * time, GameStore.loadMoves re-derives SAN, FENs and game-over from it, and
	 * a replay that fails is a state this client should not be rendering
	 * anyway. Cheap at chess lengths, and it means there is exactly one path
	 * into the board — no separate "apply the opponent's move" branch that
	 * only runs when the socket is healthy.
	 */
	private apply(state: LiveState): void {
		const before = this.game.moves.length;
		const arrived = state.moves.length > this.confirmedPlies;

		if (!sameMoves(this.game.moves, state.moves)) {
			this.game.loadMoves(state.moves);
		}
		this.confirmedPlies = state.moves.length;

		const wasFinished = this.status === 'finished';
		this.status = state.status;
		this.result = state.result;
		this.endReason = state.end_reason;
		this.white = state.white;
		this.black = state.black;
		this.drawOfferFrom = state.draw_offer_from;
		this.setClaimWait(state.claim_wait);

		// The opponent's move, or one of ours the server had not confirmed yet.
		// Our own optimistic move already made its sound when it was played.
		if (arrived && state.moves.length > before) {
			soundPrefs.move(this.game.moves.at(-1)?.san ?? '', true);
		}
		if (state.status === 'finished' && !wasFinished) {
			soundPrefs.play('game-end');
			this.stopHeartbeat();
			this.stopClaimCountdown();
		}
	}

	/** A move from the board. Applied locally at once so the piece lands under
	 * the finger, and sent for the server to confirm or refuse. */
	handleBoardMove(orig: Key, dest: Key, promotion?: string): void {
		if (!this.myTurn || !this.connected) return;
		const played = this.game.tryMove(orig, dest, promotion);
		if (!played) {
			soundPrefs.play('illegal');
			return;
		}
		soundPrefs.move(played.san, false);
		this.send({ type: 'move', uci: played.uci });
	}

	resign(): void {
		if (this.isSpectator || this.status !== 'playing') return;
		this.send({ type: 'resign' });
	}

	offerDraw(): void {
		if (this.isSpectator || this.status !== 'playing') return;
		this.send({ type: 'draw-offer' });
	}

	acceptDraw(): void {
		if (this.isSpectator) return;
		this.send({ type: 'draw-accept' });
	}

	declineDraw(): void {
		if (this.isSpectator) return;
		this.drawOfferFrom = null;
		this.send({ type: 'draw-decline' });
	}

	/** Take a game the opponent walked out of. The server re-checks the wait
	 * itself, so a client that counted down wrong (a slept laptop, a fiddled
	 * clock) is refused rather than believed. */
	claim(): void {
		if (this.isSpectator || !this.canClaim) return;
		this.send({ type: 'claim' });
	}

	/** Seed the countdown from the server and tick it down locally. One
	 * interval, not a timer per update: presence arrives whenever a socket
	 * opens or closes, and each of those would otherwise leave a timer behind. */
	private setClaimWait(seconds: number | null): void {
		this.claimWait = seconds;
		if (seconds === null || seconds <= 0) {
			this.stopClaimCountdown();
			return;
		}
		if (this.claimTimer !== null) return;
		this.claimTimer = setInterval(() => {
			if (this.claimWait === null) return this.stopClaimCountdown();
			this.claimWait = Math.max(0, this.claimWait - 1);
			if (this.claimWait === 0) this.stopClaimCountdown();
		}, 1000);
	}

	private stopClaimCountdown(): void {
		if (this.claimTimer !== null) clearInterval(this.claimTimer);
		this.claimTimer = null;
	}

	/** Ask for the whole state again. The reconnect path does this for free
	 * (the handshake is a state message), so this is for the cases a socket
	 * cannot notice — a tab woken from background, a suspended laptop. */
	resync(): void {
		this.send({ type: 'sync' });
	}

	private send(message: Record<string, unknown>): void {
		if (this.socket?.readyState !== WebSocket.OPEN) return;
		this.socket.send(JSON.stringify(message));
	}

	/** Called when the screen unmounts. Stops the socket and every timer —
	 * a reconnect loop outliving its page would hold a socket open for a game
	 * nobody is looking at. */
	close(): void {
		this.closed = true;
		this.stopHeartbeat();
		this.stopClaimCountdown();
		if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
		const socket = this.socket;
		this.socket = null;
		socket?.close();
	}

	/** Give up this browser's claim on the seat, so the link can be taken up
	 * again. Used when starting a fresh game with the same friend. */
	releaseSeat(): void {
		clearSeat(this.token);
	}
}

function emptySeat(): LiveSeat {
	return { name: null, seated: false, present: false, saves: false };
}

function sameMoves(played: PlayedMove[], ucis: string[]): boolean {
	if (played.length !== ucis.length) return false;
	return played.every((move, index) => move.uci === ucis[index]);
}

/** Start a friend game and hand back the token to navigate to. The seat is
 * stored under that token, so the play screen finds it already claimed
 * instead of joining the game its own creator just made. */
export async function openFriendGame(
	color: 'white' | 'black' | 'random' = 'random',
	name?: string
): Promise<string> {
	const created = await createLiveGame(color, name);
	saveSeat(created.token, { seat: created.seat, color: created.color });
	return created.token;
}

/** Whether a link is worth opening at all, for the screens that want to say
 * "that game is over" rather than render an empty board. */
export async function peekLiveGame(token: string): Promise<LiveState | null> {
	try {
		return await getLiveGame(token);
	} catch {
		return null;
	}
}
