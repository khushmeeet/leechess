import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import fixtures from '../../../shared/motifs.json';
import {
	BACK_RANK_MATE,
	DEFLECTION,
	DISCOVERED_ATTACK,
	DISCOVERED_CHECK,
	DOUBLE_CHECK,
	FORK,
	HANGING_PIECE,
	MOTIF_PRIORITY,
	OVERLOADING,
	PIN,
	SKEWER,
	TRAPPED_PIECE,
	ZWISCHENZUG,
	detectMotifs
} from './liveMotifs';

// The other half of the cross-language conformance suite: server/tests/
// test_motif_parity.py runs these exact cases through server/app/motifs.py
// (python-chess), this file runs them through the chess.js port. The two
// detectors are one specification with two implementations — a rule refined
// on one side and not the other fails on the other side, which comparing
// taxonomy lists alone could never catch.

/** Motif constants this module exports — the taxonomy as the implementation
 * defines it, not a hand-copied list. */
const DETECTOR_CONSTANTS = [
	BACK_RANK_MATE,
	DEFLECTION,
	DISCOVERED_ATTACK,
	DISCOVERED_CHECK,
	DOUBLE_CHECK,
	FORK,
	HANGING_PIECE,
	OVERLOADING,
	PIN,
	SKEWER,
	TRAPPED_PIECE,
	ZWISCHENZUG
];

describe('taxonomy', () => {
	it('matches the shared taxonomy', () => {
		expect([...DETECTOR_CONSTANTS].sort()).toEqual([...fixtures.taxonomy].sort());
	});

	it('is exactly what the live-motif priority ranks', () => {
		expect([...MOTIF_PRIORITY].sort()).toEqual([...fixtures.taxonomy].sort());
	});
});

describe('shared conformance cases', () => {
	for (const testCase of fixtures.cases) {
		it(`${testCase.id}: the move is legal from the given position`, () => {
			// chess.js rejects illegal input rather than playing it, but the
			// Python detector's board.push does not — a fixture move that isn't
			// legal would silently "prove" a position neither side can reach.
			const chess = new Chess(testCase.fen);
			const legal = chess
				.moves({ verbose: true })
				.map((move) => move.from + move.to + (move.promotion ?? ''));
			expect(legal).toContain(testCase.uci);
		});

		it(`${testCase.id}: detects exactly the shared motif set`, () => {
			expect([...detectMotifs(testCase.fen, testCase.uci)].sort()).toEqual(
				[...testCase.motifs].sort()
			);
		});
	}

	it('covers every taxonomy entry with a positive case', () => {
		const covered = new Set(fixtures.cases.flatMap((testCase) => testCase.motifs));
		expect([...covered].sort()).toEqual([...fixtures.taxonomy].sort());
	});

	it('covers every taxonomy entry with a near miss', () => {
		const covered = new Set(
			fixtures.cases.flatMap((testCase) => ('nearMissFor' in testCase ? testCase.nearMissFor : []))
		);
		expect([...covered].sort()).toEqual([...fixtures.taxonomy].sort());
	});
});

describe('illegal input', () => {
	// Asserted per-implementation rather than in the shared table: the client
	// is fed raw UCI from the engine and localStorage, so it must return
	// nothing instead of throwing.
	it('detects no motif for a move that is not legal', () => {
		const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
		expect([...detectMotifs(start, 'e2e5')]).toEqual([]);
		expect([...detectMotifs(start, 'zzzz')]).toEqual([]);
	});
});
