<script lang="ts">
	// Shared hint ladder (Play / Review / Puzzles). Phase 0 wires up only
	// Level 0 — the always-shown pre-move nudge. Levels 1-5 (category, motif,
	// square highlights, move + reason, full line) land in Phase 3.
	interface Props {
		/** Level 0 nudge visibility — the parent re-shows it after every opponent move. */
		nudgeVisible: boolean;
		ondismiss: () => void;
	}

	let { nudgeVisible, ondismiss }: Props = $props();
</script>

{#if nudgeVisible}
	<div
		role="status"
		class="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
	>
		<span>Checks, captures, threats?</span>
		<button
			onclick={ondismiss}
			aria-label="Dismiss hint"
			class="rounded px-1.5 text-amber-700 hover:bg-amber-100"
		>
			✕
		</button>
	</div>
{/if}
