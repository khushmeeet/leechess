import { describe, expect, it } from 'vitest';
import type { MoveRecord } from '$lib/api/client';
import { gradeChange, gradeChangeText } from './gradeChange';

function move(overrides: Partial<MoveRecord>): MoveRecord {
	return {
		ply: 3,
		san: 'Nf3',
		fen_before: '',
		fen_after: '',
		eval_before: 0,
		eval_after: 0,
		mate_before: null,
		mate_after: null,
		classification: 'best',
		best_move: null,
		best_line: null,
		reply_line: null,
		threat_move: null,
		threat_cp: null,
		threat_mate: null,
		mistake_cause: null,
		live_eval_after: null,
		live_classification: null,
		motifs: [],
		explanation: null,
		...overrides
	};
}

describe('gradeChange', () => {
	it('reports a deeper check that grades the move worse, with both losses', () => {
		const previous = move({ ply: 2, live_eval_after: 20 });
		const played = move({
			eval_before: 20,
			eval_after: -250,
			classification: 'blunder',
			live_eval_after: -60,
			live_classification: 'mistake'
		});
		const change = gradeChange(played, previous)!;
		expect(change.harsher).toBe(true);
		expect(change.live).toBe('mistake');
		expect(change.final).toBe('blunder');
		// White moved (ply 3): chances fell by the same win% the grades use
		expect(change.liveLoss).toBeGreaterThan(5);
		expect(change.liveLoss).toBeLessThan(10);
		expect(change.finalLoss).toBeGreaterThan(20);
	});

	it('measures the loss from the mover’s side for Black', () => {
		const previous = move({ ply: 3, live_eval_after: 0 });
		const played = move({
			ply: 4,
			eval_before: 0,
			eval_after: 300,
			classification: 'blunder',
			live_eval_after: 120,
			live_classification: 'mistake'
		});
		const change = gradeChange(played, previous)!;
		expect(change.liveLoss).toBeGreaterThan(0);
		expect(change.finalLoss).toBeGreaterThan(change.liveLoss!);
	});

	it('reports a milder grade too', () => {
		const change = gradeChange(
			move({ classification: 'inaccuracy', live_classification: 'blunder' }),
			undefined
		)!;
		expect(change.harsher).toBe(false);
		// no live eval before the first move on record: no live number
		expect(change.liveLoss).toBeNull();
	});

	it('stays quiet when the grades agree, or only best and good swap', () => {
		expect(
			gradeChange(move({ classification: 'mistake', live_classification: 'mistake' }), undefined)
		).toBeNull();
		expect(
			gradeChange(move({ classification: 'good', live_classification: 'best' }), undefined)
		).toBeNull();
		expect(
			gradeChange(move({ classification: 'book', live_classification: 'good' }), undefined)
		).toBeNull();
	});

	it('needs both grades — imported games and engine moves have no live one', () => {
		expect(gradeChange(move({ classification: 'blunder' }), undefined)).toBeNull();
		expect(
			gradeChange(move({ classification: null, live_classification: 'mistake' }), undefined)
		).toBeNull();
	});
});

describe('gradeChangeText', () => {
	it('says what each check found, in points of winning chances', () => {
		const text = gradeChangeText(
			{ live: 'mistake', final: 'blunder', harsher: true, liveLoss: 7.4, finalLoss: 22.6 },
			'Nf3'
		);
		expect(text).toBe(
			'During the game, Play’s quick check called Nf3 a mistake (7 points of winning chances lost). ' +
				'The deeper check after the game sees more: it is a blunder (23 points of winning chances lost).'
		);
	});

	it('leaves the number out where none is on record', () => {
		const text = gradeChangeText(
			{ live: 'blunder', final: 'inaccuracy', harsher: false, liveLoss: null, finalLoss: 3.2 },
			'Qh5'
		);
		expect(text).toBe(
			'During the game, Play’s quick check called Qh5 a blunder. ' +
				'The deeper check after the game finds it costs less: it is an inaccuracy (3 points of winning chances lost).'
		);
	});
});
