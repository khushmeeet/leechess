/** Unit tests for LiveSession — the friend-game state machine.
 *
 * Everything this store does arrives over a socket, so the socket is the
 * seam: a fake one that lets a test deliver a server message and assert what
 * the board did with it. The cases that matter are the ones a browser suite
 * cannot make happen on purpose — a refused move, a socket that dies
 * mid-game, a server state that disagrees with what is on the board. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
	joinLiveGame: vi.fn(),
	createLiveGame: vi.fn(),
	getLiveGame: vi.fn(),
	liveSocketUrl: vi.fn(() => 'ws://test/live/tok/ws'),
	liveSocketProtocols: vi.fn((seat?: string | null) => (seat ? ['leechess.seat', seat] : [])),
	liveGameLink: vi.fn()
}));

const seats = vi.hoisted(() => ({
	loadSeat: vi.fn(),
	saveSeat: vi.fn(),
	clearSeat: vi.fn()
}));

const sound = vi.hoisted(() => ({ move: vi.fn(), play: vi.fn() }));

vi.mock('$lib/api/live', () => api);
vi.mock('./liveSeat', () => seats);
vi.mock('./soundPrefs.svelte', () => ({ soundPrefs: sound }));

/** Enough WebSocket for the store: it opens one, sends JSON down it, and
 * reacts to messages and closes. Tests drive it from the server side. */
class FakeSocket {
	static last: FakeSocket | null = null;
	static opened = 0;

	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;

	readyState = FakeSocket.CONNECTING;
	sent: Record<string, unknown>[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;

	constructor(
		public url: string,
		public protocols: string | string[] = []
	) {
		FakeSocket.last = this;
		FakeSocket.opened += 1;
	}

	/** The handshake the real server sends the moment a socket is accepted. */
	open() {
		this.readyState = FakeSocket.OPEN;
		this.onopen?.();
	}

	send(raw: string) {
		this.sent.push(JSON.parse(raw));
	}

	close() {
		this.readyState = FakeSocket.CLOSED;
		this.onclose?.();
	}

	/** Deliver a message from the server. */
	deliver(message: Record<string, unknown>) {
		this.onmessage?.({ data: JSON.stringify(message) });
	}
}

vi.stubGlobal('WebSocket', FakeSocket);

const { LiveSession } = await import('./live.svelte');

function state(overrides: Record<string, unknown> = {}) {
	return {
		token: 'tok',
		status: 'playing',
		result: '*',
		end_reason: null,
		moves: [],
		fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
		turn: 'white',
		white: { name: 'Ada', seated: true, present: true, saves: true },
		black: { name: 'Bo', seated: true, present: true, saves: false },
		joinable: false,
		draw_offer_from: null,
		rematch_offer_from: null,
		claim_wait: null,
		...overrides
	};
}

/** The same game, over — where a rematch starts from. */
function finished(overrides: Record<string, unknown> = {}) {
	return state({
		status: 'finished',
		result: '1-0',
		end_reason: 'resignation',
		moves: ['e2e4', 'e7e5'],
		...overrides
	});
}

/** A connected session holding the white seat, mid-game. */
async function whiteSession() {
	seats.loadSeat.mockReturnValue({ seat: 'seat-w', color: 'white' });
	const session = new LiveSession('tok');
	await session.start();
	FakeSocket.last!.open();
	FakeSocket.last!.deliver({ type: 'state', you: 'white', state: state() });
	return session;
}

beforeEach(() => {
	vi.clearAllMocks();
	FakeSocket.last = null;
	FakeSocket.opened = 0;
	seats.loadSeat.mockReturnValue(null);
	api.joinLiveGame.mockResolvedValue({
		token: 'tok',
		seat: 'seat-b',
		color: 'black',
		state: state()
	});
});

describe('taking a seat', () => {
	it('joins automatically — the link is the whole invitation', async () => {
		const session = new LiveSession('tok');
		await session.start();

		expect(api.joinLiveGame).toHaveBeenCalledWith('tok');
		expect(session.color).toBe('black');
		// Kept, so a refresh comes back to the same side rather than trying to
		// take the other one.
		expect(seats.saveSeat).toHaveBeenCalledWith('tok', { seat: 'seat-b', color: 'black' });
	});

	it('reuses a seat this browser already holds', async () => {
		seats.loadSeat.mockReturnValue({ seat: 'seat-w', color: 'white' });
		const session = new LiveSession('tok');
		await session.start();

		expect(api.joinLiveGame).not.toHaveBeenCalled();
		expect(session.color).toBe('white');
	});

	it('watches when both seats are taken', async () => {
		const { ApiError } = await import('$lib/api/client');
		api.joinLiveGame.mockRejectedValue(new ApiError(409, 'both taken'));
		const session = new LiveSession('tok');
		await session.start();

		expect(session.color).toBeNull();
		expect(session.isSpectator).toBe(true);
		// Still connects: watching is a thing you can do with a link.
		expect(FakeSocket.opened).toBe(1);
	});

	it('sends the seat as a subprotocol, never in the URL', async () => {
		// The seat is the only thing that authorizes a move, and a credential in
		// a query string is a credential in every access log and Referer that
		// touches the request. A browser cannot set headers on a WebSocket, so
		// the subprotocol list is the channel.
		seats.loadSeat.mockReturnValue({ seat: 'seat-w', color: 'white' });
		const session = new LiveSession('tok');
		await session.start();

		expect(FakeSocket.last?.protocols).toEqual(['leechess.seat', 'seat-w']);
		expect(FakeSocket.last?.url).not.toContain('seat-w');
		expect(api.liveSocketUrl).toHaveBeenCalledWith('tok');
	});

	it('offers no subprotocol when there is no seat to prove', async () => {
		const { ApiError } = await import('$lib/api/client');
		api.joinLiveGame.mockRejectedValue(new ApiError(409, 'both taken'));
		const session = new LiveSession('tok');
		await session.start();

		expect(FakeSocket.last?.protocols).toEqual([]);
	});
});

describe('playing', () => {
	it('applies its own move at once and sends it', async () => {
		const session = await whiteSession();

		session.handleBoardMove('e2', 'e4');

		expect(session.game.moves.map((m) => m.san)).toEqual(['e4']);
		expect(FakeSocket.last!.sent).toContainEqual({ type: 'move', uci: 'e2e4' });
	});

	it('refuses to move out of turn', async () => {
		const session = await whiteSession();
		FakeSocket.last!.deliver({
			type: 'move',
			state: state({ moves: ['e2e4'], turn: 'black' })
		});

		session.handleBoardMove('e7', 'e5');

		expect(session.game.moves).toHaveLength(1);
		expect(FakeSocket.last!.sent).not.toContainEqual({ type: 'move', uci: 'e7e5' });
	});

	it('shows the opponent’s move when it arrives', async () => {
		const session = await whiteSession();

		FakeSocket.last!.deliver({
			type: 'move',
			state: state({ moves: ['e2e4', 'e7e5'], turn: 'white' })
		});

		expect(session.game.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
		expect(session.myTurn).toBe(true);
	});

	it('rolls an optimistic move back when the server refuses it', async () => {
		// The board has to end up where the server says it is, not where this
		// client hoped — otherwise the two players are playing different games.
		const session = await whiteSession();
		session.handleBoardMove('e2', 'e4');
		expect(session.game.moves).toHaveLength(1);

		FakeSocket.last!.deliver({
			type: 'error',
			message: 'Not your turn.',
			state: state({ moves: [] })
		});

		expect(session.game.moves).toEqual([]);
		expect(session.error).toBe('Not your turn.');
	});

	it('clears the error once a move lands', async () => {
		const session = await whiteSession();
		FakeSocket.last!.deliver({ type: 'error', message: 'nope', state: state() });
		expect(session.error).toBe('nope');

		FakeSocket.last!.deliver({ type: 'move', state: state({ moves: ['e2e4'] }) });

		expect(session.error).toBeNull();
	});

	it('will not move while the socket is down', async () => {
		const session = await whiteSession();
		FakeSocket.last!.close();

		session.handleBoardMove('e2', 'e4');

		expect(session.game.moves).toEqual([]);
	});
});

describe('reconnecting', () => {
	it('opens a new socket after one drops, and replays the game', async () => {
		vi.useFakeTimers();
		try {
			const session = await whiteSession();
			FakeSocket.last!.deliver({ type: 'move', state: state({ moves: ['e2e4', 'e7e5'] }) });
			expect(session.connected).toBe(true);

			FakeSocket.last!.close();
			expect(session.connected).toBe(false);

			vi.advanceTimersByTime(600);
			expect(FakeSocket.opened).toBe(2);

			// The handshake is the resync — no separate catch-up path.
			FakeSocket.last!.open();
			FakeSocket.last!.deliver({
				type: 'state',
				you: 'white',
				state: state({ moves: ['e2e4', 'e7e5', 'g1f3'] })
			});

			expect(session.connected).toBe(true);
			expect(session.game.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3']);
		} finally {
			vi.useRealTimers();
		}
	});

	it('stays up after the game is over, so a rematch can still reach it', async () => {
		// A finished game used to be the end of the socket. The same link can be
		// played again now, and the other player asking for that arrives over
		// this connection — so dropping it would leave the offer nowhere to land
		// and both players pressing a button that did nothing.
		vi.useFakeTimers();
		try {
			const session = await whiteSession();
			FakeSocket.last!.deliver({ type: 'end', reason: 'resignation', state: finished() });
			FakeSocket.last!.close();

			vi.advanceTimersByTime(600);

			expect(session.status).toBe('finished');
			expect(FakeSocket.opened).toBe(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('gives up on a link that does not exist', async () => {
		// The one status worth abandoning: a game that was never there, or was
		// swept, will not start existing on the fifth attempt.
		vi.useFakeTimers();
		try {
			const { ApiError } = await import('$lib/api/client');
			api.joinLiveGame.mockRejectedValue(new ApiError(404, 'no game with that link'));
			const session = new LiveSession('tok');
			await session.start();
			FakeSocket.last!.close();

			vi.advanceTimersByTime(60_000);

			expect(session.status).toBe('gone');
			expect(FakeSocket.opened).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('stops everything when the screen closes', async () => {
		vi.useFakeTimers();
		try {
			const session = await whiteSession();
			session.close();

			vi.advanceTimersByTime(60_000);

			expect(FakeSocket.opened).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('ending', () => {
	it('records the result and the reason', async () => {
		const session = await whiteSession();

		FakeSocket.last!.deliver({
			type: 'end',
			reason: 'checkmate',
			state: state({ status: 'finished', result: '1-0', end_reason: 'checkmate' })
		});

		expect(session.status).toBe('finished');
		expect(session.result).toBe('1-0');
		expect(session.endReason).toBe('checkmate');
		expect(sound.play).toHaveBeenCalledWith('game-end');
	});

	it('remembers where a saved game landed', async () => {
		const session = await whiteSession();

		FakeSocket.last!.deliver({ type: 'saved', game_id: 7, number: 3 });

		expect(session.saved).toEqual({ gameId: 7, number: 3 });
	});

	it('says whether this side is being kept at all', async () => {
		const session = await whiteSession();

		// White signed in, Black did not — see the fixture.
		expect(session.willSave).toBe(true);
		expect(session.opponent.saves).toBe(false);
	});
});

describe('an opponent who walked off', () => {
	it('counts the wait down and only then offers the claim', async () => {
		vi.useFakeTimers();
		try {
			const session = await whiteSession();
			expect(session.claimWait).toBeNull();
			expect(session.canClaim).toBe(false);

			FakeSocket.last!.deliver({ type: 'presence', state: state({ claim_wait: 3 }) });
			expect(session.claimCountdown).toBe(3);
			expect(session.canClaim).toBe(false);

			vi.advanceTimersByTime(3000);

			expect(session.canClaim).toBe(true);
			expect(session.claimCountdown).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it('will not send a claim before the wait is up', async () => {
		const session = await whiteSession();
		FakeSocket.last!.deliver({ type: 'presence', state: state({ claim_wait: 30 }) });

		session.claim();

		expect(FakeSocket.last!.sent).not.toContainEqual({ type: 'claim' });
	});

	it('sends the claim once the wait is up', async () => {
		const session = await whiteSession();
		FakeSocket.last!.deliver({ type: 'presence', state: state({ claim_wait: 0 }) });

		session.claim();

		expect(FakeSocket.last!.sent).toContainEqual({ type: 'claim' });
	});

	it('stops counting when the opponent comes back', async () => {
		vi.useFakeTimers();
		try {
			const session = await whiteSession();
			FakeSocket.last!.deliver({ type: 'presence', state: state({ claim_wait: 30 }) });
			FakeSocket.last!.deliver({ type: 'presence', state: state({ claim_wait: null }) });

			vi.advanceTimersByTime(60_000);

			expect(session.claimWait).toBeNull();
			expect(session.canClaim).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it('tells a spectator nothing about claiming', async () => {
		const { ApiError } = await import('$lib/api/client');
		api.joinLiveGame.mockRejectedValue(new ApiError(409, 'both taken'));
		const session = new LiveSession('tok');
		await session.start();
		FakeSocket.last!.open();
		// The server never sends a spectator a wait, but the button must not
		// appear even if one arrived.
		FakeSocket.last!.deliver({ type: 'state', you: null, state: state({ claim_wait: 0 }) });

		session.claim();

		expect(FakeSocket.last!.sent).toEqual([]);
	});
});

describe('draws', () => {
	it('passes an offer through and answers it', async () => {
		const session = await whiteSession();

		FakeSocket.last!.deliver({
			type: 'draw-offer',
			from: 'black',
			state: state({ draw_offer_from: 'black' })
		});
		expect(session.drawOfferFrom).toBe('black');

		session.acceptDraw();
		expect(FakeSocket.last!.sent).toContainEqual({ type: 'draw-accept' });
	});

	it('lets a spectator do nothing at all', async () => {
		const { ApiError } = await import('$lib/api/client');
		api.joinLiveGame.mockRejectedValue(new ApiError(409, 'both taken'));
		const session = new LiveSession('tok');
		await session.start();
		FakeSocket.last!.open();
		FakeSocket.last!.deliver({ type: 'state', you: null, state: state() });

		session.handleBoardMove('e2', 'e4');
		session.resign();
		session.offerDraw();

		expect(session.game.moves).toEqual([]);
		expect(FakeSocket.last!.sent).toEqual([]);
	});
});

describe('playing the same link again', () => {
	/** A finished game, from the white seat — where a rematch starts. */
	async function afterTheGame() {
		const session = await whiteSession();
		FakeSocket.last!.deliver({ type: 'end', reason: 'resignation', state: finished() });
		FakeSocket.last!.deliver({ type: 'saved', game_id: 7, number: 3 });
		return session;
	}

	it('asks, and leaves the board alone until the other player answers', async () => {
		// One press must not clear the other player's result panel — the link to
		// the game they just had saved is on it, and they may still be reading.
		const session = await afterTheGame();

		session.offerRematch();
		FakeSocket.last!.deliver({
			type: 'rematch-offer',
			from: 'white',
			you: 'white',
			state: finished({ rematch_offer_from: 'white' })
		});

		expect(FakeSocket.last!.sent).toContainEqual({ type: 'rematch' });
		expect(session.rematchAsked).toBe(true);
		expect(session.rematchOffered).toBe(false);
		expect(session.status).toBe('finished');
		expect(session.game.moves.map((move) => move.san)).toEqual(['e4', 'e5']);
	});

	it('shows the other player asking', async () => {
		const session = await afterTheGame();

		FakeSocket.last!.deliver({
			type: 'rematch-offer',
			from: 'black',
			you: 'white',
			state: finished({ rematch_offer_from: 'black' })
		});

		expect(session.rematchOffered).toBe(true);
		expect(session.rematchAsked).toBe(false);
	});

	it('starts the next game on the same link, taking the swapped seat', async () => {
		const session = await afterTheGame();
		expect(session.saved).not.toBeNull();

		// Both have pressed: the server resets the row and swaps the seats, so
		// this browser is Black now on the token it already had.
		FakeSocket.last!.deliver({ type: 'restart', you: 'black', state: state() });

		expect(session.token).toBe('tok');
		expect(session.color).toBe('black');
		expect(session.orientation).toBe('black');
		expect(session.status).toBe('playing');
		expect(session.game.moves).toEqual([]);
		expect(session.result).toBe('*');
		expect(session.rematchOfferFrom).toBeNull();
		// The previous game's review link belongs to the previous game.
		expect(session.saved).toBeNull();
		// And the stored seat follows, or a refresh would come back to the
		// colour this browser used to hold.
		expect(seats.saveSeat).toHaveBeenCalledWith('tok', { seat: 'seat-w', color: 'black' });
	});

	it('will not ask while the game is still being played', async () => {
		const session = await whiteSession();

		session.offerRematch();

		expect(FakeSocket.last!.sent).not.toContainEqual({ type: 'rematch' });
	});

	it('lets a spectator neither ask nor answer', async () => {
		const { ApiError } = await import('$lib/api/client');
		api.joinLiveGame.mockRejectedValue(new ApiError(409, 'both taken'));
		const session = new LiveSession('tok');
		await session.start();
		FakeSocket.last!.open();
		FakeSocket.last!.deliver({ type: 'state', you: null, state: finished() });

		session.offerRematch();
		session.declineRematch();

		expect(FakeSocket.last!.sent).toEqual([]);
	});
});

describe('a link that is gone', () => {
	it('stops reconnecting when the socket says the game was swept', async () => {
		// A browser holding a stored seat never asks the REST side about the
		// game, so the socket is the only thing that can tell it. Without that,
		// the reconnect loop — which runs past the end of a game now, so a
		// rematch can still arrive — would knock at a dead link forever.
		vi.useFakeTimers();
		try {
			seats.loadSeat.mockReturnValue({ seat: 'seat-w', color: 'white' });
			const session = new LiveSession('tok');
			await session.start();
			FakeSocket.last!.open();
			FakeSocket.last!.deliver({
				type: 'error',
				reason: 'gone',
				message: 'No game with that link.'
			});
			FakeSocket.last!.close();

			vi.advanceTimersByTime(60_000);

			expect(session.status).toBe('gone');
			expect(FakeSocket.opened).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});
});
