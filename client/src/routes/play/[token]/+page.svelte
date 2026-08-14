<script lang="ts">
	// The friend-game route is one screen per link, and the screen itself lives
	// in FriendGame.svelte.
	//
	// It is split that way for the sake of the `{#key}` below. SvelteKit reuses
	// a page component when a navigation only changes its params, so going from
	// one friend game to the next — which is exactly what "Play again — new
	// link" does — left the finished game's session, socket and board on screen
	// while the URL quietly changed underneath them. The token is read once, at
	// setup, by everything that matters: the session, the seat lookup, the link
	// in the invite panel. A new link is a new game, so it gets a new component.
	import { page } from '$app/state';
	import FriendGame from '$lib/components/FriendGame.svelte';

	const token = $derived(page.params.token!);
</script>

<svelte:head><title>leechess — playing a friend</title></svelte:head>

{#key token}
	<FriendGame {token} />
{/key}
