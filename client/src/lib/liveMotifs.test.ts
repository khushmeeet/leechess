import { describe, expect, it } from 'vitest';
import { MOTIF_PRIORITY, detectLiveMotif, detectMotifs, liveHintFromLine } from './liveMotifs';
import { motifReason } from './motifs';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Every detector in server/app/motifs.py. The client is a port of that
 * module, so the two taxonomies must not drift — if a motif lands on the
 * server (x-ray, the strategic set) it gets added here too, and vice versa. */
const SERVER_MOTIFS = [
	'back_rank_mate',
	'deflection',
	'discovered_attack',
	'discovered_check',
	'double_check',
	'fork',
	'hanging_piece',
	'overloading',
	'pin',
	'skewer',
	'trapped_piece',
	'zwischenzug'
];

describe('taxonomy', () => {
	it('covers exactly the motifs the server detects', () => {
		expect([...MOTIF_PRIORITY].sort()).toEqual([...SERVER_MOTIFS].sort());
	});

	it('has a templated Level 4 reason for every motif', () => {
		for (const motif of MOTIF_PRIORITY) {
			// the generic fallback reads "Nf3 executes the …" — every motif in
			// the taxonomy should have a real sentence instead
			expect(motifReason(motif, 'Nf3')).not.toContain('executes the');
		}
	});
});

describe('detectMotifs', () => {
	it('flags a hanging piece the move wins for free', () => {
		// 1.e4 e5 2.Nf3 Qh4?? — Nxh4 wins the undefended queen
		const fen = 'rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
		expect([...detectMotifs(fen, 'f3h4')]).toEqual(['hanging_piece']);
	});

	it('does not flag an equal defended capture as hanging', () => {
		// Nxe5 gives knight for a pawn defended by the d-pawn — material, not a motif
		const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1';
		expect([...detectMotifs(fen, 'f3e5')]).toEqual([]);
	});

	it('flags a knight fork of king and rook', () => {
		const fen = 'r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1';
		expect([...detectMotifs(fen, 'd5c7')]).toEqual(['fork']);
	});

	it('flags a pawn fork of two knights', () => {
		const fen = '8/8/2n1n3/8/3P4/8/8/4K1k1 w - - 0 1';
		expect([...detectMotifs(fen, 'd4d5')]).toEqual(['fork']);
	});

	it('flags a bishop pinning a knight to the king', () => {
		const fen = '4k3/8/2n5/8/8/8/8/5BK1 w - - 0 1';
		expect([...detectMotifs(fen, 'f1b5')]).toEqual(['pin']);
	});

	it('flags a rook skewering the king to the queen', () => {
		const fen = '4q3/8/8/4k3/8/8/8/5RK1 w - - 0 1';
		expect([...detectMotifs(fen, 'f1e1')]).toEqual(['skewer']);
	});

	it('flags a back-rank mate', () => {
		const fen = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
		expect([...detectMotifs(fen, 'a1a8')].sort()).toEqual(['back_rank_mate']);
	});

	it('flags a pure discovered check', () => {
		// Nc5 unmasks the rook's check without checking itself
		const fen = '4k3/8/8/8/4N3/8/8/4RK2 w - - 0 1';
		expect([...detectMotifs(fen, 'e4c5')]).toEqual(['discovered_check']);
	});

	it('flags a double check', () => {
		// Nf6+ checks with the knight and unmasks the rook — both at once
		const fen = '4k3/8/8/8/4N3/8/8/4RK2 w - - 0 1';
		expect([...detectMotifs(fen, 'e4f6')].sort()).toEqual(['discovered_check', 'double_check']);
	});

	it('flags a discovered attack that is not a check', () => {
		// the knight steps aside, unmasking Ra1 onto the undefended Ra8
		const fen = 'r6k/8/8/8/N7/8/8/R3K3 w Q - 0 1';
		expect([...detectMotifs(fen, 'a4c5')]).toEqual(['discovered_attack']);
	});

	it('does not flag a discovered attack on a piece it cannot win', () => {
		// the unmasked rook hits a rook defended by the one behind it
		const fen = 'r6k/r7/8/8/N7/8/8/R3K3 w Q - 0 1';
		expect([...detectMotifs(fen, 'a4c5')]).toEqual([]);
	});

	it('flags a deflection of the sole defender', () => {
		// c6 hits Nd7, the only piece guarding Ne5 — which Re1 already attacks
		const fen = '6k1/3n4/8/2P1n3/8/8/8/4R1K1 w - - 0 1';
		expect([...detectMotifs(fen, 'c5c6')]).toEqual(['deflection']);
	});

	it('does not flag a deflection when the defender can stay put', () => {
		// Rd6 hits Nd7, but the knight is defended and the rook is dearer
		const fen = '6k1/3n4/8/4n3/8/8/8/3RR1K1 w - - 0 1';
		expect([...detectMotifs(fen, 'd1d6')]).toEqual([]);
	});

	it('flags an overloaded defender guarding two attacked pieces', () => {
		// Nd7 is the sole defender of both rooks, each hit by a different rook
		// (the d8 bishop blocks them from defending each other)
		const fen = '1r1b1r1k/3n4/8/8/8/8/8/1R2R1K1 w - - 0 1';
		expect([...detectMotifs(fen, 'e1f1')]).toEqual(['overloading']);
	});

	it('does not flag overloading when only one guarded piece is attacked', () => {
		const fen = '1r1b1r1k/3n4/8/8/8/8/8/1R2R1K1 w - - 0 1';
		expect([...detectMotifs(fen, 'e1e2')]).toEqual([]);
	});

	it('flags a trapped piece with no safe flight square', () => {
		// Be4 seals the last escapes; the a5 pawn forces the knight to move
		const fen = '6k1/2Q5/1n6/P7/8/3B4/8/R5K1 w - - 0 1';
		expect([...detectMotifs(fen, 'd3e4')]).toEqual(['trapped_piece']);
	});

	it('does not flag a trapped piece that still has a flight square', () => {
		// the same box, but the bishop steps away and frees d5 and a8
		const fen = '6k1/2Q5/1n6/P7/4B3/8/8/R5K1 w - - 0 1';
		expect([...detectMotifs(fen, 'e4d3')]).toEqual([]);
	});

	it('flags a zwischenzug that checks instead of saving a hanging piece', () => {
		// Nd5 hangs to the c6 pawn; White throws in Ra8+ first
		const fen = '7k/8/2p5/3N4/8/8/8/R5K1 w - - 0 1';
		expect([...detectMotifs(fen, 'a1a8')]).toEqual(['zwischenzug']);
	});

	it('does not flag a zwischenzug when nothing was hanging', () => {
		const fen = '7k/8/8/3N4/8/8/8/R5K1 w - - 0 1';
		expect([...detectMotifs(fen, 'a1a8')]).toEqual([]);
	});

	it('finds no motif in a quiet developing move', () => {
		expect([...detectMotifs(START, 'e2e4')]).toEqual([]);
	});

	it('returns nothing for an illegal move', () => {
		expect([...detectMotifs(START, 'e2e5')]).toEqual([]);
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

describe('liveHintFromLine', () => {
	it('builds ladder content from a tactical best line', () => {
		const fen = 'rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
		const hint = liveHintFromLine(fen, ['f3h4', 'e5e4']);
		expect(hint).not.toBeNull();
		expect(hint!.category).toContain('tactic');
		expect(hint!.motif).toBe('hanging piece');
		expect(hint!.moveSan).toBe('Nxh4');
		expect(hint!.reason).toContain('Nxh4');
		expect(hint!.line[0]).toBe('Nxh4');
	});

	it('builds content for a newly supported motif', () => {
		// trapped piece — one of the five that used to fall through to the nudge
		const fen = '6k1/2Q5/1n6/P7/8/3B4/8/R5K1 w - - 0 1';
		const hint = liveHintFromLine(fen, ['d3e4', 'b6d5']);
		expect(hint).not.toBeNull();
		expect(hint!.motif).toBe('trapped piece');
		expect(hint!.moveSan).toBe('Be4');
		expect(hint!.reason).toContain('nowhere safe to go');
	});

	it('is null when the best move carries no recognized tactic', () => {
		expect(liveHintFromLine(START, ['e2e4', 'e7e5'])).toBeNull();
	});

	it('is null for an empty line', () => {
		expect(liveHintFromLine(START, [])).toBeNull();
	});

	it('caps the surfaced line length', () => {
		// a long principal variation is trimmed so the "full line" stays readable
		const fen = 'r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1';
		const long = ['d5c7', 'e8d8', 'c7a8', 'd8c8', 'a8b6', 'c8b8', 'b6d5', 'b8c7', 'd5e3'];
		const hint = liveHintFromLine(fen, long);
		expect(hint).not.toBeNull();
		expect(hint!.line.length).toBeLessThanOrEqual(8);
		expect(hint!.motif).toBe('fork');
	});
});
