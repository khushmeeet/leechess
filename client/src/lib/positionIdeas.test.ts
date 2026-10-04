import { describe, expect, it } from 'vitest';
import { Chess, type Color } from 'chess.js';
import table from '../../../shared/position-ideas.json';
import {
	badBishops,
	ideaChanges,
	outposts,
	pawnWeaknesses,
	structureMarks,
	weakBackRank
} from './positionIdeas';

describe('position ideas (shared conformance table)', () => {
	for (const testCase of table.cases) {
		it(testCase.id, () => {
			const chess = new Chess(testCase.fen);
			for (const [side, color] of [
				['white', 'w'],
				['black', 'b']
			] as const) {
				const weak = pawnWeaknesses(chess, color as Color);
				expect(
					{
						outposts: outposts(chess, color as Color).sort(),
						weakBackRank: weakBackRank(chess, color as Color),
						isolated: weak.isolated,
						doubled: weak.doubled,
						backward: weak.backward
					},
					side
				).toEqual(testCase[side]);
			}
		});
	}
});

const SICILIAN = '6k1/pp3ppp/3p4/4p3/4P3/2N5/PP3PPP/6K1 w - - 0 1';

describe('ideaChanges', () => {
	it('says a knight took an outpost, and what makes it one', () => {
		expect(ideaChanges(SICILIAN, 'c3d5')).toEqual([
			'Nd5 puts White’s knight on an outpost: the e4 pawn guards d5, and no Black pawn can chase it away.'
		]);
	});

	it('says a rook took an open file', () => {
		const fen = '6k1/pp3ppp/3p4/4p3/4P3/8/PP3PPP/5RK1 w - - 0 1';
		expect(ideaChanges(fen, 'f1c1')).toEqual(['Rc1 puts White’s rook on the open c-file.']);
	});

	it('says when the last guard leaves the back rank, and when luft mends it', () => {
		const guarded = '3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
		expect(ideaChanges(guarded, 'd1d7')).toContain(
			'Rd7 leaves White’s back rank weak: the king on g1 has no way off it, and no rook or queen guards it.'
		);
		const weak = '3r2k1/2R2ppp/8/8/8/8/5PPP/6K1 w - - 0 1';
		expect(ideaChanges(weak, 'h2h3')).toEqual(['h3 mends White’s weak back rank.']);
	});

	it('names new weak pawns, for either side', () => {
		const fen = '6k1/5ppp/8/8/1n1P4/2P5/5PPP/6K1 w - - 0 1';
		expect(ideaChanges(fen, 'c3b4')).toEqual([
			'cxb4 leaves White with an isolated pawn on b4 and an isolated pawn on d4.'
		]);
		// a capture can leave the other side weak: Nxe6 takes the d5 pawn's
		// last neighbour
		const lonely = '6k1/p6p/4p3/2Np4/8/8/P6P/6K1 w - - 0 1';
		expect(ideaChanges(lonely, 'c5e6')).toEqual(['Nxe6 leaves Black with an isolated pawn on d5.']);
	});

	it('says nothing about a quiet move that changes none of it', () => {
		expect(ideaChanges(SICILIAN, 'h2h3')).toEqual([]);
		expect(ideaChanges(SICILIAN, 'z9z9')).toEqual([]);
	});
});

describe('badBishops and structureMarks', () => {
	it('finds a bishop behind its own pawns, fixed by enemy pawns', () => {
		// French-style: c3 d4 e5 on dark squares, d4 and e5 fixed by d5 and e6
		const fen = '4k3/8/4p3/3pP3/3P4/2P5/8/2B1K3 w - - 0 1';
		expect(badBishops(new Chess(fen), 'w')).toEqual(['c1']);
		expect(badBishops(new Chess(SICILIAN), 'w')).toEqual([]);
		// pawns stopped by pieces can move on later: not a bad bishop
		const pieces = '4k3/8/4n3/3nP3/3P4/2P5/8/2B1K3 w - - 0 1';
		expect(badBishops(new Chess(pieces), 'w')).toEqual([]);
	});

	it('does not call a knight in front of a pawn a hemmed-in bishop', () => {
		// the Najdorf position before 10.Nd5: the knight lands in front of d6
		const najdorf = 'r2q1rk1/1p2bppp/p2pbn2/4p3/4P3/1NN1B3/PPP1BPPP/R2Q1RK1 w - - 4 10';
		expect(ideaChanges(najdorf, 'c3d5')).toEqual([
			'Nd5 puts White’s knight on an outpost: the e4 pawn guards d5, and no Black pawn can chase it away.'
		]);
	});

	it('marks outposts per side and weak pawns', () => {
		const marks = structureMarks(SICILIAN);
		expect(marks).toContainEqual({ square: 'd5', mark: 'ov-outpost-w' });
		expect(marks).toContainEqual({ square: 'd4', mark: 'ov-outpost-b' });
		expect(marks).toContainEqual({ square: 'd6', mark: 'ov-weak-pawn' });
	});
});
