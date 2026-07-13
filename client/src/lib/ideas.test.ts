import { describe, expect, it } from 'vitest';
import { describeIdea } from './ideas';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('describeIdea', () => {
	it('labels checkmate above everything else', () => {
		// scholar's mate: Qxf7# is also a capture, but Mate wins the priority
		const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
		expect(describeIdea(fen, 'h5f7')).toEqual({ san: 'Qxf7#', label: 'Mate', uci: 'h5f7' });
	});

	it('labels check', () => {
		// 1.e4 f5 leaves the h5-e8 diagonal open for Qh5+
		const fen = 'rnbqkbnr/ppppp1pp/8/5p2/4P3/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 2';
		expect(describeIdea(fen, 'd1h5')?.label).toBe('Check');
	});

	it('labels promotion', () => {
		const fen = '8/P3k3/8/8/8/8/8/4K3 w - - 0 1';
		const idea = describeIdea(fen, 'a7a8q');
		expect(idea?.san).toBe('a8=Q');
		expect(idea?.label).toBe('Promote');
	});

	it('labels capturing a higher-valued piece as winning material', () => {
		// pawn on d3 takes the queen on e4
		const fen = 'rnb1kbnr/pppp1ppp/8/8/4q3/3P4/PPP1PPPP/RNBQKBNR w KQkq - 0 3';
		expect(describeIdea(fen, 'd3e4')?.label).toBe('Wins material');
	});

	it('labels capturing an undefended piece as winning material', () => {
		// 1.e4 e5 2.Nf3 a6 — e5 hangs
		const fen = 'rnbqkbnr/1ppp1ppp/p7/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3';
		expect(describeIdea(fen, 'f3e5')?.label).toBe('Wins material');
	});

	it('labels an equal defended capture as a trade', () => {
		// 1.e4 d5 2.exd5 — the d5 pawn is defended by the queen
		const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2';
		expect(describeIdea(fen, 'e4d5')?.label).toBe('Trade');
	});

	it('labels a losing defended capture as a capture', () => {
		// 1.e4 e5 2.Nf3 Nc6 — Nxe5 gives up knight for pawn
		const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
		expect(describeIdea(fen, 'f3e5')?.label).toBe('Capture');
	});

	it('labels castling as king safety', () => {
		const fen = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
		const idea = describeIdea(fen, 'e1g1');
		expect(idea?.san).toBe('O-O');
		expect(idea?.label).toBe('King safety');
	});

	it('labels a central pawn advance with tension as a central break', () => {
		// 1.d4 d5 2.c4 — the c-pawn attacks and is attacked by d5
		const fen = 'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq d6 0 2';
		expect(describeIdea(fen, 'c2c4')?.label).toBe('Central break');
	});

	it('labels a central pawn advance without tension as space', () => {
		expect(describeIdea(START, 'd2d4')?.label).toBe('Space');
	});

	it('labels other pawn moves as improving the pawn', () => {
		expect(describeIdea(START, 'a2a3')?.label).toBe('Improve pawn');
	});

	it('labels a minor piece leaving home as development, naming its side', () => {
		expect(describeIdea(START, 'g1f3')?.label).toBe('Develop kingside knight');
		expect(describeIdea(START, 'b1c3')?.label).toBe('Develop queenside knight');
	});

	it('labels a rook landing on a file with no own pawns as open file', () => {
		const fen = '4k3/8/8/8/8/8/4P3/R3K3 w - - 0 1';
		expect(describeIdea(fen, 'a1d1')?.label).toBe('Open file');
	});

	it('labels a rook landing behind an own pawn as improving the rook', () => {
		const fen = '4k3/8/8/8/R7/8/7P/4K3 w - - 0 1';
		expect(describeIdea(fen, 'a4h4')?.label).toBe('Improve rook');
	});

	it('labels quiet queen and king moves', () => {
		const afterD4D5 = 'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq d6 0 2';
		expect(describeIdea(afterD4D5, 'd1d3')?.label).toBe('Improve queen');
		expect(describeIdea('4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'e1e2')?.label).toBe('King move');
	});

	it('returns null for an illegal move', () => {
		expect(describeIdea(START, 'e2e5')).toBeNull();
	});
});
