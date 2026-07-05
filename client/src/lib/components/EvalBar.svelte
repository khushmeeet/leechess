<script lang="ts">
	interface Props {
		/** Centipawns from white's perspective (clamped ±1000), null = unknown. */
		cp: number | null;
	}

	let { cp }: Props = $props();

	// Same cp → winning-chances curve Lichess uses; keeps the bar responsive
	// around 0 and saturating toward decisive evals.
	const whitePct = $derived.by(() => {
		if (cp === null) return 50;
		const chances = 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
		return 50 + 50 * chances;
	});

	const label = $derived(cp === null ? '–' : (cp / 100).toFixed(1));
</script>

<div
	class="relative h-full w-4 overflow-hidden rounded-sm border border-stone-400 bg-stone-800"
	title="eval: {label}"
	data-testid="eval-bar"
>
	<div
		class="absolute bottom-0 w-full bg-stone-50 transition-[height] duration-300"
		style="height: {whitePct}%"
	></div>
	<span
		class="absolute inset-x-0 text-center font-mono text-[9px] leading-none {whitePct >= 50
			? 'bottom-0.5 text-stone-700'
			: 'top-0.5 text-stone-200'}"
	>
		{label}
	</span>
</div>
