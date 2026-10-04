import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ startGuessRun: vi.fn(), updateGuessRun: vi.fn() }));
vi.mock('$lib/api/client', () => api);

import { GuessRunRecorder } from './guessRuns';

const totals = (guessed: number, finished = false) => ({
	points: 4 * guessed,
	maxPoints: 5 * guessed,
	matched: 0,
	guessed,
	finished
});

beforeEach(() => {
	vi.resetAllMocks();
});

describe('GuessRunRecorder', () => {
	it('creates the run on the first guess and updates it after', async () => {
		api.startGuessRun.mockResolvedValue({ id: 7 });
		const recorder = new GuessRunRecorder('opera-1858', 'white');
		recorder.record(totals(1));
		await recorder.record(totals(2, true));

		expect(api.startGuessRun).toHaveBeenCalledExactlyOnceWith({
			game_id: 'opera-1858',
			side: 'white',
			points: 4,
			max_points: 5,
			matched: 0,
			guessed: 1,
			finished: false
		});
		expect(api.updateGuessRun).toHaveBeenCalledExactlyOnceWith(
			7,
			expect.objectContaining({ guessed: 2, finished: true })
		);
	});

	it('retries a creation that failed on the next guess', async () => {
		api.startGuessRun.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ id: 3 });
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const recorder = new GuessRunRecorder('opera-1858', 'black');
		await recorder.record(totals(1));
		await recorder.record(totals(2));

		expect(api.startGuessRun).toHaveBeenCalledTimes(2);
		expect(api.updateGuessRun).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledOnce();
	});
});
