import { describe, expect, it } from 'vitest';
import type { Square } from 'chess.js';
import table from '../../../shared/threats.json';
import {
	ATTACK_SWING_CP,
	bestCaptureGain,
	classifyThreat,
	passTurn,
	staticExchange,
	threatOutcome,
	type EngineScore
} from './threats';

// Positions are the ones that came up in a real game against the Beginner
// engine, with the scores native Stockfish gave them (current position at
// depth 16, the passed position at depth 12 — the depth the threat search
// runs at). Where a case needs a score the game never produced, it says so.

/** 3.Qh5 in Scholar's mate: Black to move, Qxf7# is threatened. */
const SCHOLAR = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
/** Move 21: the queen on f4 and the bishop on c8 both hit the bishop on f5. */
const BISHOP_HIT = 'r1b3rk/pp3p1p/2n2p2/3p1B2/P4q2/1P5P/2QN1PP1/2R2RK1 w - - 5 21';
/** Move 14: …Nxf2 takes a pawn and forks the rooks on d1 and h1. */
const FORK_ON_F2 = 'r1b2rk1/ppq2ppp/2n1p3/3p4/2P1n3/PP1BbN1P/1BQN1PP1/3RK2R w K - 0 14';
/** Move 24: …Bxh3 starts a mate in three. */
const MATING_ATTACK = 'r1b3rk/pp5p/2n2p2/3pp3/P7/1P3qPP/2Q2P2/2R2RK1 w - - 0 24';
/** Move 19: …Qf4 is the engine's pick, but worth a bit over a pawn. */
const SMALL_THREAT = 'r1b2r1k/ppq2p1p/2n2p2/3p4/P7/1P1B3P/2QN1PP1/3R1RK1 w - - 1 19';
/** White can take the knight on d5; Black's best free move is to save it. */
const RESCUE = '6k1/5ppp/8/3n4/4P3/8/5PPP/6K1 w - - 0 1';
/** After 1.e4 — nothing is threatened. */
const QUIET = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
/** Black's knight can jump to c2 and fork the king and rook. */
const KNIGHT_FORK = '4k3/8/8/8/1n6/8/8/R3K3 w - - 0 1';

function threat(fen: string, uci: string, threatScore: EngineScore, current: EngineScore | null) {
	return classifyThreat({ fen, threatUci: uci, threatScore, currentScore: current });
}

describe('passTurn', () => {
	it('hands the move to the other side', () => {
		expect(passTurn(QUIET)).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1');
	});

	it('drops the en passant square, which belonged to the move just played', () => {
		const fen = 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3';
		expect(passTurn(fen)?.split(' ')[3]).toBe('-');
	});

	it('refuses to pass out of check', () => {
		expect(passTurn('4k3/8/8/8/8/8/8/R3K2r w - - 0 1')).toBeNull();
	});

	it('refuses a finished position', () => {
		// stalemate: Black to move with no legal move
		expect(passTurn('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toBeNull();
	});
});

describe('staticExchange', () => {
	it('wins the whole piece when nothing defends it', () => {
		expect(staticExchange('4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1', 'e4', 'd5')).toBe(3);
	});

	it('counts attackers against defenders, cheapest first', () => {
		// …Bxf5 Qxf5 Qxf5: Black ends a bishop up
		expect(staticExchange(passTurn(BISHOP_HIT)!, 'c8', 'f5')).toBe(3);
	});

	it('is zero for an even trade', () => {
		expect(staticExchange('4k3/8/2p5/3n4/8/4N3/8/4K3 w - - 0 1', 'e3', 'd5')).toBe(0);
	});

	it('is negative when the capture loses material', () => {
		expect(staticExchange('4k3/8/2p5/3n4/8/8/3R4/4K3 w - - 0 1', 'd2', 'd5')).toBe(-2);
		expect(staticExchange('4k3/8/2p5/3p4/8/8/3Q4/4K3 w - - 0 1', 'd2', 'd5')).toBe(-8);
	});

	it('brings in a piece standing behind another as the front one is used up', () => {
		// alone, the rook takes the knight and is taken back by the rook on d8
		expect(staticExchange('3rk3/8/8/3n4/8/8/3R4/4K3 w - - 0 1', 'd2', 'd5')).toBe(-2);
		// with the queen behind it, the queen takes back last: a knight up
		expect(staticExchange('3rk3/8/8/3n4/8/8/3R4/3QK3 w - - 0 1', 'd2', 'd5')).toBe(3);
	});

	it('never recaptures with the king onto a defended square', () => {
		// Kxf2 would walk into the bishop on e3, so the pawn is simply lost
		expect(staticExchange(passTurn(FORK_ON_F2)!, 'e4', 'f2')).toBe(1);
	});

	it('is zero for an empty target square', () => {
		expect(staticExchange(QUIET, 'd7', 'd5')).toBe(0);
	});
});

describe('bestCaptureGain', () => {
	it('is the best capture available to the side to move', () => {
		expect(bestCaptureGain(RESCUE)).toBe(3);
	});

	it('is zero with nothing to take', () => {
		expect(bestCaptureGain(QUIET)).toBe(0);
	});
});

describe('classifyThreat', () => {
	it('names a mate in one', () => {
		expect(threat(SCHOLAR, 'h5f7', { mate: 1 }, { cp: -30 })).toMatchObject({
			kind: 'mate',
			by: 'white',
			uci: 'h5f7',
			san: 'Qxf7#',
			text: 'White threatens Qxf7#, checkmate.'
		});
	});

	it('names the first move of a longer forced mate', () => {
		expect(threat(MATING_ATTACK, 'c8h3', { mate: -3 }, { cp: -747 })).toMatchObject({
			kind: 'mate',
			by: 'black',
			san: '…Bxh3',
			text: 'Black threatens a forced mate starting with …Bxh3 (mate in 3).'
		});
	});

	it('names a piece that is attacked more often than it is defended', () => {
		expect(threat(BISHOP_HIT, 'c8f5', { cp: -657 }, { cp: -156 })).toMatchObject({
			kind: 'material',
			target: 'f5',
			text: 'Black threatens …Bxf5, winning the bishop on f5 (attacked twice, defended once).'
		});
	});

	it('names an undefended piece as undefended', () => {
		const fen = '4k3/8/8/8/8/2b5/8/R6K w - - 0 1';
		expect(threat(fen, 'c3a1', { cp: -300 }, { cp: 200 })).toMatchObject({
			kind: 'material',
			text: 'Black threatens …Bxa1, winning the rook on a1, which nothing defends.'
		});
	});

	it('names a capture by a cheaper piece as winning material', () => {
		const fen = '4k3/8/8/3p4/4N3/5P2/8/4K3 w - - 0 1';
		expect(threat(fen, 'd5e4', { cp: -150 }, { cp: 200 })).toMatchObject({
			kind: 'material',
			text: 'Black threatens …dxe4, winning material: the knight on e4 is worth more than the pawn that takes it.'
		});
	});

	it('tells a capture that also forks as the fork', () => {
		expect(threat(FORK_ON_F2, 'e4f2', { cp: -332 }, { cp: 283 })).toMatchObject({
			kind: 'motif',
			motif: 'fork',
			san: '…Nxf2',
			text: 'Black threatens …Nxf2, a fork: the knight on f2 hits the rook on d1 and the rook on h1 at once.'
		});
	});

	it('names a fork that captures nothing once it is worth enough', () => {
		// scores constructed for the case: a rook up, then a rook down
		expect(threat(KNIGHT_FORK, 'b4c2', { cp: -300 }, { cp: 200 })).toMatchObject({
			kind: 'motif',
			motif: 'fork',
			san: '…Nc2+',
			text: 'Black threatens …Nc2+, a fork: the knight on c2 hits the rook on a1 and the king on e1 at once.'
		});
	});

	it('needs the current score to judge a threat that captures nothing', () => {
		expect(threat(KNIGHT_FORK, 'b4c2', { cp: -300 }, null)).toBeNull();
	});

	it('reports a large swing it cannot name, with its size', () => {
		// constructed scores: the opening position is not really this sharp
		expect(threat(QUIET, 'd2d4', { cp: 500 }, { cp: 29 })).toMatchObject({
			kind: 'attack',
			text: 'White threatens d4, which would gain about 5 pawns’ worth.'
		});
	});

	it('stays quiet below the bars', () => {
		expect(threat(QUIET, 'd2d4', { cp: 95 }, { cp: 29 })).toBeNull();
		// …Qf4 is the engine's pick, and is worth about a pawn: not reported
		expect(threat(SMALL_THREAT, 'c7f4', { cp: -129 }, { cp: -9 })).toBeNull();
	});

	it('does not mistake a rescue for a threat', () => {
		// The swing is past the attack bar, but all of it is the knight the
		// player could have taken — saving it threatens nothing.
		const swing = -(-377 - 0);
		expect(swing).toBeGreaterThan(ATTACK_SWING_CP);
		expect(threat(RESCUE, 'd5f4', { cp: -377 }, { cp: 0 })).toBeNull();
	});

	it('says nothing for a move that does not fit the position', () => {
		expect(threat(QUIET, 'e7e5', { cp: 500 }, { cp: 0 })).toBeNull(); // Black's move, White's turn
		expect(threat(QUIET, null as unknown as string, { cp: 500 }, { cp: 0 })).toBeNull();
	});

	it('says nothing when the player is in check', () => {
		expect(threat('4k3/8/8/8/8/8/8/R3K2r w - - 0 1', 'h1a1', { cp: -500 }, { cp: 0 })).toBeNull();
	});

	it('ignores a mate the threatening side would be on the wrong end of', () => {
		expect(threat(QUIET, 'd2d4', { mate: -4 }, { cp: 29 })).toBeNull();
	});
});

describe('threatOutcome', () => {
	const bishopThreat = threat(BISHOP_HIT, 'c8f5', { cp: -657 }, { cp: -156 })!;
	/** After 21.Be6 — the bishop left f5, onto a square the f7 pawn covers. */
	const AFTER_BE6 = 'r1b3rk/pp3p1p/2n1Bp2/3p4/P4q2/1P5P/2QN1PP1/2R2RK1 b - - 6 21';
	/** After 21.Bd3 instead — a sound retreat. */
	const AFTER_BD3 = 'r1b3rk/pp3p1p/2n2p2/3p4/P4q2/1P1B3P/2QN1PP1/2R2RK1 b - - 6 21';

	it('calls a threat that is still the best reply ignored', () => {
		const scholar = threat(SCHOLAR, 'h5f7', { mate: 1 }, { cp: -30 })!;
		const afterNf6 = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
		expect(
			threatOutcome(scholar, { fenAfter: afterNf6, classification: 'blunder' }, 'h5f7')
		).toEqual({ kind: 'ignored' });
	});

	it('names what a blunder allowed instead of calling the threat answered', () => {
		expect(
			threatOutcome(bishopThreat, { fenAfter: AFTER_BE6, classification: 'blunder' }, 'c8e6')
		).toEqual({ kind: 'replaced', replySan: '…Bxe6' });
	});

	it('calls the threat answered after a sound move', () => {
		expect(
			threatOutcome(bishopThreat, { fenAfter: AFTER_BD3, classification: 'good' }, 'c6e5')
		).toEqual({ kind: 'answered' });
	});

	it('claims nothing without a next position, or with a reply that does not fit', () => {
		expect(
			threatOutcome(bishopThreat, { fenAfter: AFTER_BE6, classification: 'blunder' }, null)
		).toBeNull();
		expect(
			threatOutcome(bishopThreat, { fenAfter: AFTER_BE6, classification: 'blunder' }, 'a1a8')
		).toBeNull();
	});
});

// The same table server/tests/test_threat_kind.py runs through the Python
// port, which Progress's mistake causes count with — so the server never
// counts a threat the screens would not show.
describe('classifyThreat (shared conformance table)', () => {
	for (const testCase of table.cases) {
		it(testCase.id, () => {
			const found = classifyThreat({
				fen: testCase.fen,
				threatUci: testCase.threatUci,
				threatScore: testCase.threatScore,
				currentScore: testCase.currentScore
			});
			expect(found?.kind ?? null).toBe(testCase.kind);
		});
	}
});

describe('staticExchange (shared conformance table)', () => {
	for (const testCase of table.exchangeCases) {
		it(testCase.id, () => {
			expect(staticExchange(testCase.fen, testCase.from as Square, testCase.to as Square)).toBe(
				testCase.expected
			);
		});
	}
});
