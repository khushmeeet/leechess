<script lang="ts">
	// Board look picker, opened from the gear in the nav. Palette and piece
	// set apply to every Board live and persist via boardPrefs.
	import { resolve } from '$app/paths';
	import { BOARD_THEMES, PIECE_SETS, themeSwatch } from '$lib/boardThemes';
	import { boardPrefs } from '$lib/stores/boardPrefs.svelte';
	import { displayPrefs } from '$lib/stores/displayPrefs.svelte';
	import { soundPrefs } from '$lib/stores/soundPrefs.svelte';
	import { themePrefs, type ThemeMode } from '$lib/stores/themePrefs.svelte';
	import { authErrorMessage } from '$lib/auth/messages';
	import { session } from '$lib/stores/session.svelte';

	const THEME_MODES: { mode: ThemeMode; label: string }[] = [
		{ mode: 'light', label: 'Light' },
		{ mode: 'dark', label: 'Dark' },
		{ mode: 'system', label: 'Auto' }
	];

	let open = $state(false);
	let root = $state<HTMLElement>();
	let renameError = $state<string | null>(null);

	const welcome = resolve('/welcome');

	/** The username is the login identifier now, so a rename can be refused —
	 * taken, or the wrong shape. Reverts the field to the server's answer so
	 * what's shown is never a name that wasn't accepted. */
	async function rename(event: Event & { currentTarget: HTMLInputElement }) {
		// Captured before the await: currentTarget is only set while the event is
		// being dispatched, and is null by the time the request comes back.
		const input = event.currentTarget;
		const wanted = input.value.trim();
		if (!wanted || wanted === session.name) return;
		renameError = null;
		try {
			await session.rename(wanted);
		} catch (err) {
			renameError = authErrorMessage(err);
			// session.name never changed, so Svelte has no reason to re-render the
			// value attribute — the field has to be put back by hand.
			input.value = session.name ?? '';
		}
	}

	function close() {
		open = false;
	}

	function onWindowClick(event: MouseEvent) {
		if (open && root && !root.contains(event.target as Node)) close();
	}
	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') close();
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKeydown} />

<div class="relative" bind:this={root}>
	<button
		aria-label="Settings"
		aria-expanded={open}
		data-testid="settings-button"
		onclick={() => (open ? close() : (open = true))}
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
			<h2 class="mb-2 text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">Player</h2>
			{#if session.anonymous}
				<!-- No field: the name is not theirs to change, because there is
				     no account for it to be the name of. Saying what that costs
				     is more use here than a text box that would go nowhere. -->
				<p class="text-sm text-ink" data-testid="anonymous-player">{session.name}</p>
				<p class="mt-1 text-[11px] text-muted">
					Playing without an account. Nothing is saved — no games, no puzzles, no progress.
				</p>
				<a
					href="{welcome}?mode=signup"
					onclick={close}
					data-testid="sign-up"
					class="mt-2 block rounded-xs border border-accent-line bg-paper px-2 py-1 text-center text-sm text-accent hover:bg-accent-soft"
				>
					Create an account
				</a>
			{:else}
				<input
					type="text"
					value={session.name ?? ''}
					placeholder="Your name"
					maxlength="24"
					data-testid="username-setting-input"
					onchange={rename}
					class="w-full rounded-xs border border-line bg-paper px-2 py-1 text-sm text-ink"
				/>
				{#if renameError}
					<p class="mt-1 text-[11px] text-err" role="alert" data-testid="username-setting-error">
						{renameError}
					</p>
				{/if}
			{/if}
			<button
				type="button"
				onclick={() => session.signOut()}
				data-testid="sign-out"
				class="mt-2 w-full rounded-xs border border-line bg-paper px-2 py-1 text-sm text-muted hover:bg-accent-soft hover:text-ink"
			>
				{session.anonymous ? 'Leave' : 'Sign out'}
			</button>

			<h2 class="mt-4 mb-2 text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">
				Theme
			</h2>
			<div
				class="flex rounded-xs border border-line bg-paper text-sm"
				role="group"
				aria-label="Theme"
			>
				{#each THEME_MODES as { mode, label } (mode)}
					<button
						aria-pressed={themePrefs.mode === mode}
						onclick={() => themePrefs.setMode(mode)}
						class="flex-1 px-2 py-1 first:rounded-l-xs last:rounded-r-xs {themePrefs.mode === mode
							? 'bg-ink font-semibold text-paper'
							: 'text-muted hover:bg-accent-soft'}"
					>
						{label}
					</button>
				{/each}
			</div>

			<h2 class="mt-4 mb-2 text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">
				Board
			</h2>
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
							style="background: {themeSwatch(theme)}"
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
					<span class="text-ink">Zen mode</span>
					<input
						type="checkbox"
						checked={displayPrefs.zenMode}
						onchange={(event) => displayPrefs.setZenMode(event.currentTarget.checked)}
						data-testid="zen-toggle"
						class="h-4 w-4"
					/>
				</label>
				<!-- Said plainly, because this menu is behind the nav that zen
				     hides: the way back is on the board screen, not in here. -->
				<p class="-mt-0.5 mb-1 text-[11px] text-muted">
					Play with the board alone — no nav, no panels. Tap beside the board for Resign, New game
					and the way out.
				</p>
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
				<label class="flex items-center justify-between gap-2">
					<span class="text-ink">Opening theory (Review)</span>
					<input
						type="checkbox"
						checked={displayPrefs.showOpeningTheory}
						onchange={(event) => displayPrefs.setOpeningTheory(event.currentTarget.checked)}
						class="h-4 w-4"
					/>
				</label>
			</div>

			<h2 class="mt-4 mb-2 text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">
				Sound
			</h2>
			<div class="flex flex-col gap-1.5 text-sm">
				<label class="flex items-center justify-between gap-2">
					<span class="text-ink">Game sounds</span>
					<input
						type="checkbox"
						checked={soundPrefs.enabled}
						onchange={(event) => soundPrefs.setEnabled(event.currentTarget.checked)}
						data-testid="sound-toggle"
						class="h-4 w-4"
					/>
				</label>
			</div>
		</div>
	{/if}
</div>
