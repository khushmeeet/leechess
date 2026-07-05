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

export interface MoveRecord {
	ply: number;
	san: string;
	fen_before: string;
	fen_after: string;
	eval_before: number | null;
	eval_after: number | null;
	classification: string | null;
	best_move: string | null;
}

export interface GameDetail extends GameSummary {
	pgn: string;
	moves: MoveRecord[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${BASE}${path}`, {
		headers: { 'Content-Type': 'application/json' },
		...init
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`${init?.method ?? 'GET'} ${path} failed (${response.status}): ${body}`);
	}
	return response.json();
}

export function createGame(pgn: string, mode = 'local'): Promise<GameSummary> {
	return request('/games', { method: 'POST', body: JSON.stringify({ pgn, mode }) });
}

export function getGame(id: number | string): Promise<GameDetail> {
	return request(`/games/${id}`);
}
