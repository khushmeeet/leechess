<script lang="ts">
	// What an anonymous player gets instead of Review, Puzzles, Endgames or
	// Progress. All four are built on things the server keeps — finished games,
	// the puzzles generated from their blunders, Leitner schedules, motif
	// history — and an anonymous player has none of it, by design.
	//
	// So the screen says what it would hold rather than showing an empty
	// version of itself: "no games yet" is a lie here, because no game played
	// this way will ever arrive.
	import { resolve } from '$app/paths';
	import { ANONYMOUS_NAME } from '$lib/stores/session.svelte';

	let { what }: { what: string } = $props();

	const welcome = resolve('/welcome');
</script>

<div
	class="max-w-xl rounded-xs border border-accent-line bg-accent-soft p-4"
	data-testid="account-gate"
>
	<h2 class="font-display text-lg">Sign up to save your progress</h2>
	<p class="mt-1 text-sm text-body">{what}</p>
	<p class="mt-2 text-xs text-muted">
		You're playing as {ANONYMOUS_NAME}, so nothing is being kept. An account is a name and a
		password — no email, and nothing shared with anyone.
	</p>
	<div class="mt-3 flex flex-wrap gap-2 text-sm">
		<a
			href="{welcome}?mode=signup"
			data-testid="gate-sign-up"
			class="rounded-xs border border-accent-line px-3 py-2 text-xs font-semibold tracking-[0.07em] text-accent uppercase hover:bg-card"
		>
			Create an account
		</a>
		<a
			href="{welcome}?mode=signin"
			data-testid="gate-sign-in"
			class="rounded-xs border border-line bg-card px-3 py-2 hover:bg-paper"
		>
			Sign in
		</a>
	</div>
</div>
