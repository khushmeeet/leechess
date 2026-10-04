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
		{#if classification === 'book'}
			<!-- an open book: "b" is already best's letter -->
			<svg viewBox="0 0 16 16" class="h-2.5 w-2.5" aria-hidden="true">
				<path
					d="M8 4.5C6.5 3.3 4.4 3 2 3.2v8.6c2.4-.2 4.5.1 6 1.3 1.5-1.2 3.6-1.5 6-1.3V3.2c-2.4-.2-4.5.1-6 1.3Zm0 0v8.6"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linejoin="round"
				/>
			</svg>
		{:else}
			{classification === 'blunder' ? '??' : classification[0]}
		{/if}
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
