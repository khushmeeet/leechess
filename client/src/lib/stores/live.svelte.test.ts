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

	constructor(public url: string) {
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
		...overrides
	};
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

	it('does not reconnect after the game is over', async () => {
		vi.useFakeTimers();
		try {
			const session = await whiteSession();
			FakeSocket.last!.deliver({
				type: 'end',
				reason: 'resignation',
				state: state({ status: 'finished', result: '1-0', end_reason: 'resignation' })
			});
			FakeSocket.last!.close();

			vi.advanceTimersByTime(60_000);

			expect(session.status).toBe('finished');
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
