<script lang="ts">
	import { OVERLAYS } from '$lib/overlays';
	import { displayPrefs } from '$lib/stores/displayPrefs.svelte';

	// One chip per board overlay; each is a way of looking at the position
	// ($lib/overlays). The choice persists, and applies wherever a board
	// draws overlays.
</script>

<div
	class="flex flex-wrap items-center gap-1.5 text-xs"
	role="group"
	aria-label="Board overlays"
	data-testid="overlay-toggles"
>
	<span class="text-muted">Show:</span>
	{#each OVERLAYS as overlay (overlay.name)}
		{@const on = displayPrefs.overlays.includes(overlay.name)}
		<button
			type="button"
			aria-pressed={on}
			title={overlay.title}
			data-testid="overlay-{overlay.name}"
			onclick={() => displayPrefs.toggleOverlay(overlay.name)}
			class="rounded-xs border px-1.5 py-0.5 {on
				? 'border-ink bg-ink font-semibold text-paper'
				: 'border-line text-muted hover:bg-paper'}"
		>
			{overlay.label}
		</button>
	{/each}
</div>
