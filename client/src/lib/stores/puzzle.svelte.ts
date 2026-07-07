import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import { SvelteMap } from 'svelte/reactivity';
import { ApiError, getNextPuzzle, recordAttempt, type PuzzleRecord } from '$lib/api/client';
import { computeDests } from './game.svelte';

export type PuzzleStatus = 'loading' | 'empty' | 'solving' | 'solved' | 'error';

const REPLY_DELAY_MS = 350;

function uciParts(uci: string): { from: Key; to: Key; promotion?: string } {
	return { from: uci.slice(0, 2) as Key, to: uci.slice(2, 4) as Key, promotion: uci[4] };
}

/** One puzzle at a time: the solver plays the side to move of the stored
 * FEN; opponent replies from the solution line auto-play. The first wrong
 * try records an incorrect attempt (retries are free after that); a clean
 * solve records a correct one with the hint level used. */
export class PuzzleSession {
	puzzle = $state<PuzzleRecord | null>(null);
	status = $state<PuzzleStatus>('loading');
	error = $state<string | null>(null);

	fen = $state('8/8/8/8/8/8/8/8 w - - 0 1');
	dests = $state<Map<Key, Key[]>>(new SvelteMap());
	lastMove = $state<[Key, Key] | undefined>(undefined);
	orientation = $state<'white' | 'black'>('white');
	/** Bumped to snap the board back after a legal-but-wrong try. */
	boardSyncKey = $state(0);

	hintLevel = $state(0);
	/** At least one wrong try on the current puzzle. */
	wrong = $state(false);
	completedCount = $state(0);

	/** Index into puzzle.solution of the next expected move (either side). */
	private solutionIndex = $state(0);
	private chess = new Chess();
	private attemptRecorded = false;
	private replyTimer: ReturnType<typeof setTimeout> | undefined;

	get playerColor(): 'white' | 'black' {
		return this.orientation;
	}

	get isPlayersTurn(): boolean {
		return this.fen.split(' ')[1] === (this.playerColor === 'white' ? 'w' : 'b');
	}

	/** The solver's next expected move, looking past a pending opponent
	 * reply if needed — drives hint Levels 3-4. */
	nextPlayerMove: { san: string; uci: string } | null = $derived.by(() => {
		const puzzle = this.puzzle;
		if (!puzzle || this.status !== 'solving') return null;
		const chess = new Chess(this.fen);
		let index = this.solutionIndex;
		if (chess.turn() !== (this.playerColor === 'white' ? 'w' : 'b')) {
			const reply = puzzle.solution[index];
			if (!reply) return null;
			try {
				chess.move(uciParts(reply));
			} catch {
				return null;
			}
			index += 1;
		}
		const uci = puzzle.solution[index];
		if (!uci) return null;
		try {
			return { san: chess.move(uciParts(uci)).san, uci };
		} catch {
			return null;
		}
	});

	/** The whole solution as SANs, from the puzzle's starting position. */
	solutionSans: string[] = $derived.by(() => {
		const puzzle = this.puzzle;
		if (!puzzle) return [];
		const chess = new Chess(puzzle.fen);
		const sans: string[] = [];
		for (const uci of puzzle.solution) {
			try {
				sans.push(chess.move(uciParts(uci)).san);
			} catch {
				break;
			}
		}
		return sans;
	});

	async load(motif?: string | null): Promise<void> {
		clearTimeout(this.replyTimer);
		this.status = 'loading';
		this.error = null;
		try {
			const puzzle = await getNextPuzzle(motif);
			this.puzzle = puzzle;
			this.chess = new Chess(puzzle.fen);
			this.fen = puzzle.fen;
			this.dests = computeDests(this.chess);
			this.lastMove = undefined;
			this.orientation = puzzle.fen.split(' ')[1] === 'b' ? 'black' : 'white';
			this.hintLevel = 0;
			this.wrong = false;
			this.attemptRecorded = false;
			this.solutionIndex = 0;
			this.status = 'solving';
		} catch (e) {
			this.puzzle = null;
			if (e instanceof ApiError && e.status === 404) {
				this.status = 'empty';
			} else {
				this.status = 'error';
				this.error = e instanceof Error ? e.message : String(e);
			}
		}
	}

	handleBoardMove(orig: Key, dest: Key): void {
		if (this.status !== 'solving' || !this.puzzle || !this.isPlayersTurn) return;
		const expected = this.puzzle.solution[this.solutionIndex];
		if (!expected) return;

		if (expected.slice(0, 4) === `${orig}${dest}`) {
			this.push(expected);
			this.advance();
			return;
		}
		// Lichess convention: any move that mates also counts as solving it.
		const probe = new Chess(this.fen);
		try {
			const move = probe.move({ from: orig, to: dest, promotion: 'q' });
			if (probe.isCheckmate()) {
				this.push(move.from + move.to + (move.promotion ?? ''));
				this.finishSolved();
				return;
			}
		} catch {
			return; // chessground restricts to legal moves; safety net
		}
		this.failTry(orig, dest);
	}

	/** Sets level 5 (full line shown) — the "reveal answer" escape hatch. */
	revealAnswer(): void {
		this.hintLevel = 5;
	}

	private push(uci: string): void {
		const move = this.chess.move(uciParts(uci));
		this.fen = this.chess.fen();
		this.dests = computeDests(this.chess);
		this.lastMove = [move.from as Key, move.to as Key];
		this.solutionIndex += 1;
	}

	private advance(): void {
		const solution = this.puzzle?.solution ?? [];
		if (this.solutionIndex >= solution.length) {
			this.finishSolved();
			return;
		}
		// opponent's scripted reply, after a beat so the exchange reads
		this.replyTimer = setTimeout(() => {
			if (this.status !== 'solving') return;
			this.push(solution[this.solutionIndex]);
			if (this.solutionIndex >= solution.length) this.finishSolved();
		}, REPLY_DELAY_MS);
	}

	private finishSolved(): void {
		this.status = 'solved';
		this.completedCount += 1;
		// A wrong try already recorded this puzzle as incorrect.
		if (!this.attemptRecorded && this.puzzle) {
			this.attemptRecorded = true;
			recordAttempt(this.puzzle.id, true, this.hintLevel).catch((e) =>
				console.error('recording attempt failed:', e)
			);
		}
	}

	private failTry(orig: Key, dest: Key): void {
		this.wrong = true;
		this.lastMove = [orig, dest];
		this.boardSyncKey += 1; // snap the wrongly-moved piece back
		if (!this.attemptRecorded && this.puzzle) {
			this.attemptRecorded = true;
			recordAttempt(this.puzzle.id, false, this.hintLevel).catch((e) =>
				console.error('recording attempt failed:', e)
			);
		}
	}
}
