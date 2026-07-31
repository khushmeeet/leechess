<script lang="ts">
	// Offers a guest a password, so their progress is reachable from another
	// browser. Deliberately late and deliberately skippable: it only appears
	// once there is something to lose (a game exists), it never blocks a route,
	// and dismissing is in-memory so it asks again next visit rather than
	// nagging within one.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { listGames } from '$lib/api/client';
	import { authErrorMessage } from '$lib/auth/messages';
	import { session } from '$lib/stores/session.svelte';

	let hasPlayed = $state(false);
	let dismissed = $state(false);
	/** The one check that isn't triggered by leaving the play screen: a guest
	 * arriving with games already behind them (a reload, or a deep link). */
	let first = true;
	let expanded = $state(false);
	let password = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);
	let done = $state(false);

	const showing = $derived(session.isGuest && hasPlayed && !dismissed);

	// A game can only have appeared since the last check if they were just on
	// the play screen, so that is the only departure worth a request. Checking
	// on every navigation instead meant one /games call per click for exactly
	// the guests who have played nothing — the answer is [] every time.
	const play = resolve('/');
	let previous = page.url.pathname;

	$effect(() => {
		const current = page.url.pathname;
		const cameFromPlay = previous === play;
		previous = current;

		if (!session.isGuest || hasPlayed || dismissed) return;
		if (!cameFromPlay && !first) return;
		first = false;
		listGames()
			.then((games) => (hasPlayed = games.length > 0))
			.catch(() => {});
	});

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		error = null;
		try {
			await session.upgrade(password);
			done = true;
		} catch (err) {
			error = authErrorMessage(err);
		} finally {
			busy = false;
		}
	}
</script>

{#if done}
	<div
		class="mb-4 rounded-xs border border-ok-line bg-ok-bg px-4 py-3 text-sm"
		data-testid="upgrade-done"
	>
		Password set. Sign in as <span class="font-semibold text-ink">{session.name}</span> to pick this up
		on another browser.
	</div>
{:else if showing}
	<div
		class="mb-4 rounded-xs border border-accent-line bg-accent-soft px-4 py-3 text-sm"
		data-testid="upgrade-prompt"
	>
		<div class="flex flex-wrap items-center gap-3">
			<p class="text-body">
				You're playing as a guest. Set a password to keep your games, puzzles and progress on
				another browser.
			</p>
			<div class="ml-auto flex items-center gap-2">
				<button
					type="button"
					onclick={() => (expanded = !expanded)}
					data-testid="upgrade-open"
					class="rounded-xs border border-accent-line px-3 py-1 text-xs font-semibold tracking-[0.07em] text-accent uppercase hover:bg-card"
				>
					Set a password
				</button>
				<button
					type="button"
					onclick={() => (dismissed = true)}
					aria-label="Dismiss"
					data-testid="upgrade-dismiss"
					class="px-1 text-muted hover:text-ink"
				>
					✕
				</button>
			</div>
		</div>

		{#if expanded}
			<form class="mt-3 flex flex-wrap items-center gap-2" onsubmit={save}>
				<input
					type="password"
					bind:value={password}
					autocomplete="new-password"
					placeholder="New password"
					required
					aria-label="New password"
					data-testid="upgrade-password"
					class="w-52 rounded-xs border border-line bg-card px-2 py-1 text-sm text-ink"
				/>
				<button
					type="submit"
					disabled={busy}
					data-testid="upgrade-submit"
					class="rounded-xs border border-accent-line px-3 py-1 text-xs font-semibold tracking-[0.07em] text-accent uppercase hover:bg-card disabled:opacity-50"
				>
					Save
				</button>
				<p class="w-full text-xs text-muted">
					Your username stays <span class="font-semibold text-ink">{session.name}</span>. There's no
					password reset — leechess has no email address for you, so save it in a password manager.
				</p>
				{#if error}
					<p class="w-full text-xs text-err" role="alert" data-testid="upgrade-error">{error}</p>
				{/if}
			</form>
		{/if}
	</div>
{/if}
