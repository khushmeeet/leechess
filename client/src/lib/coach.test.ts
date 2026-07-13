import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { coachAdvice, gamePhase, type CoachContext } from './coach';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 — two white minors out, castling available
const ITALIAN = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';

function ctx(overrides: Partial<CoachContext>): CoachContext {
	return {
		fen: START,
		ply: 0,
		evalCp: 0,
		lastUserClassification: null,
		bestMoveSan: null,
		userColor: 'white',
		inBook: false,
		...overrides
	};
}

describe('coachAdvice', () => {
	it('opens the game with center-and-development advice', () => {
		expect(coachAdvice(ctx({}))).toBe('Fight for the center and develop quickly.');
	});

	it('composes the king-safety line with the engine preference (mockup shape)', () => {
		const advice = coachAdvice(ctx({ fen: ITALIAN, ply: 6, bestMoveSan: 'c3' }));
		expect(advice).toBe(
			'King safety is the priority. Stockfish prefers c3. ' +
				'Finish development and castle before opening the position.'
		);
	});

	it('prioritizes being in check over everything but move one', () => {
		// 1.e4 e5 2.f4 Qh4+
		const fen = 'rnb1kbnr/pppp1ppp/8/4p3/4PP1q/8/PPPP2PP/RNBQKBNR w KQkq - 1 3';
		expect(coachAdvice(ctx({ fen, ply: 4, lastUserClassification: 'blunder' }))).toBe(
			"You're in check — deal with the threat first."
		);
	});

	it('responds to a mistake or blunder with recovery advice', () => {
		const advice = coachAdvice(ctx({ fen: ITALIAN, ply: 6, lastUserClassification: 'blunder' }));
		expect(advice).toContain('That last move let the eval slip');
	});

	it('advises early development while minors sit at home', () => {
		// 1.a3 a6 — nothing developed
		const fen = 'rnbqkbnr/1ppppppp/p7/8/8/P7/1PPPPPPP/RNBQKBNR w KQkq - 0 2';
		const advice = coachAdvice(ctx({ fen, ply: 2 }));
		expect(advice).toContain('Develop your minor pieces');
		expect(advice).toContain('Knights and bishops first');
	});

	it('advises on material imbalances outside the opening', () => {
		const upAQueen = 'rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 16';
		expect(coachAdvice(ctx({ fen: upAQueen, ply: 30 }))).toContain("You're up material");
		const downAQueen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 16';
		expect(coachAdvice(ctx({ fen: downAQueen, ply: 30 }))).toContain("You're down material");
	});

	it('gives endgame advice when material is low', () => {
		const kingAndPawns = '4k3/8/8/8/8/4P3/8/4K3 w - - 0 40';
		expect(coachAdvice(ctx({ fen: kingAndPawns, ply: 60 }))).toBe(
			'Activate your king and look for passed pawns.'
		);
	});

	it('appends the engine preference whenever a best move is known', () => {
		const advice = coachAdvice(ctx({ ply: 8, fen: ITALIAN, bestMoveSan: 'Nc3' }));
		expect(advice).toContain('Stockfish prefers Nc3.');
		expect(coachAdvice(ctx({ ply: 8, fen: ITALIAN }))).not.toContain('Stockfish prefers');
	});
});

describe('gamePhase', () => {
	it('classifies start, developed-middlegame, and low-material positions', () => {
		expect(gamePhase(new Chess(START), 0, 'w')).toBe('opening');
		expect(gamePhase(new Chess(ITALIAN), 30, 'w')).toBe('middlegame');
		expect(gamePhase(new Chess('4k3/8/8/8/8/4P3/8/4K3 w - - 0 40'), 60, 'w')).toBe('endgame');
	});
});
