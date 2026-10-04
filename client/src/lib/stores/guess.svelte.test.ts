import { beforeEach, describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({ evaluate: vi.fn() }));
vi.mock('$lib/stores/stockfish', () => ({ stockfish: engine }));

import { GuessSession } from './guess.svelte';

const OPERA = '1. e4 e5 2. Nf3 d6 3. d4 Bg4 1-0';

beforeEach(() => {
	vi.resetAllMocks();
});

describe('GuessSession', () => {
	it('starts on the player’s first move, with the other side played for them', () => {
		const asBlack = new GuessSession(OPERA, 'black', 'the Duke');
		expect(asBlack.index).toBe(1); // 1…e5 to guess; 1.e4 already played
		expect(asBlack.moveLabel).toBe('1…');
		expect(asBlack.lastMove).toEqual(['e2', 'e4']);
	});

	it('scores the master’s move in full without asking the engine', async () => {
		const session = new GuessSession(OPERA, 'white', 'Morphy');
		await session.guess('e2', 'e4');
		expect(engine.evaluate).not.toHaveBeenCalled();
		expect(session.status).toBe('revealed');
		expect(session.feedback?.points).toBe(5);
		expect(session.matched).toBe(1);
		// the game moves on: past 1…e5 to the next White move
		session.next();
		expect(session.index).toBe(2);
		expect(session.lastMove).toEqual(['e7', 'e5']);
	});

	it('weighs a different move against the master’s, from the guesser’s side', async () => {
		// after the guess d4: White +0.2; after the master's e4: White +0.3
		engine.evaluate.mockResolvedValueOnce({ cp: 20, bestMove: 'd7d5', depth: 12, lines: [] });
		engine.evaluate.mockResolvedValueOnce({ cp: 30, bestMove: 'e7e5', depth: 12, lines: [] });
		const session = new GuessSession(OPERA, 'white', 'Morphy');
		await session.guess('d2', 'd4');
		expect(session.feedback?.guess?.san).toBe('d4');
		expect(session.feedback?.points).toBe(5); // within a point of the same chances
		expect(session.feedback?.text).toMatch(/^d4 keeps 52%; Morphy’s e4 keeps 53%\. 5 points\.$/);
		expect(session.matched).toBe(0);
		expect(session.maxPoints).toBe(5);
	});

	it('shows the move on request for no points, and ends with the game', async () => {
		const session = new GuessSession(OPERA, 'white', 'Morphy');
		for (let i = 0; i < 3; i++) {
			session.skip();
			expect(session.status).toBe('revealed');
			session.next();
		}
		expect(session.status).toBe('done');
		expect(session.points).toBe(0);
		expect(session.maxPoints).toBe(0);
	});

	it('reports its totals after each scored guess, finished on the last one', async () => {
		const reports: unknown[] = [];
		const session = new GuessSession(OPERA, 'white', 'Morphy', (totals) => reports.push(totals));
		session.skip(); // a shown move scores nothing, so there is nothing to keep
		session.next();
		expect(reports).toEqual([]);

		await session.guess('g1', 'f3'); // 2.Nf3, the master's move
		expect(reports.at(-1)).toEqual({
			points: 5,
			maxPoints: 5,
			matched: 1,
			guessed: 1,
			finished: false
		});
		session.next();
		await session.guess('d2', 'd4'); // 3.d4 — White's last move in the score
		expect(reports.at(-1)).toMatchObject({ points: 10, guessed: 2, finished: true });
		session.next();
		expect(session.status).toBe('done');
		expect(reports.at(-1)).toMatchObject({ guessed: 2, finished: true });
	});
});
