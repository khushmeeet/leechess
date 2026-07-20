// Thin fetch wrappers for the FastAPI backend. In dev the API runs on :8000;
// in production FastAPI serves this SPA, so requests are same-origin.
const BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:8000' : '');

export interface GameSummary {
	id: number;
	white: string;
	black: string;
	result: string;
	mode: string;
	created_at: string;
	analysis_status: string;
}

export interface GameCreated extends GameSummary {
	fen: string;
}

export interface MoveRecord {
	ply: number;
	san: string;
	fen_before: string;
	fen_after: string;
	eval_before: number | null;
	eval_after: number | null;
	classification: string | null;
	best_move: string | null;
	motifs: string[];
	/** Cached LLM "why" text — only flagged moves have one (Phase 5). */
	explanation: string | null;
}

export interface MoveAccepted {
	ply: number;
	san: string;
	uci: string;
	fen_after: string;
	turn: 'white' | 'black';
	game_over: boolean;
}

export interface GameDetail extends GameSummary {
	pgn: string;
	moves: MoveRecord[];
	/** Cached LLM coach takeaways — null until the analysis job writes them. */
	summary: string | null;
}

export class ApiError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(message);
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${BASE}${path}`, {
		headers: { 'Content-Type': 'application/json' },
		...init
	});
	if (!response.ok) {
		const body = await response.text();
		throw new ApiError(
			response.status,
			`${init?.method ?? 'GET'} ${path} failed (${response.status}): ${body}`
		);
	}
	if (response.status === 204) return undefined as T;
	return response.json();
}

/** `name` is the human player's display name (usernamePrefs); omitted while
 * unset, which leaves the server's "player" default in place. `userColor` is
 * the side the human plays — the engine takes the other seat, and the server
 * attributes progress/summary stats by it. */
export function startGame(
	mode: string,
	name?: string,
	userColor: 'white' | 'black' = 'white'
): Promise<GameCreated> {
	const names =
		mode === 'engine'
			? userColor === 'white'
				? { white: name ?? 'player', black: 'stockfish' }
				: { white: 'stockfish', black: name ?? 'player' }
			: name
				? { white: name }
				: {};
	return request('/games', {
		method: 'POST',
		body: JSON.stringify({ mode, user_color: userColor, ...names })
	});
}

export function postMove(gameId: number, uci: string): Promise<MoveAccepted> {
	return request(`/games/${gameId}/moves`, { method: 'POST', body: JSON.stringify({ uci }) });
}

/** keepalive: completion often races page exit (resign, then close the tab) —
 * a resigned game is no longer persisted, so an aborted request would leave
 * an orphaned unfinished record with no resync to recover it. */
export function completeGame(gameId: number, result: string): Promise<GameSummary> {
	return request(`/games/${gameId}/complete`, {
		method: 'POST',
		body: JSON.stringify({ result }),
		keepalive: true
	});
}

/** Abandoned unfinished game: delete the server record instead of leaving
 * it around. keepalive lets the request survive tab close / navigation. */
export function discardGame(gameId: number): Promise<void> {
	return request(`/games/${gameId}`, { method: 'DELETE', keepalive: true });
}

export function getGame(id: number | string): Promise<GameDetail> {
	return request(`/games/${id}`);
}

export function getReview(id: number | string): Promise<GameDetail> {
	return request(`/games/${id}/review`);
}

export function listGames(): Promise<GameSummary[]> {
	return request('/games');
}

export interface WikibookPage {
	/** The page describes the position after this many plies. */
	ply: number;
	title: string;
	/** Canonical WikiBooks URL — shown for CC BY-SA attribution. */
	url: string;
	/** Server-sanitized page body, safe to {@html}. */
	html: string;
}

/** Wikibooks opening-theory pages for each move-sequence prefix, from move 1
 * until the first position out of book. pages[i] covers ply i+1. */
export function getWikibookLine(sans: string[]): Promise<{ pages: WikibookPage[] }> {
	return request(`/wikibook/line?moves=${encodeURIComponent(sans.join(','))}`);
}

export interface PuzzleRecord {
	id: number;
	fen: string;
	/** UCI moves, solver's move first, opponent replies interleaved. */
	solution: string[];
	motif: string;
	difficulty: number | null;
	source_move_id: number | null; // null = generic Lichess import
	box: number;
	due_at: string;
}

export interface AttemptRecorded {
	id: number;
	puzzle_id: number;
	correct: boolean;
	hint_level_used: number;
	attempted_at: string;
	box: number;
	due_at: string;
}

export interface PracticeQueued {
	game_id: number;
	queued: number;
}

/** Read-only: returns the same puzzle until an attempt reschedules it.
 * Throws ApiError with status 404 when nothing is due. */
export function getNextPuzzle(motif?: string | null): Promise<PuzzleRecord> {
	const suffix = motif ? `?motif=${encodeURIComponent(motif)}` : '';
	return request(`/puzzles/next${suffix}`);
}

export function recordAttempt(
	puzzleId: number,
	correct: boolean,
	hintLevelUsed: number
): Promise<AttemptRecorded> {
	return request(`/puzzles/${puzzleId}/attempt`, {
		method: 'POST',
		body: JSON.stringify({ correct, hint_level_used: hintLevelUsed })
	});
}

/** Review's "practice these misses": make this game's puzzles due now. */
export function practiceGame(gameId: number): Promise<PracticeQueued> {
	return request(`/games/${gameId}/practice`, { method: 'POST' });
}

export interface MotifProgress {
	motif: string;
	attempts: number;
	correct: number;
	success_rate: number; // 0..1
}

/** One analyzed game's avg centipawn loss from the player's side (engine
 * games count White only). Phase values are null when the game never
 * reached that phase. */
export interface GameCplPoint {
	game_id: number;
	created_at: string;
	mode: string;
	avg_cpl: number;
	opening_cpl: number | null;
	middlegame_cpl: number | null;
	endgame_cpl: number | null;
}

export interface ProgressSummary {
	days: number | null; // echo of the window filter; null = all-time
	motifs: MotifProgress[]; // weakest first
	weakest_motifs: MotifProgress[]; // ≤3, enough attempts, <100% success
	cpl_trend: GameCplPoint[]; // oldest → newest
	streak_days: number;
	puzzles_solved: number;
}

export function getProgress(days?: number | null): Promise<ProgressSummary> {
	const suffix = days ? `?days=${days}` : '';
	return request(`/progress${suffix}`);
}
