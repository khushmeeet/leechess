import { Chess } from 'chess.js';
import { describe, expect, it, vi } from 'vitest';

// judgeDrill and canStillWin are pure, but importing them pulls in the
// session's engine/sound/API seams — stub them the way play.svelte.test.ts
// does so the module graph resolves outside SvelteKit.
vi.mock('$lib/stores/soundPrefs.svelte', () => ({
	soundPrefs: { enabled: false, play: vi.fn(), move: vi.fn(), setEnabled: vi.fn() }
}));
vi.mock('$lib/stores/stockfish', () => ({
	stockfish: { warmup: vi.fn(), evaluate: vi.fn(), play: vi.fn() }
}));

import {
	canStillWin,
	describeOutcome,
	judgeDrill,
	MOVE_CAP,
	type DrillOutcome,
	type JudgeContext
} from './endgameDrill.svelte';

/** judgeDrill inspects the position only, so tests build one straight from a
 * FEN — no board, no engine, no session. */
function judge(fen: string, ctx: Partial<JudgeContext> & Pick<JudgeContext, 'goal'>) {
	return judgeDrill(new Chess(fen), {
		playerColor: 'white',
		playerMoves: 0,
		...ctx
	});
}

describe('canStillWin', () => {
	it('is true while the side has a pawn to promote', () => {
		expect(canStillWin(new Chess('8/8/8/3k4/8/3K4/3P4/8 w - - 0 1'), 'white')).toBe(true);
	});

	it('is false for a bare king', () => {
		expect(canStillWin(new Chess('8/8/8/3k4/8/3K4/8/8 w - - 0 1'), 'white')).toBe(false);
	});

	it('is false when both sides still have a rook (dead drawn)', () => {
		expect(canStillWin(new Chess('8/8/8/3k4/8/3K4/r7/7R w - - 0 1'), 'white')).toBe(false);
	});

	it('is true with a rook against a bare king', () => {
		expect(canStillWin(new Chess('8/8/8/3k4/8/3K4/8/7R w - - 0 1'), 'white')).toBe(true);
	});

	it('is true after promoting in a rook ending (Q+R vs R)', () => {
		// the pawn is gone precisely because it queened — being pawnless here
		// must not read as "the win got away"
		expect(canStillWin(new Chess('1Q6/8/8/3k4/8/3K4/r7/7R w - - 0 1'), 'white')).toBe(true);
	});
});

describe('win drills', () => {
	it('passes on a safe promotion', () => {
		// white just played b7b8q; black king is far and cannot take it
		const verdict = judge('1Q6/8/8/7k/8/8/8/K7 b - - 0 1', {
			goal: 'win',
			lastMove: { uci: 'b7b8q', byPlayer: true }
		});
		expect(verdict).toEqual({ done: true, success: true, outcome: 'promoted' });
	});

	it('plays on when the new queen hangs', () => {
		// black rook on a8 takes the fresh queen on b8 next move
		const verdict = judge('rQ6/8/8/7k/8/8/8/K7 b - - 0 1', {
			goal: 'win',
			lastMove: { uci: 'b7b8q', byPlayer: true }
		});
		expect(verdict).toEqual({ done: false });
	});

	it('passes on checkmate', () => {
		const verdict = judge('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1', { goal: 'win' });
		expect(verdict).toEqual({ done: true, success: true, outcome: 'mate' });
	});

	it('fails when the last pawn is captured', () => {
		// K vs K is a dead draw by rule, so that fires before the material check
		const verdict = judge('8/8/8/3k4/8/3K4/8/8 w - - 0 1', { goal: 'win' });
		expect(verdict).toEqual({ done: true, success: false, outcome: 'insufficient' });
	});

	it('fails when the pawn goes in a rook ending but both rooks remain', () => {
		const verdict = judge('8/8/8/3k4/8/3K4/r7/7R w - - 0 1', { goal: 'win' });
		expect(verdict).toEqual({ done: true, success: false, outcome: 'material-lost' });
	});

	it('plays on after winning the enemy rook, even with no pawns left', () => {
		const verdict = judge('8/8/8/3k4/8/3K4/8/7R w - - 0 1', { goal: 'win' });
		expect(verdict).toEqual({ done: false });
	});

	it('fails on stalemate — the win was thrown away', () => {
		const verdict = judge('7k/5Q2/7K/8/8/8/8/8 b - - 0 1', { goal: 'win' });
		expect(verdict).toEqual({ done: true, success: false, outcome: 'stalemate' });
	});

	it('fails at the move cap', () => {
		const verdict = judge('8/8/8/3k4/8/3K4/3P4/8 w - - 0 1', {
			goal: 'win',
			playerMoves: MOVE_CAP
		});
		expect(verdict).toEqual({ done: true, success: false, outcome: 'move-cap' });
	});
});

describe('draw drills', () => {
	const black: Partial<JudgeContext> = { playerColor: 'black' };

	it('passes on stalemate', () => {
		const verdict = judge('7k/5Q2/7K/8/8/8/8/8 b - - 0 1', { goal: 'draw', ...black });
		expect(verdict).toEqual({ done: true, success: true, outcome: 'stalemate' });
	});

	it('passes on insufficient material', () => {
		const verdict = judge('8/8/8/3k4/8/3K4/8/8 w - - 0 1', { goal: 'draw', ...black });
		expect(verdict).toEqual({ done: true, success: true, outcome: 'insufficient' });
	});

	it('passes once the opponent has nothing left to win with', () => {
		// white's pawn is gone and both sides still hold a rook
		const verdict = judge('8/8/8/3k4/8/3K4/r7/7R w - - 0 1', { goal: 'draw', ...black });
		expect(verdict).toEqual({ done: true, success: true, outcome: 'opponent-disarmed' });
	});

	it('fails when the opponent promotes', () => {
		const verdict = judge('1Q6/8/8/7k/8/8/8/K7 b - - 0 1', {
			goal: 'draw',
			...black,
			lastMove: { uci: 'b7b8q', byPlayer: false }
		});
		expect(verdict).toEqual({ done: true, success: false, outcome: 'opponent-promoted' });
	});

	it('fails on being checkmated', () => {
		const verdict = judge('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1', { goal: 'draw', ...black });
		expect(verdict).toEqual({ done: true, success: false, outcome: 'mated' });
	});

	it('passes at the move cap — holding that long is the draw', () => {
		const verdict = judge('4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', {
			goal: 'draw',
			...black,
			playerMoves: MOVE_CAP
		});
		expect(verdict).toEqual({ done: true, success: true, outcome: 'move-cap' });
	});

	it('keeps playing while the pawn is still on the board', () => {
		const verdict = judge('4k3/8/4K3/4P3/8/8/8/8 b - - 0 1', { goal: 'draw', ...black });
		expect(verdict).toEqual({ done: false });
	});
});

describe('describeOutcome', () => {
	const outcomes: DrillOutcome[] = [
		'mate',
		'promoted',
		'stalemate',
		'insufficient',
		'repetition',
		'fifty-move',
		'opponent-disarmed',
		'mated',
		'opponent-promoted',
		'material-lost',
		'move-cap'
	];

	it('has wording for every outcome, in both directions', () => {
		for (const outcome of outcomes) {
			expect(describeOutcome(outcome, true)).toBeTruthy();
			expect(describeOutcome(outcome, false)).toBeTruthy();
		}
	});
});
