<script lang="ts">
	// Board look picker, opened from the gear in the nav. Palette and piece
	// set apply to every Board live and persist via boardPrefs.
	import { BOARD_THEMES, PIECE_SETS } from '$lib/boardThemes';
	import { boardPrefs } from '$lib/stores/boardPrefs.svelte';
	import { displayPrefs } from '$lib/stores/displayPrefs.svelte';

	let open = $state(false);
	let root = $state<HTMLElement>();

	function onWindowClick(event: MouseEvent) {
		if (open && root && !root.contains(event.target as Node)) open = false;
	}
	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') open = false;
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKeydown} />

<div class="relative" bind:this={root}>
	<button
		aria-label="Board settings"
		aria-expanded={open}
		data-testid="settings-button"
		onclick={() => (open = !open)}
		class="rounded-xs p-1.5 text-muted hover:bg-accent-soft hover:text-ink"
	>
		<svg
			viewBox="0 0 24 24"
			class="h-5 w-5"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="3" />
			<path
				d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
			/>
		</svg>
	</button>

	{#if open}
		<div
			class="absolute top-full right-0 z-20 mt-2 w-72 rounded-xs border border-line bg-card p-4 shadow-lg"
			data-testid="settings-menu"
		>
			<h2 class="mb-2 text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">Board</h2>
			<div class="grid grid-cols-4 gap-2">
				{#each BOARD_THEMES as theme (theme.name)}
					<button
						aria-pressed={boardPrefs.themeName === theme.name}
						onclick={() => boardPrefs.setTheme(theme.name)}
						class="flex flex-col items-center gap-1"
					>
						<span
							class="h-8 w-full rounded-xs {boardPrefs.themeName === theme.name
								? 'outline-2 outline-offset-2 outline-accent'
								: 'outline-1 -outline-offset-1 outline-line'}"
							style="background: linear-gradient(135deg, {theme.light} 50%, {theme.dark} 50%)"
						></span>
						<span
							class="text-[10px] {boardPrefs.themeName === theme.name
								? 'font-semibold text-ink'
								: 'text-muted'}"
						>
							{theme.label}
						</span>
					</button>
				{/each}
			</div>

			<h2 class="mt-4 mb-2 text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">
				Pieces
			</h2>
			<div class="grid grid-cols-3 gap-2">
				{#each PIECE_SETS as set (set.id)}
					<button
						aria-pressed={boardPrefs.pieceSet === set.id}
						onclick={() => boardPrefs.setPieceSet(set.id)}
						class="flex flex-col items-center gap-0.5 rounded-xs border p-2 {boardPrefs.pieceSet ===
						set.id
							? 'border-accent bg-accent-soft'
							: 'border-line hover:border-faint'}"
					>
						<img src="/pieces/{set.id}/wN.svg" alt="" class="h-8 w-8" />
						<span
							class="text-[10.5px] {boardPrefs.pieceSet === set.id
								? 'font-semibold text-ink'
								: 'text-muted'}"
						>
							{set.label}
						</span>
					</button>
				{/each}
			</div>

			<h2 class="mt-4 mb-2 text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">
				Display
			</h2>
			<div class="flex flex-col gap-1.5 text-sm">
				<label class="flex items-center justify-between gap-2">
					<span class="text-ink">Eval bar</span>
					<input
						type="checkbox"
						checked={displayPrefs.showEvalBar}
						onchange={(event) => displayPrefs.setEvalBar(event.currentTarget.checked)}
						class="h-4 w-4"
					/>
				</label>
				<label class="flex items-center justify-between gap-2">
					<span class="text-ink">Coach</span>
					<input
						type="checkbox"
						checked={displayPrefs.showCoach}
						onchange={(event) => displayPrefs.setCoach(event.currentTarget.checked)}
						class="h-4 w-4"
					/>
				</label>
				<label class="flex items-center justify-between gap-2">
					<span class="text-ink">Ideas</span>
					<input
						type="checkbox"
						checked={displayPrefs.showIdeas}
						onchange={(event) => displayPrefs.setIdeas(event.currentTarget.checked)}
						class="h-4 w-4"
					/>
				</label>
			</div>
		</div>
	{/if}
</div>
