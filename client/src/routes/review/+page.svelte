<script lang="ts">
	import { listGames } from '$lib/api/client';
	import { gameOutcome, OUTCOME_LABELS, type GameOutcome } from '$lib/result';
	import { resolve } from '$app/paths';

	const gamesPromise = listGames();

	const statusStyles: Record<string, string> = {
		complete: 'text-ok',
		analyzing: 'text-info',
		failed: 'text-err',
		pending: 'text-faint'
	};

	const outcomeStyles: Record<GameOutcome, string> = {
		win: 'text-ok',
		loss: 'text-err',
		draw: 'text-muted'
	};
</script>

<h1 class="mb-4 font-display text-2xl">Your games</h1>

{#await gamesPromise}
	<p class="text-muted">Loading games…</p>
{:then games}
	{#if games.length === 0}
		<p class="text-muted">
			No games yet — <a class="underline" href={resolve('/')}>play one</a>.
		</p>
	{:else}
		<table class="w-full max-w-2xl text-sm" data-testid="games-list">
			<thead>
				<tr class="text-left text-muted">
					<th class="py-1.5 font-normal">#</th>
					<th class="py-1.5 font-normal">Players</th>
					<th class="py-1.5 font-normal">Result</th>
					<th class="py-1.5 font-normal">Mode</th>
					<th class="py-1.5 font-normal">Played</th>
					<th class="py-1.5 font-normal">Analysis</th>
				</tr>
			</thead>
			<tbody>
				{#each games as game (game.id)}
					{@const outcome = gameOutcome(game.result, game.user_color)}
					<tr class="border-t border-line hover:bg-card">
						<td class="py-1.5">
							<a
								class="font-semibold text-accent underline"
								href={resolve('/review/[gameId]', { gameId: String(game.id) })}
							>
								{game.id}
							</a>
						</td>
						<td class="py-1.5">{game.white} vs {game.black}</td>
						<td class="py-1.5 font-semibold {outcome ? outcomeStyles[outcome] : ''}">
							{outcome ? OUTCOME_LABELS[outcome] : game.result}
						</td>
						<td class="py-1.5">{game.mode}</td>
						<td class="py-1.5">{new Date(game.created_at + 'Z').toLocaleString()}</td>
						<td class="py-1.5 {statusStyles[game.analysis_status] ?? ''}">
							{game.analysis_status}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
{:catch error}
	<p class="text-err">Failed to load games: {error.message}</p>
{/await}
