<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getProgress, type ProgressSummary } from '$lib/api/client';
	import { humanizeMotif } from '$lib/motifs';
	import CplTrend from '$lib/components/CplTrend.svelte';

	const windows = [
		{ days: 30, label: '30 days' },
		{ days: 90, label: '90 days' },
		{ days: null, label: 'All time' }
	] as const;

	let days = $state<number | null>(null);
	let progress = $state<ProgressSummary | null>(null);
	let error = $state<string | null>(null);

	$effect(() => {
		const requested = days;
		let cancelled = false;
		getProgress(requested)
			.then((fetched) => {
				if (cancelled) return;
				progress = fetched;
				error = null;
			})
			.catch((e) => {
				if (!cancelled) error = e instanceof Error ? e.message : String(e);
			});
		return () => {
			cancelled = true;
		};
	});

	const empty = $derived(
		progress !== null && progress.motifs.length === 0 && progress.cpl_trend.length === 0
	);

	function percent(rate: number): string {
		return `${Math.round(rate * 100)}%`;
	}
</script>

<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
	<h1 class="font-display text-2xl">Progress</h1>
	<div
		class="flex rounded-xs border border-line bg-card text-sm"
		role="group"
		aria-label="Time window"
	>
		{#each windows as window (window.label)}
			<button
				onclick={() => (days = window.days)}
				aria-pressed={days === window.days}
				class="px-3 py-1 first:rounded-l-xs last:rounded-r-xs {days === window.days
					? 'bg-ink font-semibold text-paper'
					: 'text-muted hover:bg-paper'}"
			>
				{window.label}
			</button>
		{/each}
	</div>
</div>

{#if error}
	<p class="text-sm break-all text-err">Failed to load progress: {error}</p>
{:else if !progress}
	<p class="text-sm text-muted">Loading progress…</p>
{:else if empty}
	<div class="max-w-xl rounded-xs border border-line bg-card p-4 text-sm text-muted">
		<p class="font-semibold text-ink">Nothing to chart yet.</p>
		<p class="mt-1">
			Play a game — analysis feeds the CPL trend, and solving the puzzles it queues builds your
			motif stats.
		</p>
	</div>
{:else}
	<!-- streaks: stat tiles, not charts -->
	<div class="mb-6 flex flex-wrap gap-3" data-testid="streaks">
		<div class="rounded-xs border border-line bg-card px-4 py-3">
			<p class="font-display text-3xl font-bold tabular-nums">{progress.streak_days}</p>
			<p class="text-xs text-muted">day streak</p>
		</div>
		<div class="rounded-xs border border-line bg-card px-4 py-3">
			<p class="font-display text-3xl font-bold tabular-nums">{progress.puzzles_solved}</p>
			<p class="text-xs text-muted">puzzles solved</p>
		</div>
	</div>

	{#if progress.weakest_motifs.length > 0}
		<section class="mb-6" data-testid="weakest-motifs">
			<h2 class="mb-2 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
				Weakest motifs — drill these
			</h2>
			<div class="flex flex-wrap gap-3">
				{#each progress.weakest_motifs as stat (stat.motif)}
					<a
						href="{resolve('/puzzles')}?motif={encodeURIComponent(stat.motif)}"
						data-testid="weakest-motif-link"
						class="group rounded-xs border border-accent-line bg-accent-soft px-4 py-3 hover:border-accent"
					>
						<p class="font-semibold text-accent capitalize">{humanizeMotif(stat.motif)}</p>
						<p class="mt-0.5 text-xs text-accent">
							{percent(stat.success_rate)} over {stat.attempts} attempts
							<span class="ml-1 font-semibold group-hover:underline">drill →</span>
						</p>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	<div class="grid gap-6 lg:grid-cols-2">
		<section>
			<h2 class="mb-2 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
				Success rate by motif
			</h2>
			{#if progress.motifs.length === 0}
				<p class="text-sm text-muted">
					No puzzle attempts{days ? ' in this window' : ''} yet — solve a few on the
					<a class="text-accent underline" href={resolve('/puzzles')}>Puzzles</a> screen.
				</p>
			{:else}
				<div
					class="rounded-xs border border-line bg-card p-3"
					data-testid="motif-chart"
					role="img"
					aria-label="Puzzle success rate per motif"
				>
					{#each progress.motifs as stat (stat.motif)}
						<div class="grid grid-cols-[7.5rem_1fr_5rem] items-center gap-2 py-1 text-sm">
							<a
								class="truncate text-body capitalize hover:underline"
								href="{resolve('/puzzles')}?motif={encodeURIComponent(stat.motif)}"
								title="drill {humanizeMotif(stat.motif)}"
							>
								{humanizeMotif(stat.motif)}
							</a>
							<div class="h-2.5 overflow-hidden bg-line/60">
								<div
									class="h-full bg-accent"
									style="width:{Math.max(1, stat.success_rate * 100)}%"
								></div>
							</div>
							<span class="text-right text-xs text-muted tabular-nums">
								{stat.correct}/{stat.attempts} · {percent(stat.success_rate)}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<section>
			<h2 class="mb-2 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
				CPL per game (lower is better)
			</h2>
			<CplTrend
				trend={progress.cpl_trend}
				onselect={(gameId) => goto(resolve('/review/[gameId]', { gameId: String(gameId) }))}
			/>
		</section>
	</div>
{/if}
