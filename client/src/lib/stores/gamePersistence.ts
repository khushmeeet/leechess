import type { Classification } from '$lib/classification';

const STORAGE_KEY = 'leechess.activeGame';
const VERSION = 1;

/** Snapshot of an in-progress (or naturally finished) game, saved after every
 * state change so a refresh or in-app navigation restores it. Moves are UCI
 * only — SAN/FENs/game-over are rebuilt by replaying through chess.js, which
 * doubles as the integrity check on whatever was in storage. */
export interface SavedGame {
	version: number;
	engineSkill: number;
	moves: string[];
	evals: (number | null)[];
	badges: (Classification | null)[];
	lastFeedback: { ply: number; san: string; classification: Classification } | null;
	currentEval: number | null;
	serverGameId: number | null;
	completedGameId: number | null;
}

const CLASSIFICATIONS = new Set(['best', 'good', 'inaccuracy', 'mistake', 'blunder']);

function isNumberOrNull(value: unknown): value is number | null {
	return value === null || typeof value === 'number';
}

/** Shape-validate a raw storage payload; move legality is checked separately
 * by replaying. Returns null for anything unrecognizable (corrupt JSON,
 * an older schema version, hand-edited storage). */
export function parseSavedGame(raw: string | null): SavedGame | null {
	if (!raw) return null;
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof data !== 'object' || data === null) return null;
	const saved = data as Record<string, unknown>;
	if (saved.version !== VERSION) return null;
	if (typeof saved.engineSkill !== 'number') return null;
	if (!Array.isArray(saved.moves) || saved.moves.length === 0) return null;
	if (
		!saved.moves.every(
			(uci) => typeof uci === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)
		)
	)
		return null;
	if (!Array.isArray(saved.evals) || !saved.evals.every(isNumberOrNull)) return null;
	if (
		!Array.isArray(saved.badges) ||
		!saved.badges.every((badge) => badge === null || CLASSIFICATIONS.has(badge as string))
	)
		return null;
	if (!isNumberOrNull(saved.currentEval)) return null;
	if (!isNumberOrNull(saved.serverGameId)) return null;
	if (!isNumberOrNull(saved.completedGameId)) return null;
	const feedback = saved.lastFeedback as SavedGame['lastFeedback'];
	if (feedback !== null) {
		if (typeof feedback !== 'object') return null;
		if (typeof feedback.ply !== 'number' || typeof feedback.san !== 'string') return null;
		if (!CLASSIFICATIONS.has(feedback.classification)) return null;
	}
	const moves = saved.moves as string[];
	return {
		version: VERSION,
		engineSkill: saved.engineSkill,
		moves,
		// badge/eval arrays align to moves by ply index — never let them run past
		evals: (saved.evals as (number | null)[]).slice(0, moves.length),
		badges: (saved.badges as (Classification | null)[]).slice(0, moves.length),
		lastFeedback: feedback,
		currentEval: saved.currentEval,
		serverGameId: saved.serverGameId,
		completedGameId: saved.completedGameId
	};
}

/** `typeof` guard instead of $app/environment so this module stays importable
 * from node-side unit tests (the app itself is browser-only, ssr = false). */
function storage(): Storage | null {
	return typeof localStorage === 'undefined' ? null : localStorage;
}

export function loadActiveGame(): SavedGame | null {
	return parseSavedGame(storage()?.getItem(STORAGE_KEY) ?? null);
}

export function saveActiveGame(saved: Omit<SavedGame, 'version'>): void {
	try {
		storage()?.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, ...saved }));
	} catch {
		// quota/private-mode failures: the game just doesn't survive a refresh
	}
}

export function clearActiveGame(): void {
	storage()?.removeItem(STORAGE_KEY);
}
