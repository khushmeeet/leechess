import { beforeEach, describe, expect, it } from 'vitest';
import {
	clearActiveGame,
	loadActiveGame,
	parseSavedGame,
	saveActiveGame,
	type SavedGame
} from './gamePersistence';

const snapshot: Omit<SavedGame, 'version'> = {
	engineSkill: 5,
	moves: ['e2e4', 'e7e5', 'g1f3'],
	evals: [30, 25, null],
	badges: ['best', null, null],
	lastFeedback: { ply: 1, san: 'e4', classification: 'best' },
	currentEval: 25,
	serverGameId: 12,
	completedGameId: null
};

function valid(): Record<string, unknown> {
	return JSON.parse(JSON.stringify({ version: 1, ...snapshot }));
}

describe('parseSavedGame', () => {
	it('accepts a well-formed snapshot', () => {
		expect(parseSavedGame(JSON.stringify(valid()))).toEqual({ version: 1, ...snapshot });
	});

	it('rejects null, corrupt JSON, and non-objects', () => {
		expect(parseSavedGame(null)).toBeNull();
		expect(parseSavedGame('')).toBeNull();
		expect(parseSavedGame('{not json')).toBeNull();
		expect(parseSavedGame('"a string"')).toBeNull();
		expect(parseSavedGame('42')).toBeNull();
	});

	it('rejects other schema versions', () => {
		expect(parseSavedGame(JSON.stringify({ ...valid(), version: 2 }))).toBeNull();
		expect(parseSavedGame(JSON.stringify({ ...valid(), version: undefined }))).toBeNull();
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
		expect(loadActiveGame()).toBeNull();
		saveActiveGame(snapshot);
		expect(loadActiveGame()).toEqual({ version: 1, ...snapshot });
	});

	it('clear removes the saved game', () => {
		saveActiveGame(snapshot);
		clearActiveGame();
		expect(loadActiveGame()).toBeNull();
	});
});
