<script lang="ts">
	import { onMount } from 'svelte';
	import Board from '$lib/components/Board.svelte';
	import ClassificationBadge from '$lib/components/ClassificationBadge.svelte';
	import EvalBar from '$lib/components/EvalBar.svelte';
	import HintLadder from '$lib/components/HintLadder.svelte';
	import { PlaySession } from '$lib/stores/play.svelte';
	import { resolve } from '$app/paths';

	const session = new PlaySession();
	const game = session.game;

	onMount(() => {
		session.start().catch((error) => console.error('engine warmup failed:', error));
	});

	const strengthPresets = [
		{ skill: 1, label: 'Beginner' },
		{ skill: 3, label: 'Casual' },
		{ skill: 5, label: 'Club' },
		{ skill: 10, label: 'Strong' },
		{ skill: 20, label: 'Max' }
	];

	const movableColor = $derived.by(() => {
		if (game.isGameOver) return undefined;
		return session.mode === 'engine' ? session.playerColor : ('both' as const);
	});

	const movePairs = $derived.by(() => {
		const pairs: {
			number: number;
			white: { san: string; ply: number };
			black?: { san: string; ply: number };
		}[] = [];
		for (let i = 0; i < game.moves.length; i += 2) {
			pairs.push({
				number: i / 2 + 1,
				white: { san: game.moves[i].san, ply: i + 1 },
				black: game.moves[i + 1] ? { san: game.moves[i + 1].san, ply: i + 2 } : undefined
			});
		}
		return pairs;
	});
</script>

<div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
	<div class="flex max-w-xl gap-2">
		{#if session.showEvalBar}
			<EvalBar cp={session.currentEval} />
		{/if}
		<div class="min-w-0 flex-1">
			<Board
				fen={game.fen}
				turnColor={game.turnColor}
				dests={game.dests}
				lastMove={game.lastMove}
				{movableColor}
				onmove={(orig, dest) => session.handleBoardMove(orig, dest)}
			/>
		</div>
	</div>

	<aside class="flex flex-col gap-4">
		<section class="rounded-md border border-stone-300 bg-white p-3 text-sm">
			<div class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
				<label for="mode" class="text-stone-600">Mode</label>
				<select
					id="mode"
					bind:value={session.mode}
					disabled={session.started}
					class="rounded border border-stone-300 px-2 py-1 disabled:opacity-50"
				>
					<option value="local">Local (pass &amp; play)</option>
					<option value="engine">vs Stockfish</option>
				</select>

				{#if session.mode === 'engine'}
					<label for="strength" class="text-stone-600">Strength</label>
					<select
						id="strength"
						bind:value={session.engineSkill}
						disabled={session.started}
						class="rounded border border-stone-300 px-2 py-1 disabled:opacity-50"
					>
						{#each strengthPresets as preset (preset.skill)}
							<option value={preset.skill}>{preset.label} (skill {preset.skill})</option>
						{/each}
					</select>
				{/if}

				<label for="hints" class="text-stone-600">Hints</label>
				<select
					id="hints"
					bind:value={session.hints}
					disabled={session.started}
					class="rounded border border-stone-300 px-2 py-1 disabled:opacity-50"
				>
					<option value="nudge">Nudge only</option>
					<option value="off">Off (real game)</option>
				</select>

				<label for="evalbar" class="text-stone-600">Eval bar</label>
				<input id="evalbar" type="checkbox" bind:checked={session.showEvalBar} class="h-4 w-4" />
			</div>
			<p class="mt-2 text-xs text-stone-400">
				engine:
				<span data-testid="engine-status" class="font-mono">
					{session.engineReady ? 'ready' : 'warming up…'}
				</span>
				{#if session.mode === 'engine'}· you play White{/if}
			</p>
		</section>

		{#if session.hints !== 'off'}
			<HintLadder
				nudgeVisible={session.nudgeVisible}
				ondismiss={() => (session.nudgeVisible = false)}
			/>
		{/if}

		{#if session.lastFeedback}
			<div class="flex items-center gap-2 text-sm" data-testid="move-badge">
				<span class="font-mono text-stone-600">
					{Math.ceil(session.lastFeedback.ply / 2)}{session.lastFeedback.ply % 2 ? '.' : '…'}
					{session.lastFeedback.san}
				</span>
				<ClassificationBadge classification={session.lastFeedback.classification} />
			</div>
		{/if}

		<section class="rounded-md border border-stone-300 bg-white p-3">
			<h2 class="mb-2 text-sm font-semibold text-stone-700">
				Moves
				<span class="ml-1 font-normal text-stone-400">
					({session.engineThinking ? 'Stockfish thinking…' : `${game.turnColor} to move`})
				</span>
			</h2>
			{#if movePairs.length === 0}
				<p class="text-sm text-stone-400">No moves yet.</p>
			{:else}
				<ol class="max-h-64 overflow-y-auto text-sm" data-testid="move-list">
					{#each movePairs as pair (pair.number)}
						<li class="grid grid-cols-[2rem_1fr_1fr] gap-1 py-0.5">
							<span class="text-stone-400">{pair.number}.</span>
							{#each [pair.white, pair.black] as half, i (i)}
								<span class="flex items-center gap-1.5">
									{#if half}
										{half.san}
										{#if session.badges[half.ply - 1]}
											<ClassificationBadge classification={session.badges[half.ply - 1]!} compact />
										{/if}
									{/if}
								</span>
							{/each}
						</li>
					{/each}
				</ol>
			{/if}
			{#if game.isGameOver}
				<p class="mt-2 text-sm font-semibold">Game over: {game.result}</p>
			{/if}
		</section>

		<section class="flex flex-col gap-2">
			{#if !game.isGameOver && session.started}
				<div class="flex gap-2">
					<button
						onclick={() => session.resign()}
						class="flex-1 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50"
					>
						Resign
					</button>
					{#if session.mode === 'local'}
						<button
							onclick={() => session.agreeDraw()}
							class="flex-1 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50"
						>
							Draw
						</button>
					{/if}
				</div>
			{/if}
			<button
				onclick={() => session.newGame()}
				class="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50"
			>
				New game
			</button>

			{#if session.completedGameId !== null}
				<p class="text-sm text-green-700">
					Saved as game #{session.completedGameId}, analysis queued —
					<a
						class="underline"
						href={resolve('/review/[gameId]', { gameId: String(session.completedGameId) })}
					>
						open review
					</a>
				</p>
			{:else if session.serverGameId !== null && !session.serverError}
				<p class="text-xs text-stone-400">syncing to server as game #{session.serverGameId}</p>
			{/if}
			{#if session.serverError}
				<p class="text-sm break-all text-red-700">
					Server sync failed — the game continues locally. {session.serverError}
				</p>
			{/if}
		</section>
	</aside>
</div>
