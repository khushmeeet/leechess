import { beforeEach, describe, expect, it } from 'vitest';
import {
	clearActiveGame,
	loadActiveGame,
	parseSavedGame,
	saveActiveGame,
	type SavedGame
} from './gamePersistence';

const snapshot: Omit<SavedGame, 'version'> = {
	owner: 'account-1',
	engineSkill: 5,
	playerColor: 'white',
	moves: ['e2e4', 'e7e5', 'g1f3'],
	evals: [30, 25, null],
	badges: ['best', null, null],
	lastFeedback: { ply: 1, san: 'e4', classification: 'best' },
	currentEval: 25,
	serverGameId: 12,
	completedGameId: null,
	completedGameNumber: null
};

function valid(): Record<string, unknown> {
	return JSON.parse(JSON.stringify({ version: 2, ...snapshot }));
}

describe('parseSavedGame', () => {
	it('accepts a well-formed snapshot', () => {
		expect(parseSavedGame(JSON.stringify(valid()))).toEqual({ version: 2, ...snapshot });
	});

	it('rejects null, corrupt JSON, and non-objects', () => {
		expect(parseSavedGame(null)).toBeNull();
		expect(parseSavedGame('')).toBeNull();
		expect(parseSavedGame('{not json')).toBeNull();
		expect(parseSavedGame('"a string"')).toBeNull();
		expect(parseSavedGame('42')).toBeNull();
	});

	it('rejects other schema versions', () => {
		// including version 1, which predates the owner field: there is no way
		// to tell whose game it was, and guessing is the bug that field prevents
		expect(parseSavedGame(JSON.stringify({ ...valid(), version: 1 }))).toBeNull();
		expect(parseSavedGame(JSON.stringify({ ...valid(), version: 3 }))).toBeNull();
		expect(parseSavedGame(JSON.stringify({ ...valid(), version: undefined }))).toBeNull();
	});

	it('rejects a snapshot with no owner on it', () => {
		expect(parseSavedGame(JSON.stringify({ ...valid(), owner: undefined }))).toBeNull();
		expect(parseSavedGame(JSON.stringify({ ...valid(), owner: '' }))).toBeNull();
		expect(parseSavedGame(JSON.stringify({ ...valid(), owner: 7 }))).toBeNull();
	});

	it('rejects an empty or malformed move list', () => {
		expect(parseSavedGame(JSON.stringify({ ...valid(), moves: [] }))).toBeNull();
		expect(parseSavedGame(JSON.stringify({ ...valid(), moves: ['e2e4', 'huh'] }))).toBeNull();
		expect(parseSavedGame(JSON.stringify({ ...valid(), moves: ['e2e4', 5] }))).toBeNull();
		expect(parseSavedGame(JSON.stringify({ ...valid(), moves: 'e2e4' }))).toBeNull();
	});

	it('accepts promotion moves', () => {
		const saved = parseSavedGame(JSON.stringify({ ...valid(), moves: ['e7e8q'] }));
		expect(saved?.moves).toEqual(['e7e8q']);
	});

	it('defaults a missing player color to white and rejects invalid ones', () => {
		const legacy = valid();
		delete legacy.playerColor; // save from before color choice existed
		expect(parseSavedGame(JSON.stringify(legacy))?.playerColor).toBe('white');
		const black = parseSavedGame(JSON.stringify({ ...valid(), playerColor: 'black' }));
		expect(black?.playerColor).toBe('black');
		expect(parseSavedGame(JSON.stringify({ ...valid(), playerColor: 'green' }))).toBeNull();
	});

	it('rejects tampered eval/badge/feedback fields', () => {
		expect(parseSavedGame(JSON.stringify({ ...valid(), evals: [30, 'x'] }))).toBeNull();
		expect(parseSavedGame(JSON.stringify({ ...valid(), badges: ['amazing'] }))).toBeNull();
		expect(parseSavedGame(JSON.stringify({ ...valid(), serverGameId: 'twelve' }))).toBeNull();
		expect(parseSavedGame(JSON.stringify({ ...valid(), engineSkill: 'max' }))).toBeNull();
		expect(parseSavedGame(JSON.stringify({ ...valid(), lastFeedback: { ply: 1 } }))).toBeNull();
	});

	it('truncates eval/badge arrays that outrun the move list', () => {
		const saved = parseSavedGame(
			JSON.stringify({
				...valid(),
				evals: [30, 25, 20, 15, 10],
				badges: [null, null, null, 'best']
			})
		);
		expect(saved?.evals).toEqual([30, 25, 20]);
		expect(saved?.badges).toEqual([null, null, null]);
	});
});

describe('localStorage wrappers', () => {
	beforeEach(() => {
		// node test env has no localStorage — a Map-backed stand-in is enough
		const store = new Map<string, string>();
		globalThis.localStorage = {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => void store.set(key, value),
			removeItem: (key: string) => void store.delete(key),
			clear: () => store.clear(),
			key: () => null,
			get length() {
				return store.size;
			}
		} as Storage;
	});

	it('round-trips a snapshot through save/load', () => {
		expect(loadActiveGame(snapshot.owner)).toBeNull();
		saveActiveGame(snapshot);
		expect(loadActiveGame(snapshot.owner)).toEqual({ version: 2, ...snapshot });
	});

	it('clear removes the saved game', () => {
		saveActiveGame(snapshot);
		clearActiveGame();
		expect(loadActiveGame(snapshot.owner)).toBeNull();
	});

	it('never hands a game to anyone but the player who saved it', () => {
		// Signing up mid-game is the case: the anonymous game must not become
		// the new account's, in the tab that created it or any later one.
		saveActiveGame({ ...snapshot, owner: 'anonymous' });

		expect(loadActiveGame('account-1')).toBeNull();
		// and it is gone, not merely refused — nothing is kept from a session
		// that keeps nothing
		expect(loadActiveGame('anonymous')).toBeNull();
	});
});
