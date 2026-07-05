<script lang="ts">
	import { page } from '$app/state';
	import { getGame, type GameDetail } from '$lib/api/client';

	// Phase 0: raw stored moves straight from SQLite, proving the round trip.
	// Phase 1 adds the board, CPL graph, classifications and click-to-jump.
	let gamePromise = $derived(getGame(page.params.gameId!));

	function moveRows(game: GameDetail) {
		const rows: { number: number; white: string; black?: string }[] = [];
		for (let i = 0; i < game.moves.length; i += 2) {
			rows.push({
				number: i / 2 + 1,
				white: game.moves[i].san,
				black: game.moves[i + 1]?.san
			});
		}
		return rows;
	}
</script>

{#await gamePromise}
	<p class="text-stone-500">Loading game…</p>
{:then game}
	<h1 class="mb-1 text-lg font-semibold">Game #{game.id}</h1>
	<p class="mb-4 text-sm text-stone-500">
		{game.white} vs {game.black} · {game.result} · analysis: {game.analysis_status}
	</p>
	<div class="max-w-md rounded-md border border-stone-300 bg-white p-3">
		<h2 class="mb-2 text-sm font-semibold text-stone-700">Moves ({game.moves.length} plies)</h2>
		<ol class="text-sm">
			{#each moveRows(game) as row (row.number)}
				<li class="grid grid-cols-[2rem_1fr_1fr] gap-1 py-0.5">
					<span class="text-stone-400">{row.number}.</span>
					<span>{row.white}</span>
					<span>{row.black ?? ''}</span>
				</li>
			{/each}
		</ol>
	</div>
{:catch error}
	<p class="text-red-700">Failed to load game: {error.message}</p>
{/await}
