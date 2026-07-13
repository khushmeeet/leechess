import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';

import { linkMoves, linkWhy } from './summaryLinks';

// 1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7 Qh4 — plies 1-12.
const moves = [
	'e4',
	'e5',
	'Nf3',
	'Nc6',
	'Bc4',
	'Nf6',
	'Ng5',
	'd5',
	'exd5',
	'Nxd5',
	'Nxf7',
	'Qh4'
].map((san, i) => ({ ply: i + 1, san }));

const linked = (summary: string) => linkMoves(summary, moves).filter((s) => s.ply !== null);

describe('linkMoves', () => {
	it('links a White move reference to its odd ply', () => {
		expect(linkMoves('Your 3. Bc4 was strong.', moves)).toEqual([
			{ text: 'Your ', ply: null },
			{ text: '3. Bc4', ply: 5 },
			{ text: ' was strong.', ply: null }
		]);
	});

	it('links a Black "..." reference to its even ply', () => {
		expect(linked('After 2... Nc6 the center held.')).toEqual([{ text: '2... Nc6', ply: 4 }]);
	});

	it('links every reference in a parenthesized list', () => {
		expect(linked('hanging pieces (3. Bc4, 4. Ng5, 5... Nxd5)').map((s) => s.ply)).toEqual([
			5, 7, 10
		]);
	});

	it('leaves takeaway numbering and prose alone', () => {
		const summary = '1. Keep your king safe.\n2. Trade when ahead.\n3. Castle earlier.';
		expect(linkMoves(summary, moves)).toEqual([{ text: summary, ply: null }]);
	});

	it('ignores moves that were never played at that number', () => {
		expect(linked('The engine preferred 4. Bxf7 instead.')).toEqual([]);
	});

	it('does not fire inside longer numbers like a rating', () => {
		expect(linked('rated around 1400. e4 remains a fine opening')).toEqual([]);
	});

	it('recovers when the dots cite the wrong side', () => {
		// "4. d5" is really Black's 4th move (ply 8).
		expect(linked('overextending with 4. d5')).toEqual([{ text: '4. d5', ply: 8 }]);
	});

	it('tolerates missing space, unicode ellipsis, and check suffixes', () => {
		expect(linked('2.Nf3 then 3… Nf6 and finally 6... Qh4+').map((s) => s.ply)).toEqual([3, 6, 12]);
	});

	it('does not match a reference glued to a longer word', () => {
		expect(linked('see 4. d5xters')).toEqual([]);
	});

	it('returns one plain segment when nothing matches', () => {
		expect(linkMoves('No moves cited here.', moves)).toEqual([
			{ text: 'No moves cited here.', ply: null }
		]);
	});
});

describe('linkWhy', () => {
	// The "why" position: 4. Ng5 is the selected move of the same game.
	const chess = new Chess();
	for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6']) chess.move(san);
	const fenBefore = chess.fen();
	chess.move('Ng5');
	const fenAfter = chess.fen();
	const whyMoves = [...moves.slice(0, 6), { ply: 7, san: 'Ng5' }];

	const actions = (text: string) =>
		linkWhy(text, fenBefore, fenAfter, whyMoves)
			.filter((s) => s.action !== null)
			.map((s) => ({ text: s.text, ...s.action }));

	it('previews a move legal in the shown position as an arrow', () => {
		expect(actions('When you played Ng5 the knight was loose.')).toEqual([
			{ text: 'Ng5', type: 'arrow', from: 'f3', to: 'g5' }
		]);
	});

	it('previews a threatened reply (legal only after the move) as an arrow', () => {
		expect(actions('the reply d5 hits your bishop')).toEqual([
			{ text: 'd5', type: 'arrow', from: 'd7', to: 'd5' }
		]);
	});

	it('tolerates check suffixes on cited captures', () => {
		expect(actions('Bxf7+ was the point')).toEqual([
			{ text: 'Bxf7+', type: 'arrow', from: 'c4', to: 'f7' }
		]);
	});

	it('highlights a bare square that is not a legal move', () => {
		expect(actions('a quick glance at the f7 pawn')).toEqual([
			{ text: 'f7', type: 'square', square: 'f7' }
		]);
	});

	it('jumps to the ply of a cited move that was played but is no longer legal', () => {
		expect(actions('your earlier Bc4 already eyed that pawn')).toEqual([
			{ text: 'Bc4', type: 'ply', ply: 5 }
		]);
	});

	it('still resolves numbered cites to their ply', () => {
		expect(actions('the blunder came with 4. Ng5')).toEqual([
			{ text: '4. Ng5', type: 'ply', ply: 7 }
		]);
	});

	it('falls back to an arrow when a numbered cite was never played', () => {
		expect(actions('the engine preferred 12. Bxf7 here')).toEqual([
			{ text: '12. Bxf7', type: 'arrow', from: 'c4', to: 'f7' }
		]);
	});

	it('leaves impossible cites and plain prose alone', () => {
		expect(
			linkWhy('Qxf7 is not possible, and prose stays prose.', fenBefore, fenAfter, whyMoves)
		).toEqual([{ text: 'Qxf7 is not possible, and prose stays prose.', action: null }]);
	});
});
