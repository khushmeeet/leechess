<script lang="ts">
	import { resolve } from '$app/paths';
	import type { MotifTrend, Tries } from '$lib/api/client';
	import { humanizeMotif } from '$lib/motifs';

	/** Is the player getting better at each motif? One row per motif: its
	 * first tries in the window (hollow dot) against its latest (filled dot)
	 * on one 0–100% track — a dumbbell, so the direction of the line is the
	 * answer. Numbers sit beside each row, so nothing rests on the marks. */
	let { trends }: { trends: MotifTrend[] } = $props();

	function rate(tries: Tries): number {
		return tries.attempts === 0 ? 0 : (tries.correct / tries.attempts) * 100;
	}

	function describe(trend: MotifTrend): string {
		const half = (label: string, tries: Tries) =>
			`${label} ${tries.attempts} tries: ${tries.correct} solved (${Math.round(rate(tries))}%)`;
		return `${half('First', trend.earlier)}. ${half('Latest', trend.recent)}.`;
	}

	const rows = $derived(
		trends.map((trend) => {
			const before = rate(trend.earlier);
			const after = rate(trend.recent);
			return {
				trend,
				before,
				after,
				change: Math.round(after) - Math.round(before),
				text: describe(trend)
			};
		})
	);
</script>

<div class="rounded-xs border border-line bg-card p-3" data-testid="motif-trends">
	<!-- two marks per row: a legend, with the shapes themselves as the key -->
	<p class="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-hidden="true">
		<span class="inline-flex items-center gap-1.5">
			<span class="inline-block h-2.5 w-2.5 rounded-full border-2 border-accent bg-card"></span>
			first tries
		</span>
		<span class="inline-flex items-center gap-1.5">
			<span class="inline-block h-2.5 w-2.5 rounded-full bg-accent"></span>
			latest tries
		</span>
	</p>
	<ul>
		{#each rows as row (row.trend.motif)}
			<li
				class="grid grid-cols-[7.5rem_1fr_6.5rem] items-center gap-2 py-1 text-sm"
				title={row.text}
				data-testid="motif-trend"
			>
				<a
					class="truncate text-body capitalize hover:underline"
					href="{resolve('/puzzles')}?motif={encodeURIComponent(row.trend.motif)}"
					title="drill {humanizeMotif(row.trend.motif)}"
				>
					{humanizeMotif(row.trend.motif)}
				</a>
				<!-- the track is the 0–100% scale; the dots sit on it with a ring of
				     the card colour so they stay separate where they overlap -->
				<div class="relative h-4" aria-hidden="true">
					<div class="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line"></div>
					<div
						class="absolute top-1/2 h-0.5 -translate-y-1/2 bg-accent-line"
						style="left:{Math.min(row.before, row.after)}%;width:{Math.abs(
							row.after - row.before
						)}%"
					></div>
					<span
						class="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-card ring-2 ring-card"
						style="left:{row.before}%"
					></span>
					<span
						class="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-card"
						style="left:{row.after}%"
					></span>
				</div>
				<span class="text-right text-xs text-muted tabular-nums">
					<span class="sr-only">{row.text}</span>
					<span aria-hidden="true">
						{Math.round(row.before)}% → <span class="text-body">{Math.round(row.after)}%</span>
					</span>
				</span>
			</li>
		{/each}
	</ul>
</div>
