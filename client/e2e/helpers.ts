import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** The dedicated e2e backend port from playwright.config.ts. Not 8000: a
 * developer's own server lives there, and the suite must never reach it. */
export const API = 'http://localhost:8123';

/** Squares → page coordinates. The board flips for black orientation (puzzles
 * are viewed from the solver's side), so coordinates flip too. */
async function squareCenter(
	page: Page,
	square: string,
	orientation: 'white' | 'black'
): Promise<{ x: number; y: number }> {
	const board = page.locator('cg-board');
	// page.mouse.click takes raw coordinates and never scrolls, so a square
	// outside the viewport is clicked into empty space with no error. Bring the
	// board on screen first, then measure — the config's viewport is tall
	// enough to hold all eight ranks once it is.
	await board.scrollIntoViewIfNeeded();
	const box = (await board.boundingBox())!;
	const size = box.width / 8;
	const file = square.charCodeAt(0) - 96; // a → 1
	const rank = Number(square[1]);
	const point = {
		x: box.x + (orientation === 'white' ? (file - 0.5) * size : (8.5 - file) * size),
		y: box.y + (orientation === 'white' ? (8.5 - rank) * size : (rank - 0.5) * size)
	};

	// A click outside the viewport is a no-op that reports no error, which is
	// how a whole rank of the board became unclickable without any test
	// noticing. Fail here instead, naming the square.
	const viewport = page.viewportSize();
	if (viewport && (point.y < 0 || point.y > viewport.height || point.x > viewport.width)) {
		throw new Error(
			`square ${square} is outside the ${viewport.width}x${viewport.height} viewport ` +
				`(at ${Math.round(point.x)},${Math.round(point.y)}) — a click there would be ` +
				'silently swallowed'
		);
	}
	return point;
}

/** A fingerprint of the board's rendered position, taken from chessground's
 * own DOM: one <piece> per occupied square, placed by a transform. Changes iff
 * the position changed. */
export async function boardPosition(page: Page): Promise<string> {
	return page.locator('cg-board').evaluate((board) =>
		[...board.querySelectorAll('piece')]
			.map(
				(piece) => `${(piece as HTMLElement).className}@${(piece as HTMLElement).style.transform}`
			)
			.sort()
			.join('|')
	);
}

/** Click-click move input: chessground selects on the first click and moves on
 * the second.
 *
 * The clicks are repeated until the board actually changes, and the helper
 * fails loudly if it never does. chessground drops pointer events while a move
 * animation is in flight, so a click issued right after a reload or an engine
 * reply can be swallowed; the rendered position changing is the only reliable
 * signal that the input was accepted, since nothing in the DOM announces
 * "ready for input".
 *
 * The old helper clicked once and moved on, so a swallowed click was
 * indistinguishable from a played move — which is how the refresh spec came to
 * assert on a knight move that never happened. (That one turned out to be the
 * viewport, see squareCenter; the point is that neither failure announced
 * itself.)
 */
export async function move(
	page: Page,
	from: string,
	to: string,
	orientation: 'white' | 'black' = 'white'
) {
	const before = await boardPosition(page);
	await moveUntil(page, from, to, orientation, async () => (await boardPosition(page)) !== before);
}

/** `move` for input whose acceptance shows up somewhere other than the board.
 *
 * A wrong puzzle move, for instance, is played and then snapped back, so the
 * rendered position ends up unchanged either way — "did the board change" and
 * "was the input accepted" are different questions there. The caller supplies
 * the signal that the click actually landed; without one, a dropped click
 * looks exactly like a rejected move and the test goes on to assert the retry
 * UI it never triggered.
 */
export async function moveUntil(
	page: Page,
	from: string,
	to: string,
	orientation: 'white' | 'black',
	accepted: () => Promise<boolean>,
	what = `${from}${to}`
) {
	await expect
		.poll(
			async () => {
				await clickSquares(page, from, to, orientation);
				return accepted();
			},
			{
				timeout: 15_000,
				message: `chessground never accepted ${what}: the board never registered the input`
			}
		)
		.toBe(true);
}

/** One pass of the same clicks, with no retry and no board-change assertion —
 * for input the board is meant to REJECT, or that opens a picker rather than
 * moving a piece (promotion). */
export async function clickSquares(
	page: Page,
	from: string,
	to: string,
	orientation: 'white' | 'black' = 'white'
) {
	for (const square of [from, to]) {
		const { x, y } = await squareCenter(page, square, orientation);
		await page.mouse.click(x, y);
	}
}

/** Scholar's mate — shortest deterministic full game (checkmate in 7 plies).
 * The same scripted game is used by the backend's test_analysis_job.py so
 * both suites exercise identical data. */
const scholarsMate = [
	['e2', 'e4', 'e4'],
	['e7', 'e5', 'e5'],
	['f1', 'c4', 'Bc4'],
	['b8', 'c6', 'Nc6'],
	['d1', 'h5', 'Qh5'],
	['g8', 'f6', 'Nf6'],
	['h5', 'f7', 'Qxf7#']
] as const;

export const scholarsMateSans = scholarsMate.map(([, , san]) => san);

/** 3.Qxe5+?? hangs the queen to 3...Nxe5 — the scripted tactics game shared
 * with the backend suite; analysis deterministically yields one personal
 * puzzle (punish the blunder: play Nxe5). */
export const hungQueenSans = ['e4', 'e5', 'Qh5', 'Nc6', 'Qxe5+', 'Nxe5'] as const;

/** The mirror of it — 3...Qh4?? hangs Black's queen to 4.Nxh4. Analyzed, this
 * game yields one puzzle too, and a distinct one: White to move rather than
 * Black, so a spec that needs a SECOND puzzle in the queue gets a position it
 * cannot confuse with the first. */
export const hangingQueenReplySans = ['e4', 'e5', 'Nf3', 'Qh4', 'Nxh4'] as const;

/** The hung-queen puzzle in full. Stated rather than computed: a spec that
 * derives its own "some legal move that isn't the solution" cannot say what
 * it is asserting, and picked a different move as the position or chess.js's
 * move ordering changed. Black is in check from the queen on e5 here, so the
 * wrong move has to be one of the few legal answers to it. */
export const HUNG_QUEEN = {
	fen: 'r1bqkbnr/pppp1ppp/2n5/4Q3/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 0 3',
	orientation: 'black' as const,
	motif: 'hanging_piece',
	solution: 'c6e5', // ...Nxe5 wins the queen that took on e5
	wrongMove: 'd8e7', // ...Qe7 blocks the check instead, and drops the queen
	wrongMoveSan: 'Qe7'
};

/** Seed a finished game through the live-game API (fast + deterministic)
 * and return its id. Completing it enqueues the analysis job. */
export async function seedGame(
	request: APIRequestContext,
	sans: readonly string[],
	result = '0-1'
): Promise<number> {
	const created = await request.post(`${API}/games`, { data: { mode: 'local' } });
	expect(created.ok()).toBe(true);
	const gameId = (await created.json()).id;
	for (const san of sans) {
		const response = await request.post(`${API}/games/${gameId}/moves`, { data: { san } });
		expect(response.ok()).toBe(true);
	}
	const completed = await request.post(`${API}/games/${gameId}/complete`, {
		data: { result }
	});
	expect(completed.ok()).toBe(true);
	return gameId;
}

/** The number the app shows a saved game under — the account's own count of
 * the games it has saved, which is what every screen labels it with. Read back
 * from the API rather than assumed to equal the row id: they only coincide
 * while one account has played every game in the database, which is exactly
 * the coincidence that hid the bug this replaced. */
export async function gameNumber(request: APIRequestContext, gameId: number): Promise<number> {
	const response = await request.get(`${API}/games/${gameId}`);
	expect(response.ok()).toBe(true);
	return (await response.json()).number;
}

/** Put a game in local storage before the app boots, as though the player had
 * left this position on the board — the way to reach a specific position
 * without playing it out against an unscriptable engine.
 *
 * The owner is looked up rather than written into the spec: the play store only
 * hands a saved game back to the player who saved it (an account id, or
 * `anonymous`), so a snapshot stamped with anything else is discarded and the
 * spec opens on an empty board instead. It is the account's id, not its
 * username, which is why this asks the server rather than assuming.
 */
export async function restoreActiveGame(page: Page, game: Record<string, unknown>) {
	const response = await page.request.get(`${API}/auth/session`);
	expect(response.ok()).toBe(true);
	const user = (await response.json()).user;
	await page.addInitScript(
		(saved) => localStorage.setItem('leechess.activeGame', JSON.stringify(saved)),
		{
			version: 2,
			owner: user ? user.id : 'anonymous',
			engineSkill: 5,
			playerColor: 'white',
			evals: [],
			badges: [],
			lastFeedback: null,
			currentEval: null,
			serverGameId: null,
			completedGameId: null,
			completedGameNumber: null,
			...game
		}
	);
}

/** The id of the server record the live game is syncing to, read off the saved
 * game rather than the screen: it is a row id, and the app deliberately shows
 * the player their own game number instead. Polls, because the record is
 * created by the first move's sync and the id is written down when it lands. */
export async function syncedGameId(page: Page): Promise<number> {
	let id: number | null = null;
	await expect
		.poll(
			async () => {
				id = await page.evaluate(() => {
					const raw = localStorage.getItem('leechess.activeGame');
					return raw ? (JSON.parse(raw).serverGameId as number | null) : null;
				});
				return id;
			},
			{ message: 'the live game never reached a server record' }
		)
		.not.toBeNull();
	return id!;
}

/** Poll until the server-side analysis job finishes for a game. */
export async function waitForAnalysis(request: APIRequestContext, gameId: number) {
	await expect
		.poll(
			async () => {
				const response = await request.get(`${API}/games/${gameId}/review`);
				return (await response.json()).analysis_status;
			},
			{ timeout: 60_000 }
		)
		.toBe('complete');
}

/** Seed and analyze the hung-queen game, then return the one puzzle it
 * produces.
 *
 * Every spec starts from an empty database and the generic Lichess pool is
 * never auto-seeded (see fixtures.ts and playwright.config.ts), so the queue
 * has exactly one candidate. The identity of that puzzle is asserted here
 * rather than taken on trust: specs that key off "whatever /puzzles/next
 * served" can silently end up exercising a different position — with a
 * different side to move — than the one they were written for.
 */
export async function seedHungQueenPuzzle(request: APIRequestContext) {
	const gameId = await seedGame(request, hungQueenSans);
	await waitForAnalysis(request, gameId);

	const puzzle = await (await request.get(`${API}/puzzles/next`)).json();
	expect(puzzle.source_move_id, 'expected the personal puzzle from the seeded game').not.toBeNull();
	expect(puzzle.fen).toBe(HUNG_QUEEN.fen);
	expect(puzzle.motif).toBe(HUNG_QUEEN.motif);
	expect(puzzle.solution).toEqual([HUNG_QUEEN.solution]);
	expect(puzzle.box).toBe(1);
	return { gameId, puzzle };
}

/** Add the second game, so the queue holds a puzzle beyond the hung-queen one
 * and "move on to the next puzzle" has somewhere to move on to. Returns the
 * id of the puzzle that is NOT the hung-queen one. */
export async function seedSecondPuzzle(
	request: APIRequestContext,
	firstPuzzleId: number
): Promise<number> {
	const gameId = await seedGame(request, hangingQueenReplySans, '1-0');
	await waitForAnalysis(request, gameId);

	const response = await request.get(`${API}/puzzles/${firstPuzzleId + 1}`);
	expect(response.ok(), 'the second seeded game must have produced one more puzzle').toBe(true);
	const puzzle = await response.json();
	expect(puzzle.fen, 'the two games must drill different positions').not.toBe(HUNG_QUEEN.fen);

	// ...and exactly one more: the queue holds two puzzles, so "the next
	// puzzle" is a statement about a known set rather than about leftovers.
	const beyond = await request.get(`${API}/puzzles/${firstPuzzleId + 2}`);
	expect(beyond.status()).toBe(404);
	return puzzle.id as number;
}

/** Collect console errors and uncaught exceptions from the page.
 *
 * The browser probes /favicon.ico by itself; the app never requests it and
 * there is nothing to serve, so the 404 is harness noise. Whether it reaches
 * the console at all depends on the Chromium build and on whether an earlier
 * test in the same browser already cached the miss — which made
 * "no console errors" pass in a full run and fail when the spec ran alone.
 */
export function consoleErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('console', (msg) => {
		const favicon =
			msg.location().url.endsWith('/favicon.ico') || msg.text().includes('favicon.ico');
		if (msg.type() === 'error' && !favicon) errors.push(msg.text());
	});
	page.on('pageerror', (error) => errors.push(error.message));
	return errors;
}

/** Wait for the client WASM engine to finish warming up — live-feedback
 * timing assertions only make sense once init cost is out of the way. */
export async function waitForEngineReady(page: Page) {
	await expect(page.getByTestId('engine-status')).toHaveText('ready', { timeout: 30_000 });
}
