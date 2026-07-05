<script lang="ts">
	import { BADGE_STYLES, type Classification } from '$lib/classification';

	interface Props {
		classification: Classification;
		/** Compact single-letter chip for move lists. */
		compact?: boolean;
	}

	let { classification, compact = false }: Props = $props();
</script>

{#if compact}
	<span
		class="inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-bold uppercase {BADGE_STYLES[
			classification
		]}"
		title={classification}
	>
		{classification === 'blunder' ? '??' : classification[0]}
	</span>
{:else}
	<span
		class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold capitalize {BADGE_STYLES[
			classification
		]}"
	>
		{classification}
	</span>
{/if}
