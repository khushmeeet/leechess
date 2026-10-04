import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import { chancesFor } from '$lib/candidates';
import { gameMoves, guessPoints, guessVerdict, MAX_POINTS, type GameMove } from '$lib/guess';
import { computeDests } from './game.svelte';
import { stockfish } from './stockfish';

/** Depth both moves are weighed at — the same for each, so the comparison is
 * fair, and quick enough to keep the game moving. */
const GUESS_DEPTH = 12;

export interface GuessFeedback {
	guess: { uci: string; san: string; chances: number } | null;
	master: { uci: string; san: string; chances: number };
	points: number;
	text: string;
}

/** The run's totals, handed out after every scored guess and once more when
 * the game is over — what gets saved to the account. */
export interface GuessTotals {
	points: number;
	maxPoints: number;
	matched: number;
	guessed: number;
	finished: boolean;
}

/** One pass through a landmark game, guessing one side's moves (see
 * $lib/guess). The other side's moves play themselves. */
export class GuessSession {
	readonly moves: GameMove[];
	readonly side: 'white' | 'black';
	readonly player: string;

	/** The next move of the game still to be played. */
	index = $state(0);
	status = $state<'guessing' | 'weighing' | 'revealed' | 'done'>('guessing');
	feedback = $state<GuessFeedback | null>(null);
	points = $state(0);
	maxPoints = $state(0);
	matched = $state(0);
	guessed = $state(0);

	private generation = 0;
	private readonly onprogress: ((totals: GuessTotals) => void) | undefined;

	constructor(
		pgn: string,
		side: 'white' | 'black',
		player: string,
		onprogress?: (totals: GuessTotals) => void
	) {
		this.moves = gameMoves(pgn);
		this.side = side;
		this.player = player;
		this.onprogress = onprogress;
		this.skipOpponent();
	}

	/** The player's moves are all behind them: the game is over, or the move
	 * just revealed was their last one — finished without waiting for a
	 * "Next move" click that only leads to the final position. */
	private get finished(): boolean {
		if (this.status === 'done') return true;
		if (this.status !== 'revealed') return false;
		return !this.moves.slice(this.index + 1).some((move) => this.isPlayers(move));
	}

	/** Nothing to report until a guess has been scored: a run of shown moves
	 * only has no score to keep. */
	private report(): void {
		if (this.guessed === 0) return;
		this.onprogress?.({
			points: this.points,
			maxPoints: this.maxPoints,
			matched: this.matched,
			guessed: this.guessed,
			finished: this.finished
		});
	}

	/** The position on the board: after the master's move once it is shown. */
	get fen(): string {
		const move = this.moves[this.index];
		if (!move) return this.moves.at(-1)?.fenAfter ?? new Chess().fen();
		return this.status === 'revealed' ? move.fenAfter : move.fenBefore;
	}

	get lastMove(): [Key, Key] | undefined {
		const move = this.status === 'revealed' ? this.moves[this.index] : this.moves[this.index - 1];
		return move ? [move.uci.slice(0, 2) as Key, move.uci.slice(2, 4) as Key] : undefined;
	}

	get dests(): Map<Key, Key[]> {
		return computeDests(new Chess(this.fen));
	}

	/** Move number and side of the move being guessed: "17." / "17…". */
	get moveLabel(): string {
		const move = this.moves[this.index];
		if (!move) return '';
		const number = Number(move.fenBefore.split(' ')[5]);
		return `${number}${move.white ? '.' : '…'}`;
	}

	private isPlayers(move: GameMove | undefined): boolean {
		return move !== undefined && move.white === (this.side === 'white');
	}

	/** Play the other side's moves until it is the player's turn. */
	private skipOpponent(): void {
		while (this.index < this.moves.length && !this.isPlayers(this.moves[this.index])) {
			this.index += 1;
		}
		this.status = this.index >= this.moves.length ? 'done' : 'guessing';
		if (this.status === 'done') this.report();
	}

	async guess(orig: Key, dest: Key, promotion?: string): Promise<void> {
		const master = this.moves[this.index];
		if (this.status !== 'guessing' || !master) return;
		const board = new Chess(master.fenBefore);
		let san: string;
		let uci: string;
		try {
			const move = board.move({ from: orig, to: dest, promotion: promotion ?? 'q' });
			san = move.san;
			uci = move.from + move.to + (move.promotion ?? '');
		} catch {
			return;
		}
		const generation = ++this.generation;
		const white = master.white;
		if (uci === master.uci) {
			this.reveal({ uci, san, chances: NaN }, { ...master, chances: NaN }, true, 0);
			return;
		}
		this.status = 'weighing';
		const yours = await stockfish.evaluate(board.fen(), GUESS_DEPTH, 1);
		const theirs = await stockfish.evaluate(master.fenAfter, GUESS_DEPTH, 1);
		if (generation !== this.generation) return;
		const guessChances = chancesFor(yours, white);
		const masterChances = chancesFor(theirs, white);
		this.reveal(
			{ uci, san, chances: guessChances },
			{ uci: master.uci, san: master.san, chances: masterChances },
			false,
			masterChances - guessChances
		);
	}

	/** Show the master's move without guessing: no points either way. */
	skip(): void {
		const master = this.moves[this.index];
		if (this.status !== 'guessing' || !master) return;
		this.generation += 1;
		this.feedback = {
			guess: null,
			master: { uci: master.uci, san: master.san, chances: NaN },
			points: 0,
			text: guessVerdict(null, { san: master.san, chances: NaN }, this.player, 0)
		};
		this.status = 'revealed';
	}

	private reveal(
		guess: GuessFeedback['guess'],
		master: GuessFeedback['master'],
		same: boolean,
		drop: number
	): void {
		const points = guessPoints(same, drop);
		this.points += points;
		this.maxPoints += MAX_POINTS;
		this.guessed += 1;
		if (same) this.matched += 1;
		this.feedback = {
			guess,
			master,
			points,
			text: guessVerdict(guess, master, this.player, points)
		};
		this.status = 'revealed';
		this.report();
	}

	/** Past the master's move and the reply to it, to the next guess. */
	next(): void {
		if (this.status !== 'revealed') return;
		this.feedback = null;
		this.index += 1;
		this.skipOpponent();
	}
}
