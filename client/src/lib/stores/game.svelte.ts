import { Chess, SQUARES, type Square } from 'chess.js';
import type { Key } from 'chessground/types';
import { SvelteMap } from 'svelte/reactivity';

export interface PlayedMove {
	ply: number;
	san: string;
	uci: string;
	fenBefore: string;
	fenAfter: string;
}

export function computeDests(chess: Chess): Map<Key, Key[]> {
	const dests = new SvelteMap<Key, Key[]>();
	for (const square of SQUARES) {
		const moves = chess.moves({ square, verbose: true });
		if (moves.length > 0) {
			dests.set(
				square,
				moves.map((m) => m.to)
			);
		}
	}
	return dests;
}

/** Client-side game state. chess.js is the source of truth for legality/SAN;
 * chessground only renders and reports drag/click input.
 *
 * `startFen` defaults to the initial position, so a normal game constructs
 * with no arguments; endgame drills pass the position they begin from, and
 * `reset()` returns there rather than to move one. */
export class GameStore {
	private readonly startFen: string | undefined;
	private chess: Chess;

	fen = $state('');
	dests = $state<Map<Key, Key[]>>(new SvelteMap());
	moves = $state<PlayedMove[]>([]);
	lastMove = $state<[Key, Key] | undefined>(undefined);
	isGameOver = $state(false);
	result = $state('*');

	constructor(startFen?: string) {
		this.startFen = startFen;
		this.chess = new Chess(startFen);
		this.fen = this.chess.fen();
		this.dests = computeDests(this.chess);
	}

	turnColor: 'white' | 'black' = $derived(this.fen.split(' ')[1] === 'b' ? 'black' : 'white');

	/** Apply a move coming from the board. Returns the move or null if illegal
	 * (chessground already restricts to legal dests, so this is a safety net). */
	tryMove(orig: Key, dest: Key, promotion = 'q'): PlayedMove | null {
		if (this.isGameOver) return null;
		const fenBefore = this.chess.fen();
		let move;
		try {
			// promotion comes from the board's picker; 'q' covers UCI without a suffix
			move = this.chess.move({ from: orig as Square, to: dest as Square, promotion });
		} catch {
			return null;
		}
		const played: PlayedMove = {
			ply: this.moves.length + 1,
			san: move.san,
			uci: move.from + move.to + (move.promotion ?? ''),
			fenBefore,
			fenAfter: this.chess.fen()
		};
		this.moves.push(played);
		this.fen = this.chess.fen();
		this.dests = computeDests(this.chess);
		this.lastMove = [move.from, move.to];
		if (this.chess.isGameOver()) {
			this.isGameOver = true;
			this.result = this.computeResult();
		}
		return played;
	}

	/** Apply an engine move given as UCI ("e2e4", "e7e8q"). */
	applyUci(uci: string): PlayedMove | null {
		return this.tryMove(uci.slice(0, 2) as Key, uci.slice(2, 4) as Key, uci[4] ?? 'q');
	}

	/** Rebuild the game from a persisted UCI move list by replaying it —
	 * SAN, FENs, and game-over state are re-derived, so the replay doubles as
	 * validation. Returns false (and resets) if any move is illegal. */
	loadMoves(ucis: string[]): boolean {
		this.reset();
		for (const uci of ucis) {
			if (!this.applyUci(uci)) {
				this.reset();
				return false;
			}
		}
		return true;
	}

	/** Retract the last `count` plies by replaying what remains, so fen/dests/
	 * lastMove/game-over are all re-derived rather than unwound by hand.
	 * Returns false (leaving the game untouched) for an out-of-range count. */
	takeBack(count: number): boolean {
		if (count <= 0 || count > this.moves.length) return false;
		return this.loadMoves(this.moves.slice(0, -count).map((move) => move.uci));
	}

	/** End the game by resignation of `color`. */
	resign(color: 'white' | 'black'): void {
		if (this.isGameOver) return;
		this.isGameOver = true;
		this.result = color === 'white' ? '0-1' : '1-0';
	}

	/** True when the position on the board is checkmate/stalemate/draw
	 * (false for resignations — the board itself is still playable). */
	get boardGameOver(): boolean {
		return this.chess.isGameOver();
	}

	private computeResult(): string {
		if (this.chess.isCheckmate()) return this.chess.turn() === 'w' ? '0-1' : '1-0';
		if (this.chess.isDraw()) return '1/2-1/2';
		return '*';
	}

	reset(): void {
		this.chess = new Chess(this.startFen);
		this.fen = this.chess.fen();
		this.dests = computeDests(this.chess);
		this.moves = [];
		this.lastMove = undefined;
		this.isGameOver = false;
		this.result = '*';
	}
}
