<script lang="ts">
	import PageHeading from '$lib/components/PageHeading.svelte';
	import { listGames } from '$lib/api/client';
	import AccountGate from '$lib/components/AccountGate.svelte';
	import { gameOutcome, OUTCOME_LABELS, type GameOutcome } from '$lib/result';
	import { session } from '$lib/stores/session.svelte';
	import { resolve } from '$app/paths';

	// Not even asked for without an account: every game here belongs to one,
	// so the request could only ever come back 401.
	const gamesPromise = session.anonymous ? null : listGames();

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

<PageHeading eyebrow="The game archive" title="Your games" />

{#if gamesPromise === null}
	<AccountGate
		what="Every finished game, with a centipawn-loss graph, the motif you walked into and a written explanation of what each mistake cost."
	/>
{:else}
	{#await gamesPromise}
		<p class="text-muted">Loading games…</p>
	{:then games}
		{#if games.length === 0}
			<section class="study-panel max-w-2xl">
				<h2 class="section-title">Your first game is a beginning</h2>
				<p class="page-description">
					No games yet. Play a game, then return here to explore the moves and the lessons it
					leaves.
				</p>
				<a class="btn-primary mt-5" href={resolve('/')}>Play a game</a>
			</section>
		{:else}
			<div class="archive-scroll">
				<table class="archive-table" data-testid="games-list">
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
										{game.number}
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
			</div>
		{/if}
	{:catch error}
		<p class="text-err">Failed to load games: {error.message}</p>
	{/await}
{/if}
