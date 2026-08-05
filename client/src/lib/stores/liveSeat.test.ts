/** Seat credentials in localStorage.
 *
 * A seat token is a bearer credential with no account behind it and no expiry:
 * whoever holds it may move as that side. So what matters here is as much when
 * these stop existing as when they are written.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { clearAllSeats, clearSeat, loadSeat, saveSeat } from './liveSeat';

beforeEach(() => {
	// The node test environment has no localStorage. This stand-in implements
	// `key(index)` for real, unlike the one in gamePersistence.test.ts — the
	// index walk is exactly what clearAllSeats is built on, so a stub that
	// always answers null would make these tests pass against nothing.
	const store = new Map<string, string>();
	globalThis.localStorage = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, value),
		removeItem: (key: string) => void store.delete(key),
		clear: () => store.clear(),
		key: (index: number) => [...store.keys()][index] ?? null,
		get length() {
			return store.size;
		}
	} as Storage;
});

describe('one seat', () => {
	it('round-trips', () => {
		saveSeat('tok', { seat: 'seat-w', color: 'white' });

		expect(loadSeat('tok')).toEqual({ seat: 'seat-w', color: 'white' });
	});

	it('refuses a hand-edited or corrupt payload', () => {
		localStorage.setItem('leechess.liveSeat.tok', 'not json');
		expect(loadSeat('tok')).toBeNull();

		localStorage.setItem('leechess.liveSeat.tok', JSON.stringify({ seat: 'x', color: 'green' }));
		expect(loadSeat('tok')).toBeNull();

		localStorage.setItem('leechess.liveSeat.tok', JSON.stringify({ color: 'white' }));
		expect(loadSeat('tok')).toBeNull();
	});

	it('clears just the one it is asked to', () => {
		saveSeat('one', { seat: 'a', color: 'white' });
		saveSeat('two', { seat: 'b', color: 'black' });

		clearSeat('one');

		expect(loadSeat('one')).toBeNull();
		expect(loadSeat('two')).not.toBeNull();
	});
});

describe('clearing every seat', () => {
	it('drops all of them, whatever their tokens', () => {
		saveSeat('one', { seat: 'a', color: 'white' });
		saveSeat('two', { seat: 'b', color: 'black' });
		saveSeat('three', { seat: 'c', color: 'white' });

		clearAllSeats();

		expect(loadSeat('one')).toBeNull();
		expect(loadSeat('two')).toBeNull();
		expect(loadSeat('three')).toBeNull();
	});

	it('leaves everything else in storage alone', () => {
		localStorage.setItem('leechess.activeGame', 'the engine game');
		localStorage.setItem('leechess.theme', 'dark');
		saveSeat('one', { seat: 'a', color: 'white' });

		clearAllSeats();

		expect(localStorage.getItem('leechess.activeGame')).toBe('the engine game');
		expect(localStorage.getItem('leechess.theme')).toBe('dark');
		expect(loadSeat('one')).toBeNull();
	});

	it('does not skip keys while it iterates', () => {
		// Removing during a `store.key(i)` walk shifts the indices underneath,
		// which silently leaves every other seat behind — the exact bug that
		// makes "cleared on sign-out" only half true.
		for (let n = 0; n < 20; n += 1) saveSeat(`tok-${n}`, { seat: `s${n}`, color: 'white' });

		clearAllSeats();

		expect(localStorage.length).toBe(0);
	});
});
