<script lang="ts">
	import './layout.css';
	import logo from '$lib/assets/logo.svg';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import SettingsMenu from '$lib/components/SettingsMenu.svelte';
	import { displayPrefs } from '$lib/stores/displayPrefs.svelte';
	import { session } from '$lib/stores/session.svelte';

	let { children } = $props();

	const links = [
		{ href: resolve('/'), label: 'Play' },
		{ href: resolve('/review'), label: 'Review' },
		{ href: resolve('/puzzles'), label: 'Puzzles' },
		{ href: resolve('/endgames'), label: 'Endgames' },
		{ href: resolve('/progress'), label: 'Progress' },
		{ href: resolve('/literature'), label: 'Literature' }
	];

	const welcome = resolve('/welcome');
	const onWelcome = $derived(page.url.pathname === welcome);

	// A friend game's link has to work for someone who has never been here.
	// They are not signed in and have not chosen to play anonymously — they
	// clicked a link — so the guard below would send them to a sign-up form
	// instead of the board they were invited to. The screen admits them
	// anonymously once it mounts; this is what lets it get that far.
	const onInvite = $derived(page.url.pathname.startsWith('/play/'));

	// Zen belongs to Play alone. The nav is the only way off a screen, so
	// hiding it anywhere the board isn't the whole point would strand the
	// visitor — and Play is the one screen that carries its own way out.
	const zen = $derived(displayPrefs.zenMode && page.url.pathname === resolve('/'));

	// onMount rather than the component body, matching how the play screen
	// starts its engine — a side effect that only makes sense in a browser
	// belongs after mount, not during initialization.
	onMount(() => {
		session.load();
	});

	// Nowhere to be but /welcome without an account or an anonymous session, or
	// signed in and still sitting on it. Gated on `ready` so the first paint
	// after a reload doesn't bounce a signed-in visitor through the welcome
	// screen before /auth/session lands. This is also what a 401 mid-session
	// lands on: the client clears the store, and the redirect follows.
	//
	// Only an account is sent away from /welcome. An anonymous player has a
	// reason to be there — it is where the sign-up form lives, and bouncing
	// them off it would make every "save your progress" link in the app a dead
	// end.
	$effect(() => {
		if (!session.ready) return;
		if (!session.admitted && !onWelcome && !onInvite) goto(welcome, { replaceState: true });
		else if (session.authenticated && onWelcome) goto(resolve('/'), { replaceState: true });
	});
</script>

<svelte:head><link rel="icon" href={logo} /></svelte:head>

<div class="min-h-screen bg-paper text-ink">
	<!-- Signed out there is nowhere to navigate to and nothing to configure,
	     and the welcome screen carries its own wordmark — so the bar would be
	     an empty duplicate of the page beneath it. Excluded on /welcome rather
	     than only while signed out: an anonymous player can be sitting on that
	     screen, having followed a sign-up link out of the app. -->
	{#if session.admitted && !onWelcome && !zen}
		<nav class="border-b border-line bg-card">
			<div class="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
				<a href={resolve('/')} class="flex items-center gap-2">
					<img src={logo} alt="" class="h-6 w-6" />
					<span class="font-display text-lg font-bold tracking-tight">leechess</span>
				</a>
				{#each links as link (link.href)}
					<a
						href={link.href}
						class="text-sm hover:text-ink {page.url.pathname === link.href
							? 'border-b border-accent pb-0.5 font-semibold text-ink'
							: 'text-muted'}"
					>
						{link.label}
					</a>
				{/each}
				<div class="ml-auto flex items-center gap-3">
					{#if session.name}
						<span class="text-sm text-muted" data-testid="nav-username">
							Playing as <span class="font-semibold text-ink">{session.name}</span>
						</span>
					{/if}
					<!-- The one thing an anonymous player might want that is not on
					     the screen they are looking at, so it is on every screen. -->
					{#if session.anonymous}
						<a
							href="{welcome}?mode=signup"
							data-testid="nav-sign-up"
							class="rounded-xs border border-accent-line px-2 py-1 text-xs font-semibold tracking-[0.07em] text-accent uppercase hover:bg-accent-soft"
						>
							Sign up
						</a>
					{/if}
					<SettingsMenu />
				</div>
			</div>
		</nav>
	{/if}
	<!-- Zen's stage positions itself against the viewport, so the page's own
	     column would only add a scrollbar behind it. -->
	<main class={zen ? '' : 'mx-auto max-w-5xl px-4 py-6'}>
		{#if session.ready}
			{@render children()}
		{/if}
	</main>
</div>
