<script lang="ts">
	// Board look picker, opened from the gear in the nav. Palette and piece
	// set apply to every Board live and persist via boardPrefs.
	import { BOARD_THEMES, PIECE_SETS } from '$lib/boardThemes';
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
	let signingUp = $state(false);
	let wantedName = $state('');
	let password = $state('');
	let signUpError = $state<string | null>(null);
	let busy = $state(false);
	let signedUp = $state(false);

	/** A registered rename can be refused — taken, or the wrong shape — because
	 * the username is that account's login identifier. A guest's is a label and
	 * is never refused. Either way the field is reverted to the server's answer,
	 * so what's shown is never a name that wasn't accepted. */
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

	/** Opening the sign-up form starts it from the name they have been playing
	 * under — usually the right answer, and the one field they may have to
	 * change if somebody registered it first. */
	function toggleSignUp() {
		signingUp = !signingUp;
		if (signingUp) wantedName = session.name ?? '';
	}

	/** Guest takes a username and a password, from the one menu that is always
	 * reachable. Same call as UpgradePrompt's, which only appears once a game
	 * exists — this is the way in for somebody who came looking for it. */
	async function signUp(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		signUpError = null;
		try {
			await session.upgrade(wantedName.trim(), password);
			// session.isGuest is false from here, so the button below is a real
			// Sign out now — this flag is only what says so.
			signedUp = true;
			signingUp = false;
			password = '';
		} catch (err) {
			signUpError = authErrorMessage(err);
		} finally {
			busy = false;
		}
	}

	/** Closing drops the sign-up form with it: the half-typed password, the
	 * error that went with it, and the confirmation — which belongs to the
	 * moment it happened, not to every later visit to this menu. */
	function close() {
		open = false;
		signingUp = false;
		password = '';
		signUpError = null;
		signedUp = false;
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
			{#if session.isGuest}
				<!-- A guest has never signed in and has nothing to sign back in
				     with, so "Sign out" here is a way to lose an account rather
				     than to leave one. What they actually want at this point is to
				     keep it — the accent is the only coloured thing in this menu,
				     which is about as much as a settings panel should insist. -->
				<button
					type="button"
					onclick={toggleSignUp}
					aria-expanded={signingUp}
					data-testid="sign-up"
					class="mt-2 w-full rounded-xs border border-accent-line bg-paper px-2 py-1 text-sm text-accent hover:bg-accent-soft"
				>
					Sign up
				</button>
				{#if signingUp}
					<form class="mt-2 flex flex-col gap-1.5" onsubmit={signUp}>
						<!-- The name is asked for again rather than taken from above:
						     it has been a label until now and becomes a login here, so
						     it is the one field that can come back refused. -->
						<input
							type="text"
							bind:value={wantedName}
							autocomplete="username"
							placeholder="Username"
							maxlength="24"
							required
							aria-label="Username"
							data-testid="sign-up-username"
							class="w-full rounded-xs border border-line bg-paper px-2 py-1 text-sm text-ink"
						/>
						<input
							type="password"
							bind:value={password}
							autocomplete="new-password"
							placeholder="New password"
							required
							aria-label="New password"
							data-testid="sign-up-password"
							class="w-full rounded-xs border border-line bg-paper px-2 py-1 text-sm text-ink"
						/>
						<button
							type="submit"
							disabled={busy}
							data-testid="sign-up-submit"
							class="w-full rounded-xs border border-accent-line px-2 py-1 text-sm text-accent hover:bg-accent-soft disabled:opacity-50"
						>
							Save
						</button>
						<p class="text-[11px] text-muted">
							Keeps this account and everything under it, on any browser. The name becomes your
							login, so it has to be free. There's no password reset — leechess has no email address
							for you.
						</p>
						{#if signUpError}
							<p class="text-[11px] text-err" role="alert" data-testid="sign-up-error">
								{signUpError}
							</p>
						{/if}
					</form>
				{/if}
			{:else}
				{#if signedUp}
					<p class="mt-2 text-[11px] text-ok" data-testid="sign-up-done">
						Password set. Sign in as <span class="font-semibold">{session.name}</span> from any browser.
					</p>
				{/if}
				<button
					type="button"
					onclick={() => session.signOut()}
					data-testid="sign-out"
					class="mt-2 w-full rounded-xs border border-line bg-paper px-2 py-1 text-sm text-muted hover:bg-accent-soft hover:text-ink"
				>
					Sign out
				</button>
			{/if}

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
