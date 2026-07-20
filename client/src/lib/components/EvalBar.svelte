<script lang="ts">
	interface Props {
		/** Centipawns from white's perspective (clamped ±1000), null = unknown. */
		cp: number | null;
		/** Matches the board: white's share fills from the white side. */
		orientation?: 'white' | 'black';
	}

	let { cp, orientation = 'white' }: Props = $props();

	// Same cp → winning-chances curve Lichess uses; keeps the bar responsive
	// around 0 and saturating toward decisive evals.
	const whitePct = $derived.by(() => {
		if (cp === null) return 50;
		const chances = 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
		return 50 + 50 * chances;
	});

	const label = $derived(cp === null ? '–' : (cp / 100).toFixed(1));

	// The readout tab tracks the fill boundary but is clamped a few percent
	// from each end so it never clips past the bar at decisive evals.
	const boundaryPct = $derived(orientation === 'white' ? 100 - whitePct : whitePct);
	const tabPct = $derived(Math.min(94, Math.max(6, boundaryPct)));
</script>

<div class="relative h-full w-14 shrink-0" title="eval: {label}" data-testid="eval-bar">
	<div
		class="absolute inset-y-0 right-0 w-[10px] overflow-hidden rounded-xs bg-body shadow-[0_0_0_1px_var(--color-line)]"
	>
		<div
			class="absolute inset-x-0 {orientation === 'white'
				? 'bottom-0 rounded-t-xs'
				: 'top-0 rounded-b-xs'} bg-card transition-[height] duration-300"
			style="height: {whitePct}%"
		></div>
		<div class="absolute inset-x-[-3px] top-1/2 h-px -translate-y-1/2 bg-accent-line"></div>
	</div>
	<div
		class="absolute right-[10px] flex -translate-y-1/2 items-center transition-[top] duration-300"
		style="top: {tabPct}%"
	>
		<span
			class="whitespace-nowrap rounded-l-xs bg-accent py-0.5 pr-1 pl-1.5 font-mono text-[10px] leading-none font-semibold text-paper shadow-sm"
		>
			{label}
		</span>
		<span class="h-0 w-0 border-y-4 border-y-transparent border-l-4 border-l-accent"></span>
	</div>
</div>
