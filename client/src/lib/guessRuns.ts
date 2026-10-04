/** Saves a guess-the-move run to the account as it goes: created on its
 * first scored guess, updated after each one after that. Calls are queued so
 * an update never overtakes the creation it needs the id from, and a failed
 * save is dropped quietly — the run on screen is unaffected, and the next
 * guess tries again (a failed creation is retried as a creation). */
import { startGuessRun, updateGuessRun } from '$lib/api/client';
import type { GuessTotals } from '$lib/stores/guess.svelte';

export class GuessRunRecorder {
	private id: number | null = null;
	private queue: Promise<void> = Promise.resolve();

	constructor(
		private readonly gameId: string,
		private readonly side: 'white' | 'black'
	) {}

	record(totals: GuessTotals): Promise<void> {
		const body = {
			game_id: this.gameId,
			side: this.side,
			points: totals.points,
			max_points: totals.maxPoints,
			matched: totals.matched,
			guessed: totals.guessed,
			finished: totals.finished
		};
		this.queue = this.queue
			.then(async () => {
				if (this.id === null) this.id = (await startGuessRun(body)).id;
				else await updateGuessRun(this.id, body);
			})
			.catch((error) => console.warn('guess run not saved:', error));
		return this.queue;
	}
}
