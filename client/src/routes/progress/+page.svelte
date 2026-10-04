<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getProgress, type ProgressSummary } from '$lib/api/client';
	import { isMistakeCause, MISTAKE_CAUSES } from '$lib/mistakes';
	import { humanizeMotif } from '$lib/motifs';
	import AccountGate from '$lib/components/AccountGate.svelte';
	import CplTrend from '$lib/components/CplTrend.svelte';
	import { session } from '$lib/stores/session.svelte';

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
		// Progress is a history, and an anonymous player is not keeping one —
		// there is nothing to ask the server for.
		if (session.anonymous) return;
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
		progress !== null &&
			progress.motifs.length === 0 &&
			progress.cpl_trend.length === 0 &&
			progress.drills_passed === 0 &&
			progress.thinking.moments === 0
	);

	// Which step of the thinking routine broke, most common first. The bars
	// are scaled to the biggest count so the leader always fills its row.
	const causes = $derived(
		(progress?.mistake_causes ?? [])
			.filter((entry) => isMistakeCause(entry.cause))
			.map((entry) => ({
				...entry,
				total: entry.mistakes + entry.blunders,
				copy: MISTAKE_CAUSES[entry.cause as keyof typeof MISTAKE_CAUSES]
			}))
	);
	const causeTotal = $derived(causes.reduce((sum, entry) => sum + entry.total, 0));
	const leadingCause = $derived(causes[0]?.total ? causes[0] : null);

	function percent(rate: number): string {
		return `${Math.round(rate * 100)}%`;
	}
</script>

<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
	<h1 class="font-display text-2xl">Progress</h1>
	<!-- Nothing to window over without an account, and a picker that changes
	     nothing reads as a broken control rather than a locked one. -->
	{#if !session.anonymous}
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
	{/if}
</div>

{#if session.anonymous}
	<AccountGate
		what="Success rate per motif over 30 days, 90 days or all time, your weakest patterns called out with a link straight to a drill, and a day streak."
	/>
{:else if error}
	<p class="text-sm break-all text-err">Failed to load progress: {error}</p>
{:else if !progress}
	<p class="text-sm text-muted">Loading progress…</p>
{:else if empty}
	<div class="max-w-xl rounded-xs border border-line bg-card p-4 text-sm text-muted">
		<p class="font-semibold text-ink">Nothing to chart yet.</p>
		<p class="mt-1">
			Play a game — analysis feeds the CPL trend, and solving the puzzles it queues builds your
			motif stats. The
			<a class="text-accent underline" href={resolve('/endgames')}>Endgames</a>
			drills need no game history and are ready now.
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
		<a
			href={resolve('/endgames')}
			data-testid="drills-passed"
			class="rounded-xs border border-line bg-card px-4 py-3 hover:border-accent"
		>
			<p class="font-display text-3xl font-bold tabular-nums">{progress.drills_passed}</p>
			<p class="text-xs text-muted">endgames drilled</p>
		</a>
	</div>

	{#if leadingCause}
		<section class="mb-6" data-testid="mistake-causes">
			<h2 class="mb-2 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
				Why your mistakes happen
			</h2>
			<div class="rounded-xs border border-line bg-card p-3">
				<p class="text-sm text-ink" data-testid="mistake-causes-headline">
					<span class="font-semibold">
						{leadingCause.total} of your {causeTotal}
						{causeTotal === 1 ? 'mistake' : 'mistakes and blunders'}:
						{leadingCause.copy.label.toLowerCase()}.
					</span>
					{leadingCause.copy.what}
				</p>
				<p class="mt-1 text-sm text-body" data-testid="mistake-causes-habit">
					<span class="font-semibold text-accent">Practise:</span>
					{leadingCause.copy.habit}
				</p>
				<div class="mt-3" role="list" aria-label="Mistakes and blunders by cause">
					{#each causes as entry (entry.cause)}
						<div
							class="grid grid-cols-[10.5rem_1fr_auto] items-center gap-2 py-1 text-sm"
							role="listitem"
							data-testid="mistake-cause-row"
							data-cause={entry.cause}
						>
							<span class="truncate {entry.total ? 'text-body' : 'text-faint'}">
								{entry.copy.label}
							</span>
							<div class="h-2.5 overflow-hidden bg-line/60">
								<div
									class="h-full bg-err"
									style="width:{(entry.blunders / causes[0].total) * 100}%;float:left"
								></div>
								<div
									class="h-full bg-mist"
									style="width:{(entry.mistakes / causes[0].total) * 100}%;float:left"
								></div>
							</div>
							<span class="text-right text-xs text-muted tabular-nums">
								{#if entry.total && entry.latest}
									{entry.total}
									·
									<a
										class="text-accent hover:underline"
										data-testid="mistake-cause-example"
										href="{resolve('/review/[gameId]', {
											gameId: String(entry.latest.game_id)
										})}?ply={entry.latest.ply}"
										title="Open the latest one in Review"
									>
										{Math.ceil(entry.latest.ply / 2)}{entry.latest.ply % 2 ? '.' : '…'}{entry.latest
											.san}
									</a>
								{:else}
									0
								{/if}
							</span>
						</div>
					{/each}
				</div>
				<p class="mt-2 flex gap-3 text-xs text-muted">
					<span><span class="mr-1 inline-block h-2 w-2 bg-err"></span>blunders</span>
					<span><span class="mr-1 inline-block h-2 w-2 bg-mist"></span>mistakes</span>
				</p>
			</div>
		</section>
	{/if}

	{#if progress.thinking.moments > 0}
		{@const thinking = progress.thinking}
		<!-- Think first: the thinking at critical moments, not the moves. -->
		<section class="mb-6" data-testid="thinking">
			<h2 class="mb-2 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
				Thinking at critical moments
			</h2>
			<div class="rounded-xs border border-line bg-card p-3 text-sm">
				<p class="text-ink" data-testid="thinking-found">
					<span class="font-semibold"
						>{thinking.found} of {thinking.moments}
						{thinking.moments === 1 ? 'critical moment' : 'critical moments'}:</span
					>
					a move as good as the engine’s was on your list of candidates.
				</p>
				{#if thinking.threats > 0}
					<p class="mt-1 text-body" data-testid="thinking-threats">
						When their last move threatened something, one of your candidates dealt with it
						{thinking.answered} of {thinking.threats} times.
					</p>
				{/if}
				<div
					class="mt-2 flex items-center gap-1"
					aria-label="Latest critical moments, oldest first"
				>
					<span class="mr-1 text-xs text-muted">Latest:</span>
					{#each thinking.recent as found, i (i)}
						<span
							class="inline-block h-2.5 w-2.5 rounded-full {found ? 'bg-ok' : 'bg-err'}"
							title={found ? 'found' : 'missed'}
							data-testid="thinking-dot"
						></span>
					{/each}
				</div>
				<p class="mt-2 text-xs text-muted">
					Critical moments come up on Play in Nudge and Full, with “Think first” on in Settings.
				</p>
			</div>
		</section>
	{/if}

	{#if progress.repertoire.length > 0}
		<!-- Your openings: how each one goes, and where you leave known theory —
		     the move to look up before the next game in it. -->
		<section class="mb-6" data-testid="repertoire">
			<h2 class="mb-2 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
				Your openings
			</h2>
			<div class="overflow-x-auto rounded-xs border border-line bg-card">
				<table class="w-full text-left text-sm">
					<thead class="text-xs text-muted">
						<tr class="border-b border-line">
							<th class="px-3 py-1.5 font-normal">Opening</th>
							<th class="px-2 py-1.5 font-normal">You</th>
							<th class="px-2 py-1.5 font-normal">Games</th>
							<th class="px-2 py-1.5 font-normal">W–D–L</th>
							<th class="px-3 py-1.5 font-normal">Where you leave the book</th>
						</tr>
					</thead>
					<tbody>
						{#each progress.repertoire as line (`${line.color}-${line.family}`)}
							<tr class="border-b border-line last:border-0" data-testid="repertoire-line">
								<td class="px-3 py-1.5">
									<span class="mr-1 font-mono text-xs text-accent">{line.eco}</span>
									<a
										class="text-ink hover:underline"
										href={resolve('/review/[gameId]', { gameId: String(line.latest_game_id) })}
										title="Your latest game in it">{line.family}</a
									>
								</td>
								<td class="px-2 py-1.5 capitalize">{line.color}</td>
								<td class="px-2 py-1.5 tabular-nums">{line.games}</td>
								<td class="px-2 py-1.5 tabular-nums">{line.wins}–{line.draws}–{line.losses}</td>
								<td class="px-3 py-1.5" data-testid="repertoire-exit">
									{#if line.exit}
										<span class="font-mono font-semibold"
											>{Math.ceil(line.exit.ply / 2)}{line.exit.ply % 2 ? '.' : '…'}{line.exit
												.san}</span
										>
										{line.exit.times > 1 ? `(${line.exit.times}×)` : ''}
										{#if line.exit.book_moves.length > 0}
											<span class="text-muted">— book: {line.exit.book_moves.join(', ')}</span>
										{/if}
									{:else}
										<span class="text-faint">your opponent left it first</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

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

		<!-- The trend is one point per analyzed game with no server-side cap, so it
		     takes the full row: at half width a few hundred games collapse into a
		     vertical smear. min-w-0 lets the grid child shrink to its column so the
		     chart can measure a real width. -->
		<section class="min-w-0 lg:col-span-2">
			<h2 class="mb-2 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
				CPL per game (lower is better)
			</h2>
			<CplTrend
				trend={progress.cpl_trend}
				onselect={(gameId) => goto(resolve('/review/[gameId]', { gameId: String(gameId) }))}
			/>
			<p class="mt-2 text-sm text-muted">
				The endgame line is the one you can train directly — the
				<a class="text-accent underline" href={resolve('/endgames')}>Endgames</a>
				screen drills the techniques it measures against full-strength Stockfish.
			</p>
		</section>
	</div>
{/if}
