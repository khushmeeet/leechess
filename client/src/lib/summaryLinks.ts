/** Turn move references inside the LLM coach texts into board links.
 *
 * Two flavors, matching how the two texts cite moves:
 *
 * - The game summary cites moves the way PGN does — "4. Bc4" for White,
 *   "11... Nf6" for Black — because that's how the digest it was written from
 *   prints them. `linkMoves` scans for that pattern and keeps a match only
 *   when the cited SAN really is the move played at that ply; everything else
 *   (takeaway numbering like "1. Keep your king safe", ratings, engine
 *   suggestions that were never played) stays plain text.
 *
 * - The per-move "why" text is prose about one position, citing bare SANs
 *   ("Nf3", "hxg6") and squares ("h7") that mostly never happened in the game
 *   — engine suggestions, threatened replies. `linkWhy` resolves those against
 *   the selected move's position instead: a move legal there (or in the
 *   position right after) becomes an arrow preview, a bare square becomes a
 *   highlight, and a cite of a move actually played jumps to its ply.
 */

import { Chess } from 'chess.js';

export interface SummarySegment {
	text: string;
	/** Ply this segment references; null for plain prose. */
	ply: number | null;
}

export type WhyAction =
	| { type: 'ply'; ply: number }
	| { type: 'arrow'; from: string; to: string }
	| { type: 'square'; square: string };

export interface WhySegment {
	text: string;
	/** What clicking this segment should show; null for plain prose. */
	action: WhyAction | null;
}

// A SAN move: piece move with optional disambiguation, pawn move/capture with
// optional promotion, or castling, optionally suffixed with +/#.
const SAN_PATTERN =
	'(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=[QRBN])?|[O0]-[O0](?:-[O0])?)[+#]?';

// number + "." | "..." | "…" + optional space + SAN. Lookarounds keep it from
// firing inside longer numbers ("1400.") or ordinary words.
const MOVE_REF = new RegExp(
	String.raw`(?<!\d)(\d{1,3})(\.\.\.|…|\.)\s?(${SAN_PATTERN})(?![A-Za-z0-9=])`,
	'g'
);

// Same, but the move number is optional — why-prose usually cites bare SANs.
const PROSE_REF = new RegExp(
	String.raw`(?<![A-Za-z0-9=])(?:(\d{1,3})(\.\.\.|…|\.)\s?)?(${SAN_PATTERN})(?![A-Za-z0-9=])`,
	'g'
);

/** Check/mate suffixes and 0-0-style castling shouldn't break the match. */
function normalizeSan(san: string): string {
	return san.replace(/[+#]$/, '').replaceAll('0', 'O');
}

/** "N." cites White's move (ply 2N-1), "N..." Black's (ply 2N) — but trust
 * the SAN over the dots when the model mixes them up. */
function resolvePly(
	number: number,
	dots: string,
	san: string,
	sanByPly: Map<number, string>
): number | undefined {
	const dotted = dots === '.' ? number * 2 - 1 : number * 2;
	const other = dots === '.' ? number * 2 : number * 2 - 1;
	return [dotted, other].find((candidate) => sanByPly.get(candidate) === san);
}

export function linkMoves(
	summary: string,
	moves: { ply: number; san: string }[]
): SummarySegment[] {
	const sanByPly = new Map(moves.map((move) => [move.ply, normalizeSan(move.san)]));
	const segments: SummarySegment[] = [];
	let cursor = 0;
	for (const match of summary.matchAll(MOVE_REF)) {
		const ply = resolvePly(Number(match[1]), match[2], normalizeSan(match[3]), sanByPly);
		if (ply === undefined) continue;
		if (match.index > cursor)
			segments.push({ text: summary.slice(cursor, match.index), ply: null });
		segments.push({ text: match[0], ply });
		cursor = match.index + match[0].length;
	}
	if (cursor < summary.length) segments.push({ text: summary.slice(cursor), ply: null });
	return segments;
}

function legalMove(fen: string, san: string): { from: string; to: string } | null {
	try {
		const move = new Chess(fen).move(san);
		return { from: move.from, to: move.to };
	} catch {
		return null;
	}
}

export function linkWhy(
	text: string,
	fenBefore: string,
	fenAfter: string,
	moves: { ply: number; san: string }[]
): WhySegment[] {
	const sanByPly = new Map(moves.map((move) => [move.ply, normalizeSan(move.san)]));
	const pliesBySan = new Map<string, number[]>();
	for (const move of moves) {
		const san = normalizeSan(move.san);
		pliesBySan.set(san, [...(pliesBySan.get(san) ?? []), move.ply]);
	}

	const segments: WhySegment[] = [];
	let cursor = 0;
	for (const match of text.matchAll(PROSE_REF)) {
		const san = normalizeSan(match[3]);
		let action: WhyAction | null = null;
		// A numbered cite names a specific ply — jump there when it checks out.
		if (match[1] !== undefined) {
			const ply = resolvePly(Number(match[1]), match[2], san, sanByPly);
			if (ply !== undefined) action = { type: 'ply', ply };
		}
		if (action === null) {
			// Legal here (an alternative) or in the reply position (a threat)
			// → arrow. A bare square → highlight. Otherwise it only makes
			// sense as a move that was really played — jump if unambiguous.
			const arrow = legalMove(fenBefore, san) ?? legalMove(fenAfter, san);
			if (arrow !== null) action = { type: 'arrow', ...arrow };
			else if (/^[a-h][1-8]$/.test(san)) action = { type: 'square', square: san };
			else {
				const plies = pliesBySan.get(san) ?? [];
				if (plies.length === 1) action = { type: 'ply', ply: plies[0] };
			}
		}
		if (action === null) continue;
		if (match.index > cursor)
			segments.push({ text: text.slice(cursor, match.index), action: null });
		segments.push({ text: match[0], action });
		cursor = match.index + match[0].length;
	}
	if (cursor < text.length) segments.push({ text: text.slice(cursor), action: null });
	return segments;
}
