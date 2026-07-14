<script lang="ts">
	// First-run banner asking for a display name — shown once per browser
	// until a name is saved (usernamePrefs). Inline, not a blocking modal:
	// dismissing just hides it for this session (dismissed is in-memory only).
	import { usernamePrefs } from '$lib/stores/username.svelte';

	let value = $state('');

	function save() {
		if (!value.trim()) return;
		usernamePrefs.set(value);
	}
</script>

{#if !usernamePrefs.name && !usernamePrefs.dismissed}
	<div
		class="mb-4 flex flex-wrap items-center gap-3 rounded-xs border border-accent-line bg-accent-soft px-4 py-3 text-sm"
		data-testid="username-prompt"
	>
		<p class="text-body">
			<span class="font-semibold text-ink">Welcome!</span> What should we call you?
		</p>
		<form
			class="ml-auto flex items-center gap-2"
			onsubmit={(event) => {
				event.preventDefault();
				save();
			}}
		>
			<input
				type="text"
				bind:value
				placeholder="Your name"
				maxlength="40"
				aria-label="Your name"
				data-testid="username-input"
				class="w-40 rounded-xs border border-line bg-card px-2 py-1 text-sm text-ink"
			/>
			<button
				type="submit"
				data-testid="username-save"
				class="rounded-xs border border-accent-line px-3 py-1 text-xs font-semibold tracking-[0.07em] text-accent uppercase hover:bg-card"
			>
				Save
			</button>
			<button
				type="button"
				onclick={() => usernamePrefs.dismiss()}
				aria-label="Dismiss"
				data-testid="username-dismiss"
				class="px-1 text-muted hover:text-ink"
			>
				✕
			</button>
		</form>
	</div>
{/if}
