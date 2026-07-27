import { describe, expect, it } from 'vitest';
import { MOTIF_PRIORITY, detectLiveMotif, explainMotif, liveTactic } from './liveMotifs';
import { motifReason } from './motifs';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// The taxonomy and the detector's exact motif sets are proven against the
// server implementation in motifParity.test.ts, which runs the shared
// shared/motifs.json cases through this module. What is left here is
// client-only behaviour: the priority ordering the live tactic row picks
// from, the sentences it renders, and the line it builds.

describe('taxonomy', () => {
	it('has a templated Level 4 reason for every motif', () => {
		for (const motif of MOTIF_PRIORITY) {
			// the generic fallback reads "Nf3 executes the …" — every motif in
			// the taxonomy should have a real sentence instead
			expect(motifReason(motif, 'Nf3')).not.toContain('executes the');
		}
	});
});

describe('detectLiveMotif', () => {
	it('picks the most decisive motif when several apply', () => {
		// double check outranks the discovered check it comes with
		const fen = '4k3/8/8/8/4N3/8/8/4RK2 w - - 0 1';
		expect(detectLiveMotif(fen, 'e4f6')).toBe('double_check');
	});

	it('is null when no recognized tactic is present', () => {
		expect(detectLiveMotif(START, 'e2e4')).toBeNull();
	});
});

describe('explainMotif', () => {
	// The explanation names the actual pieces and squares — it is evidence for
	// this position, not a definition of the pattern in the abstract.
	const cases: [string, string, string, string, string][] = [
		[
			'hanging piece',
			'rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
			'f3h4',
			'hanging_piece',
			'the queen on h4 is left undefended'
		],
		[
			'fork',
			'r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1',
			'd5c7',
			'fork',
			'the knight on c7 hits the rook on a8 and the king on e8 at once'
		],
		[
			'pin',
			'4k3/8/2n5/8/8/8/8/5BK1 w - - 0 1',
			'f1b5',
			'pin',
			"the knight on c6 can't move — the king on e8 sits behind it"
		],
		[
			'skewer',
			'4q3/8/8/4k3/8/8/8/5RK1 w - - 0 1',
			'f1e1',
			'skewer',
			'the king on e5 must move, and the queen on e8 falls behind it'
		],
		[
			'back-rank mate',
			'6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
			'a1a8',
			'back_rank_mate',
			'the king on g8 has no escape from its own back rank'
		],
		[
			'discovered check',
			'4k3/8/8/8/4N3/8/8/4RK2 w - - 0 1',
			'e4c5',
			'discovered_check',
			'moving off e4 uncovers check from the rook on e1'
		],
		[
			'discovered attack',
			'r6k/8/8/8/N7/8/8/R3K3 w Q - 0 1',
			'a4c5',
			'discovered_attack',
			'moving off a4 uncovers the rook on a1 onto the rook on a8'
		],
		[
			'trapped piece',
			'6k1/2Q5/1n6/P7/8/3B4/8/R5K1 w - - 0 1',
			'd3e4',
			'trapped_piece',
			'the knight on b6 has no safe square to run to'
		],
		[
			'deflection',
			'6k1/3n4/8/2P1n3/8/8/8/4R1K1 w - - 0 1',
			'c5c6',
			'deflection',
			'the knight on d7 has to move, and it is the only piece guarding the knight on e5'
		],
		[
			'overloading',
			'1r1b1r1k/3n4/8/8/8/8/8/1R2R1K1 w - - 0 1',
			'e1f1',
			'overloading',
			'the knight on d7 is the only piece guarding both the rook on b8 and the rook on f8'
		]
	];

	for (const [name, fen, uci, motif, expected] of cases) {
		it(`explains ${name} with the pieces actually involved`, () => {
			expect(explainMotif(fen, uci, motif)).toBe(expected);
		});
	}

	it('explains a double check by naming both checkers', () => {
		const fen = '4k3/8/8/8/4N3/8/8/4RK2 w - - 0 1';
		const why = explainMotif(fen, 'e4f6', 'double_check')!;
		expect(why).toContain('the knight on f6');
		expect(why).toContain('the rook on e1');
		expect(why).toContain('only the king can move');
	});

	it('explains a zwischenzug by pointing at the piece left hanging', () => {
		const fen = '7k/8/2p5/3N4/8/8/8/R5K1 w - - 0 1';
		expect(explainMotif(fen, 'a1a8', 'zwischenzug')).toBe(
			'the check comes first — the knight on d5 can be rescued next move'
		);
	});

	it('describes a defended capture by what it costs to take', () => {
		// Rxd5 still wins material: the e6 pawn defends the queen, but a rook
		// for a queen is a trade worth making
		const fen = '4k3/8/4p3/3q4/8/8/8/3RK3 w - - 0 1';
		expect(explainMotif(fen, 'd1d5', 'hanging_piece')).toBe(
			'the queen on d5 is worth more than the rook on d1 that takes it'
		);
	});

	it('is null for an illegal move or an undetected motif', () => {
		expect(explainMotif(START, 'e2e5', 'fork')).toBeNull();
		expect(explainMotif(START, 'e2e4', 'fork')).toBeNull();
	});
});

describe('liveTactic', () => {
	const HUNG_QUEEN = 'rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';

	it('names the motif, why it is one, and the move that executes it', () => {
		expect(liveTactic(HUNG_QUEEN, ['f3h4', 'e8d8'])).toEqual({
			motif: 'hanging piece',
			why: 'the queen on h4 is left undefended',
			uci: 'f3h4',
			moveSan: 'Nxh4',
			line: ['Nxh4', 'Kd8']
		});
	});

	it('caps the line so the ladder’s last rung stays readable', () => {
		// nine fully legal plies in, eight out
		const fen = 'r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1';
		const long = ['d5c7', 'e8f8', 'c7a8', 'f8e8', 'a8b6', 'e8d8', 'b6d5', 'd8e8', 'd5c3'];
		const tactic = liveTactic(fen, long)!;
		expect(tactic.motif).toBe('fork');
		expect(tactic.line).toEqual(['Nc7+', 'Kf8', 'Nxa8', 'Ke8', 'Nb6', 'Kd8', 'Nd5', 'Ke8']);
	});

	it('stops at the first move the position cannot play', () => {
		// a truncated/illegal continuation still yields the tactic itself
		const tactic = liveTactic(HUNG_QUEEN, ['f3h4', 'a1a8'])!;
		expect(tactic.line).toEqual(['Nxh4']);
	});

	it('is null for a quiet best move or no line at all', () => {
		expect(liveTactic(START, ['e2e4', 'e7e5'])).toBeNull();
		expect(liveTactic(START, [])).toBeNull();
		expect(liveTactic(START, undefined)).toBeNull();
	});
});
