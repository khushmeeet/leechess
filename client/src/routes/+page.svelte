<script lang="ts">
	import Board from '$lib/components/Board.svelte';
	import HintLadder from '$lib/components/HintLadder.svelte';
	import { GameStore } from '$lib/stores/game.svelte';
	import { stockfish, type EngineEval } from '$lib/stores/stockfish';
	import { createGame } from '$lib/api/client';
	import { resolve } from '$app/paths';
	import type { Key } from 'chessground/types';

	const game = new GameStore();

	// Level 0 nudge: dismissable, re-shown after every move (in local
	// pass-and-play "opponent's move" is simply the previous move).
	let nudgeVisible = $state(true);

	function handleMove(orig: Key, dest: Key) {
		if (game.tryMove(orig, dest)) nudgeVisible = true;
	}

	// --- submit to backend ---
	let submitting = $state(false);
	let savedGameId = $state<number | null>(null);
	let submitError = $state<string | null>(null);

	async function submitGame() {
		submitting = true;
		submitError = null;
		try {
			const saved = await createGame(game.pgn());
			savedGameId = saved.id;
		} catch (error) {
			submitError = error instanceof Error ? error.message : String(error);
		} finally {
			submitting = false;
		}
	}

	function newGame() {
		game.reset();
		nudgeVisible = true;
		savedGameId = null;
		submitError = null;
		evalResult = null;
	}

	// --- engine check (Phase 0 plumbing verification) ---
	let evalResult = $state<EngineEval | null>(null);
	let evalRunning = $state(false);
	let evalError = $state<string | null>(null);

	async function runEval() {
		evalRunning = true;
		evalError = null;
		try {
			evalResult = await stockfish.evaluate(game.fen, 16);
		} catch (error) {
			evalError = error instanceof Error ? error.message : String(error);
		} finally {
			evalRunning = false;
		}
	}

	function formatScore(result: EngineEval): string {
		if (result.mate !== undefined) return `#${result.mate}`;
		return ((result.cp ?? 0) / 100).toFixed(2);
	}

	const movePairs = $derived.by(() => {
		const pairs: { number: number; white: string; black?: string }[] = [];
		for (let i = 0; i < game.moves.length; i += 2) {
			pairs.push({
				number: i / 2 + 1,
				white: game.moves[i].san,
				black: game.moves[i + 1]?.san
			});
		}
		return pairs;
	});
</script>

<div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
	<div class="max-w-xl">
		<Board
			fen={game.fen}
			turnColor={game.turnColor}
			dests={game.dests}
			lastMove={game.lastMove}
			onmove={handleMove}
		/>
	</div>

	<aside class="flex flex-col gap-4">
		<HintLadder {nudgeVisible} ondismiss={() => (nudgeVisible = false)} />

		<section class="rounded-md border border-stone-300 bg-white p-3">
			<h2 class="mb-2 text-sm font-semibold text-stone-700">
				Moves
				<span class="ml-1 font-normal text-stone-400">({game.turnColor} to move)</span>
			</h2>
			{#if movePairs.length === 0}
				<p class="text-sm text-stone-400">No moves yet.</p>
			{:else}
				<ol class="max-h-64 overflow-y-auto text-sm" data-testid="move-list">
					{#each movePairs as pair (pair.number)}
						<li class="grid grid-cols-[2rem_1fr_1fr] gap-1 py-0.5">
							<span class="text-stone-400">{pair.number}.</span>
							<span>{pair.white}</span>
							<span>{pair.black ?? ''}</span>
						</li>
					{/each}
				</ol>
			{/if}
			{#if game.isGameOver}
				<p class="mt-2 text-sm font-semibold">Game over: {game.result}</p>
			{/if}
		</section>

		<section class="flex flex-col gap-2">
			<button
				onclick={submitGame}
				disabled={submitting || game.moves.length === 0 || savedGameId !== null}
				class="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-40"
			>
				{submitting ? 'Saving…' : 'Save game to server'}
			</button>
			{#if savedGameId !== null}
				<p class="text-sm text-green-700">
					Saved as game #{savedGameId} —
					<a class="underline" href={resolve('/review/[gameId]', { gameId: String(savedGameId) })}>
						open review
					</a>
				</p>
			{/if}
			{#if submitError}
				<p class="text-sm break-all text-red-700">{submitError}</p>
			{/if}
			<button
				onclick={newGame}
				class="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50"
			>
				New game
			</button>
		</section>

		<section class="rounded-md border border-stone-300 bg-white p-3 text-sm">
			<h2 class="mb-2 font-semibold text-stone-700">Engine check</h2>
			<button
				onclick={runEval}
				disabled={evalRunning}
				class="rounded-md border border-stone-300 px-3 py-1.5 hover:bg-stone-50 disabled:opacity-40"
			>
				{evalRunning ? 'Evaluating…' : 'Eval position (depth 16)'}
			</button>
			{#if evalResult}
				<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-stone-600">
					<dt>Score</dt>
					<dd class="font-mono">{formatScore(evalResult)}</dd>
					<dt>Best</dt>
					<dd class="font-mono">{evalResult.bestMove}</dd>
					<dt>Depth</dt>
					<dd class="font-mono">{evalResult.depth}</dd>
					<dt>Time</dt>
					<dd class="font-mono" class:text-red-600={evalResult.ms >= 1000}>
						{evalResult.ms}ms
					</dd>
					<dt>Engine</dt>
					<dd class="font-mono">{stockfish.flavor}</dd>
				</dl>
			{/if}
			{#if evalError}
				<p class="mt-2 break-all text-red-700">{evalError}</p>
			{/if}
			<p class="mt-2 text-xs text-stone-400">
				crossOriginIsolated: <span class="font-mono">{String(crossOriginIsolated)}</span>
			</p>
		</section>
	</aside>
</div>
