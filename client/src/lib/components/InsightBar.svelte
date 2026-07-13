<script lang="ts">
	import type { Idea } from '$lib/ideas';
	import type { OpeningState } from '$lib/stores/play.svelte';

	interface Props {
		opening: OpeningState | null;
		openingState: 'loading' | 'ready' | 'failed';
		/** Plies played so far. */
		ply: number;
		/** Coach row renders when true; a null sentence shows a pending dash. */
		showCoach: boolean;
		coach: string | null;
		showIdeas: boolean;
		ideas: Idea[];
		gameOver: boolean;
		/** Fired with a uci on chip hover/focus, null when it ends. */
		onideahover?: (uci: string | null) => void;
	}

	let {
		opening,
		openingState,
		ply,
		showCoach,
		coach,
		showIdeas,
		ideas,
		gameOver,
		onideahover
	}: Props = $props();

	const title = $derived.by(() => {
		if (opening) return opening.family;
		if (ply === 0) return 'Starting position';
		if (openingState === 'loading') return 'Opening book loading…';
		if (openingState === 'failed') return 'Opening book unavailable';
		return 'Out of book';
	});

	const subtitle = $derived.by(() => {
		if (!opening) {
			return ply === 0 ? 'Play a move to enter the book' : null;
		}
		const state = opening.inBook
			? 'Known book position'
			: 'Past book, showing the closest known line';
		return opening.variation ? `${state} · ${opening.variation}` : state;
	});
</script>

<section
	data-testid="insight-bar"
	class="flex flex-col gap-2 rounded-xs border border-line bg-card px-3 py-3 text-sm"
>
	<div>
		<div>
			<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
				<svg
					class="shrink-0 text-accent"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.7"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M2 4h6a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H2z" />
					<path d="M22 4h-6a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H22z" />
				</svg>
				{#if opening}
					<span
						class="inline-flex items-center rounded-xs border border-accent-line px-2 py-0.5 text-[10px] font-semibold tracking-[0.09em] text-accent uppercase"
					>
						{opening.eco}
					</span>
				{/if}
				<span class="min-w-0 font-semibold text-ink" data-testid="opening-name">{title}</span>
			</div>
			{#if subtitle}
				<p class="mt-0.5 text-xs text-muted" data-testid="opening-subtitle">{subtitle}</p>
			{/if}
		</div>
	</div>

	{#if showCoach}
		<div
			class="grid grid-cols-[3.25rem_minmax(0,1fr)] items-baseline gap-2"
			data-testid="coach-line"
		>
			<span class="shrink-0 text-[10px] font-semibold tracking-[0.09em] text-faint uppercase">
				Coach
			</span>
			{#if coach}
				<p class="text-body">{coach}</p>
			{:else}
				<span class="text-faint">…</span>
			{/if}
		</div>
	{/if}

	{#if showIdeas}
		<div class="grid grid-cols-[3.25rem_minmax(0,1fr)] items-start gap-2" data-testid="ideas-row">
			<span class="shrink-0 text-[10px] font-semibold tracking-[0.09em] text-faint uppercase">
				Ideas
			</span>
			{#if gameOver}
				<span class="text-faint">—</span>
			{:else if ideas.length > 0}
				<div class="flex min-w-0 flex-wrap gap-1.5">
					{#each ideas as idea (idea.uci)}
						<button
							type="button"
							class="flex min-w-0 items-stretch overflow-hidden rounded-xs border border-line bg-paper text-xs hover:border-accent-line"
							onmouseenter={() => onideahover?.(idea.uci)}
							onmouseleave={() => onideahover?.(null)}
							onfocus={() => onideahover?.(idea.uci)}
							onblur={() => onideahover?.(null)}
						>
							<span
								class="whitespace-nowrap border-r border-line bg-card px-1.5 py-0.5 font-mono font-semibold text-ink"
							>
								{idea.san}
							</span>
							<span class="min-w-0 truncate px-1.5 py-0.5 text-muted">{idea.label}</span>
						</button>
					{/each}
				</div>
			{:else}
				<span class="text-faint">…</span>
			{/if}
		</div>
	{/if}
</section>
