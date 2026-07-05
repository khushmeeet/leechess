import { Chess, SQUARES, type Square } from 'chess.js';
import type { Key } from 'chessground/types';
import { SvelteMap } from 'svelte/reactivity';

export interface PlayedMove {
	ply: number;
	san: string;
	fenBefore: string;
	fenAfter: string;
}

function computeDests(chess: Chess): Map<Key, Key[]> {
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
 * chessground only renders and reports drag/click input. */
export class GameStore {
	private chess = new Chess();

	fen = $state(this.chess.fen());
	dests = $state(computeDests(this.chess));
	moves = $state<PlayedMove[]>([]);
	lastMove = $state<[Key, Key] | undefined>(undefined);
	isGameOver = $state(false);
	result = $state('*');

	turnColor: 'white' | 'black' = $derived(this.fen.split(' ')[1] === 'b' ? 'black' : 'white');

	/** Apply a move coming from the board. Returns false if illegal (chessground
	 * already restricts to legal dests, so this is a safety net). */
	tryMove(orig: Key, dest: Key): boolean {
		const fenBefore = this.chess.fen();
		let move;
		try {
			// Promotion picker deferred: auto-queen is fine for Phase 0.
			move = this.chess.move({ from: orig as Square, to: dest as Square, promotion: 'q' });
		} catch {
			return false;
		}
		this.moves.push({
			ply: this.moves.length + 1,
			san: move.san,
			fenBefore,
			fenAfter: this.chess.fen()
		});
		this.fen = this.chess.fen();
		this.dests = computeDests(this.chess);
		this.lastMove = [move.from, move.to];
		if (this.chess.isGameOver()) {
			this.isGameOver = true;
			this.result = this.computeResult();
		}
		return true;
	}

	private computeResult(): string {
		if (this.chess.isCheckmate()) return this.chess.turn() === 'w' ? '0-1' : '1-0';
		if (this.chess.isDraw()) return '1/2-1/2';
		return '*';
	}

	pgn(): string {
		this.chess.setHeader('Event', 'leechess casual game');
		this.chess.setHeader('White', 'player');
		this.chess.setHeader('Black', 'player');
		this.chess.setHeader('Result', this.result);
		return this.chess.pgn();
	}

	reset(): void {
		this.chess = new Chess();
		this.fen = this.chess.fen();
		this.dests = computeDests(this.chess);
		this.moves = [];
		this.lastMove = undefined;
		this.isGameOver = false;
		this.result = '*';
	}
}
