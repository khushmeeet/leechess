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

<div class="study-panel account-gate max-w-2xl" data-testid="account-gate">
	<h2 class="section-title">Sign up to save your progress</h2>
	<p class="mt-2 text-sm leading-normal text-body">{what}</p>
	<p class="mt-2 max-w-prose text-sm leading-normal text-muted">
		You're playing as {ANONYMOUS_NAME}, so nothing is being kept. An account is a name and a
		password — no email, and nothing shared with anyone.
	</p>
	<div class="mt-3 flex flex-wrap gap-2 text-sm">
		<a href="{welcome}?mode=signup" data-testid="gate-sign-up" class="btn-primary">
			Create an account
		</a>
		<a href="{welcome}?mode=signin" data-testid="gate-sign-in" class="btn-secondary"> Sign in </a>
	</div>
</div>

<style>
	.account-gate {
		border-block-start: 3px solid var(--color-ornament);
	}
</style>
