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

export function startGame(mode: string): Promise<GameCreated> {
	return request('/games', { method: 'POST', body: JSON.stringify({ mode }) });
}

export function postMove(gameId: number, uci: string): Promise<MoveAccepted> {
	return request(`/games/${gameId}/moves`, { method: 'POST', body: JSON.stringify({ uci }) });
}

export function completeGame(gameId: number, result: string): Promise<GameSummary> {
	return request(`/games/${gameId}/complete`, {
		method: 'POST',
		body: JSON.stringify({ result })
	});
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
