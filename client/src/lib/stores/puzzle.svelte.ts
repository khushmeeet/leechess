import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import { SvelteMap } from 'svelte/reactivity';
import { ApiError, getNextPuzzle, recordAttempt, type PuzzleRecord } from '$lib/api/client';
import { chancesFor } from '$lib/candidates';
import { playLine } from '$lib/lines';
import { passTurn } from '$lib/threats';
import { computeDests } from './game.svelte';
import { soundPrefs } from './soundPrefs.svelte';
import { stockfish } from './stockfish';

export type PuzzleStatus = 'loading' | 'empty' | 'solving' | 'solved' | 'error';
/** A defence puzzle is two questions: where does their threat land (`spot`),
 * then what answers it (`solve`). Every other puzzle is `solve` alone. */
export type PuzzlePhase = 'spot' | 'solve';
/** Wrong squares before the threat is shown instead. */
const SPOT_TRIES = 2;

const REPLY_DELAY_MS = 350;
/** Depth a defence other than the stored one is weighed at, against the
 * stored one at the same depth. */
const DEFENCE_DEPTH = 12;
/** A defence is accepted when the threat is gone and it keeps the solver's
 * winning chances within this many points of the stored answer — move
 * grading's inaccuracy bar. A defence puzzle asks for an answer to the
 * threat, and there is usually more than one. */
const DEFENCE_MARGIN = 5;

/** A move as written in a sentence: "…Qxf7#" for Black, "Qxf7#" for White. */
function writtenSan(fenBefore: string, san: string): string {
	return fenBefore.split(' ')[1] === 'b' ? `…${san}` : san;
}

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
	phase = $state<PuzzlePhase>('solve');
	/** A defence other than the stored answer, being weighed by the engine. */
	checking = $state<string | null>(null);
	/** The solver's own defence, when it was accepted in place of the
	 * stored answer. */
	alternative = $state<string | null>(null);
	/** Why the last defence tried does not work, in words. */
	refusal = $state<string | null>(null);
	/** How the threat was found: by the solver, or shown after misses. */
	spotted = $state<'found' | 'shown' | null>(null);
	spotMisses = $state(0);
	completedCount = $state(0);

	/** Index into puzzle.solution of the next expected move (either side). */
	private solutionIndex = $state(0);
	private chess = new Chess();
	private attemptRecorded = false;
	private replyTimer: ReturnType<typeof setTimeout> | undefined;
	/** Bumped per load() so an out-of-order response can be dropped. */
	private loadGeneration = 0;

	get playerColor(): 'white' | 'black' {
		return this.orientation;
	}

	get isPlayersTurn(): boolean {
		return this.fen.split(' ')[1] === (this.playerColor === 'white' ? 'w' : 'b');
	}

	/** The solver's next expected move, looking past a pending opponent
	 * reply if needed — drives hint Levels 3-4. `fen` is the position it is
	 * played in. */
	nextPlayerMove: { san: string; uci: string; fen: string } | null = $derived.by(() => {
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
		const fen = chess.fen();
		try {
			return { san: chess.move(uciParts(uci)).san, uci, fen };
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
		// Latest request wins. The screen calls load() from an $effect on the
		// motif filter and from the "next puzzle" button, so two can easily be
		// in flight — and without this the SLOWER one lands last and puts the
		// puzzle the user already moved past back on the board.
		const generation = ++this.loadGeneration;
		this.status = 'loading';
		this.error = null;
		try {
			const puzzle = await getNextPuzzle(motif);
			if (generation !== this.loadGeneration) return;
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
			this.phase = puzzle.threat ? 'spot' : 'solve';
			this.checking = null;
			this.alternative = null;
			this.refusal = null;
			this.spotted = null;
			this.spotMisses = 0;
			this.status = 'solving';
		} catch (e) {
			// A stale failure must not bury a newer success either.
			if (generation !== this.loadGeneration) return;
			this.puzzle = null;
			if (e instanceof ApiError && e.status === 404) {
				this.status = 'empty';
			} else {
				this.status = 'error';
				this.error = e instanceof Error ? e.message : String(e);
			}
		}
	}

	/** The threat's squares: where it lands, and the piece that makes it. */
	get threatSquares(): { from: Key; to: Key } | null {
		const threat = this.puzzle?.threat;
		return threat ? { from: threat.slice(0, 2) as Key, to: threat.slice(2, 4) as Key } : null;
	}

	/** A square clicked while spotting. The square the threat lands on is
	 * the answer, and so is the piece making it — either way the solver has
	 * seen it. After `SPOT_TRIES` misses the threat is shown, which counts
	 * as a hint (the ladder's motif level), and the solve step begins. */
	spotSquare(key: Key): void {
		const squares = this.threatSquares;
		if (this.status !== 'solving' || this.phase !== 'spot' || !squares) return;
		if (key === squares.to || key === squares.from) {
			this.spotted = 'found';
			this.phase = 'solve';
			return;
		}
		this.spotMisses += 1;
		if (this.spotMisses >= SPOT_TRIES) {
			this.spotted = 'shown';
			this.hintLevel = Math.max(this.hintLevel, 2);
			this.phase = 'solve';
		}
	}

	handleBoardMove(orig: Key, dest: Key, promotion?: string): void {
		if (this.status !== 'solving' || !this.puzzle || !this.isPlayersTurn) return;
		if (this.phase !== 'solve' || this.checking) return;
		const expected = this.puzzle.solution[this.solutionIndex];
		if (!expected) return;

		// promotion is set by the board's picker, so an underpromotion in the
		// solution only matches when the solver actually picked that piece
		if (expected === `${orig}${dest}${promotion ?? ''}`) {
			this.push(expected);
			this.advance();
			return;
		}
		// Lichess convention: any move that mates also counts as solving it.
		const probe = new Chess(this.fen);
		try {
			const move = probe.move({ from: orig, to: dest, promotion: promotion ?? 'q' });
			if (probe.isCheckmate()) {
				this.push(move.from + move.to + (move.promotion ?? ''));
				this.finishSolved();
				return;
			}
		} catch {
			return; // chessground restricts to legal moves; safety net
		}
		if (this.puzzle.threat && this.solutionIndex === 0) {
			void this.weighDefence(orig, dest, promotion);
			return;
		}
		this.failTry(orig, dest);
	}

	/** A defence puzzle's move that isn't the stored answer: weigh both with
	 * the engine. Accepted when the threat is no longer their best reply and
	 * the move keeps the solver's chances within `DEFENCE_MARGIN` of the
	 * stored answer; otherwise refused, with the reason. */
	private async weighDefence(orig: Key, dest: Key, promotion?: string): Promise<void> {
		const puzzle = this.puzzle!;
		const generation = this.loadGeneration;
		const fen = this.fen;
		const [tried] = playLine(fen, [`${orig}${dest}${promotion ?? ''}`]);
		const [answer] = playLine(fen, [puzzle.solution[0]]);
		if (!tried || !answer) {
			this.failTry(orig, dest);
			return;
		}
		this.checking = tried.san;
		this.refusal = null;
		const white = fen.split(' ')[1] === 'w';
		let mine;
		let theirs;
		try {
			mine = await stockfish.evaluate(tried.fenAfter, DEFENCE_DEPTH, 1);
			theirs = await stockfish.evaluate(answer.fenAfter, DEFENCE_DEPTH, 1);
		} catch {
			mine = null;
			theirs = null;
		}
		if (generation !== this.loadGeneration || this.puzzle !== puzzle || this.fen !== fen) return;
		this.checking = null;
		if (!mine || !theirs) {
			this.failTry(orig, dest); // no engine to ask: only the stored answer counts
			return;
		}

		const leftOn = mine.bestMove === puzzle.threat;
		const close = chancesFor(mine, white) >= chancesFor(theirs, white) - DEFENCE_MARGIN;
		if (!leftOn && close) {
			this.push(tried.uci);
			this.alternative = tried.san;
			this.finishSolved();
			return;
		}
		const passed = passTurn(fen);
		const [threat] = passed ? playLine(passed, [puzzle.threat!]) : [];
		const [reply] = playLine(tried.fenAfter, [mine.bestMove]);
		this.refusal = leftOn
			? `${tried.san} leaves ${threat ? writtenSan(threat.fenBefore, threat.san) : 'their threat'} on the board.`
			: reply
				? `${tried.san} gets out of it, but then their best is ${writtenSan(reply.fenBefore, reply.san)}.`
				: `${tried.san} gets out of it, but loses more elsewhere.`;
		this.failTry(orig, dest);
	}

	/** Sets level 5 (full line shown) — the "reveal answer" escape hatch. */
	revealAnswer(): void {
		this.hintLevel = 5;
	}

	private push(uci: string, byOpponent = false): void {
		const move = this.chess.move(uciParts(uci));
		soundPrefs.move(move.san, byOpponent);
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
			this.push(solution[this.solutionIndex], true);
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
		soundPrefs.play('illegal');
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
