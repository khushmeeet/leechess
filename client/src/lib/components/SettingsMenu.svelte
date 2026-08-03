<script lang="ts">
	// Board look picker, opened from the gear in the nav. Palette and piece
	// set apply to every Board live and persist via boardPrefs.
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { BOARD_THEMES, PIECE_SETS, themeSwatch } from '$lib/boardThemes';
	import { openFriendGame } from '$lib/stores/live.svelte';
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

	// Repeated on every section heading and on every rule between sections.
	// Named because the panel now has three columns of them and a heading that
	// drifts is the one thing a column layout shows up immediately.
	const HEADING = 'mb-2 text-[10px] font-semibold tracking-[0.12em] text-muted uppercase';
	// Between sections inside a column: a rule in both layouts, because within
	// a column the axis never turns.
	const RULE = 'my-4 h-px bg-line';
	// Between columns: the same hairline, turned on its side once the panel
	// goes horizontal. Stacked, it is indistinguishable from RULE — which is
	// the point, the grouping reads the same in both layouts.
	const COLUMN_RULE = 'my-4 h-px w-full shrink-0 bg-line lg:mx-5 lg:my-0 lg:h-auto lg:w-px';

	let open = $state(false);
	let root = $state<HTMLElement>();
	let renameError = $state<string | null>(null);
	let friendBusy = $state(false);
	let friendError = $state<string | null>(null);

	const welcome = resolve('/welcome');

	/** Open a friend game and go to it. The link to send is on that screen —
	 * putting it behind one button rather than a dialog is the whole point:
	 * share the link, start playing. */
	async function playWithFriend() {
		if (friendBusy) return;
		friendBusy = true;
		friendError = null;
		try {
			const token = await openFriendGame();
			close();
			await goto(resolve('/play/[token]', { token }));
		} catch {
			friendError = 'Could not start a game just now. Try again in a moment.';
		} finally {
			friendBusy = false;
		}
	}

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
			class="settings-panel absolute top-full right-0 z-20 mt-2 flex w-72 flex-col rounded-xs border border-line bg-card p-4 shadow-lg lg:w-auto lg:flex-row lg:items-stretch lg:p-5"
			data-testid="settings-menu"
		>
			<!-- Who you are, and who you can pull in. Both are about the other
			     person at the board rather than about the board. -->
			<div class="lg:w-56 lg:shrink-0">
				<h2 class={HEADING}>Player</h2>
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

				<div class={RULE}></div>

				<h2 class={HEADING}>Play with a friend</h2>
				<button
					type="button"
					onclick={playWithFriend}
					disabled={friendBusy}
					data-testid="settings-play-friend"
					class="w-full rounded-xs border border-accent-line px-2 py-1 text-center text-sm text-accent hover:bg-accent-soft disabled:opacity-50"
				>
					{friendBusy ? 'Starting…' : 'Start a game'}
				</button>
				<p class="mt-1 text-[11px] text-muted">
					You get a link. Whoever opens it first plays the other side — no account needed, on either
					end.
				</p>
				{#if friendError}
					<p class="mt-1 text-[11px] text-err" role="alert" data-testid="settings-friend-error">
						{friendError}
					</p>
				{/if}
				<!-- The coach and the ideas row are absent here on purpose, and it is
			     not an oversight worth "fixing": both say what Stockfish would
			     play, which beside a live opponent is not a display preference.
			     What is left is furniture, and it starts out of the way. -->
				<div class="mt-2 flex flex-col gap-1.5 text-sm">
					<label class="flex items-center justify-between gap-2">
						<span class="text-ink">Move list</span>
						<input
							type="checkbox"
							checked={displayPrefs.friendMoveList}
							onchange={(event) => displayPrefs.setFriendMoveList(event.currentTarget.checked)}
							data-testid="friend-move-list-toggle"
							class="h-4 w-4"
						/>
					</label>
					<label class="flex items-center justify-between gap-2">
						<span class="text-ink">Eval bar</span>
						<input
							type="checkbox"
							checked={displayPrefs.friendEvalBar}
							onchange={(event) => displayPrefs.setFriendEvalBar(event.currentTarget.checked)}
							data-testid="friend-eval-bar-toggle"
							class="h-4 w-4"
						/>
					</label>
					<label class="flex items-center justify-between gap-2">
						<span class="text-ink">Move badges</span>
						<input
							type="checkbox"
							checked={displayPrefs.friendBadges}
							onchange={(event) => displayPrefs.setFriendBadges(event.currentTarget.checked)}
							data-testid="friend-badges-toggle"
							class="h-4 w-4"
						/>
					</label>
					<p class="text-[11px] text-muted">
						The eval bar and the badges run Stockfish on the live position. They are yours alone,
						and your opponent is not told — so switch them on knowing what that is.
					</p>
				</div>
			</div>

			<div class={COLUMN_RULE}></div>

			<!-- Everything you look at: light or dark, the squares, the pieces.
			     No rules inside it — the three are one decision made three
			     times, and hairlines between them would say otherwise. -->
			<div class="lg:w-72 lg:shrink-0">
				<h2 class={HEADING}>Theme</h2>
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

				<h2 class="mt-4 {HEADING}">Board</h2>
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

				<!-- Three across stacked, four once there is a column to fill:
				     seven sets over three rows left one alone on the last, and
				     that orphan set the middle column's height by itself. -->
				<h2 class="mt-4 {HEADING}">Pieces</h2>
				<div class="grid grid-cols-3 gap-2 lg:grid-cols-4">
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
			</div>

			<div class={COLUMN_RULE}></div>

			<!-- What the app tells you while you play, and whether it makes a
			     noise doing it. -->
			<div class="lg:w-52 lg:shrink-0">
				<h2 class={HEADING}>Display</h2>
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
					<!-- Friend games have an eval bar of their own, a few sections up,
				     so "Eval bar" alone no longer picks one out — hence the ids. -->
					<label class="flex items-center justify-between gap-2">
						<span class="text-ink">Eval bar</span>
						<input
							type="checkbox"
							checked={displayPrefs.showEvalBar}
							onchange={(event) => displayPrefs.setEvalBar(event.currentTarget.checked)}
							data-testid="eval-bar-toggle"
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

				<div class={RULE}></div>

				<h2 class={HEADING}>Sound</h2>
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
		</div>
	{/if}
</div>

<style>
	/* The largest thing in the app that used to simply be there — eight
	 * sections of it, a frame after the gear is clicked. It grows out of the
	 * gear instead. The origin is the trigger's corner rather than a guess,
	 * because the panel is already pinned to it (top-full right-0); the
	 * spatial relationship exists in the layout and this only makes it
	 * legible. It survives the turn to three columns unchanged: the panel got
	 * wider and shorter, but it is still anchored by that same corner.
	 *
	 * Entrance only, and that asymmetry is deliberate. {#if open} takes the
	 * node out on close, so an exit would have to be a JS transition — and it
	 * would buy nothing. An entrance says where a thing came from; nobody
	 * needs to be told where the menu they just dismissed went. */
	.settings-panel {
		transform-origin: top right;
		transition:
			opacity 180ms var(--ease-rise),
			transform 180ms var(--ease-rise);
	}

	@starting-style {
		.settings-panel {
			transform: scale(0.96) translateY(-4px);
			opacity: 0;
		}
	}

	/* Dropping transform from the transition list is the whole override: a
	 * property that is not transitioning paints at its final value from the
	 * first frame, so the scale in @starting-style above is never shown. */
	@media (prefers-reduced-motion: reduce) {
		.settings-panel {
			transition: opacity 120ms var(--ease-rise);
		}
	}
</style>
