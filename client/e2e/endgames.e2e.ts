import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { Chess } from 'chess.js';
import { API, move } from './helpers';

// Endgame drills: played out against the WASM engine rather than matched
// against a stored line, so these tests never assert a move sequence — they
// read the live position off the board and drive it to a result.

// The drill board sits below a metadata header; at the default 720px height
// its back rank falls outside the viewport and coordinate clicks there land
// on nothing (mouse.click doesn't scroll).
test.use({ viewport: { width: 1280, height: 1000 } });

async function nextDrill(request: APIRequestContext, family?: string) {
	const suffix = family ? `?family=${family}` : '';
	const response = await request.get(`${API}/endgames/next${suffix}`);
	expect(response.ok()).toBe(true);
	return response.json();
}

async function drillDetail(request: APIRequestContext, drillId: number) {
	return (await request.get(`${API}/endgames/${drillId}`)).json();
}

function boardFen(page: Page): Promise<string> {
	return page.getByTestId('drill-board').getAttribute('data-fen') as Promise<string>;
}

test('the drill screen serves a due drill with its goal and side', async ({ page, request }) => {
	const drill = await nextDrill(request);

	await page.goto('/endgames');
	await expect(page.getByTestId('drill-heading')).toHaveText(drill.name);
	await expect(page.getByTestId('drill-goal')).toHaveText(
		drill.goal === 'win' ? 'Convert the win' : 'Hold the draw'
	);
	await expect(page.getByTestId('drill-side')).toContainText(drill.player_color);
	await expect(page.getByTestId('drill-board')).toHaveAttribute('data-fen', drill.fen);
});

test('playing a drill out to a result records the attempt', async ({ page, request }) => {
	// Philidor first: the user defends, so aimless play loses quickly (white
	// queens) instead of grinding into the 60-move cap a botched win drill hits.
	const drill = await nextDrill(request, 'philidor');
	const before = (await drillDetail(request, drill.id)).attempts.length;

	await page.goto('/endgames?family=philidor');
	await expect(page.getByTestId('drill-heading')).toHaveText(drill.name);

	const banner = page.getByTestId('drill-success').or(page.getByTestId('drill-failed'));
	const playerColor: 'white' | 'black' = drill.player_color;
	const playerTurn = playerColor === 'white' ? 'w' : 'b';

	// Play legal moves until the drill resolves. The engine is at full
	// strength and the moves below are not, so this reliably ends in a
	// verdict — which one is the engine's business, not the test's.
	for (let i = 0; i < 80 && !(await banner.isVisible()); i++) {
		const fen = await boardFen(page);
		const chess = new Chess(fen);
		if (chess.turn() !== playerTurn) {
			await page.waitForTimeout(200); // engine is thinking
			continue;
		}
		const [next] = chess.moves({ verbose: true });
		if (!next) break;
		await move(page, next.from, next.to, playerColor);
		// the move only lands once the board reflects it
		await expect.poll(() => boardFen(page)).not.toBe(fen);
	}

	await expect(banner).toBeVisible({ timeout: 60_000 });

	await expect
		.poll(async () => (await drillDetail(request, drill.id)).attempts.length)
		.toBe(before + 1);
	const detail = await drillDetail(request, drill.id);
	const attempt = detail.attempts.at(-1);
	const succeeded = await page.getByTestId('drill-success').isVisible();
	expect(attempt.success).toBe(succeeded);
	expect(attempt.outcome).toBeTruthy();
	// Leitner: a held draw moves up a box, a broken one resets to 1
	expect(detail.box).toBe(succeeded ? drill.box + 1 : 1);
});
