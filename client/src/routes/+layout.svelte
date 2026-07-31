<script lang="ts">
	import './layout.css';
	import logo from '$lib/assets/logo.svg';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import SettingsMenu from '$lib/components/SettingsMenu.svelte';
	import UpgradePrompt from '$lib/components/UpgradePrompt.svelte';
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

	// onMount rather than the component body, matching how the play screen
	// starts its engine — a side effect that only makes sense in a browser
	// belongs after mount, not during initialization.
	onMount(() => {
		session.load();
	});

	// Signed out anywhere but /welcome, or signed in and still sitting on it.
	// Gated on `ready` so the first paint after a reload doesn't bounce a
	// signed-in visitor through the welcome screen before /auth/session lands.
	// This is also what a 401 mid-session lands on: the client clears the
	// store, and the redirect follows from that.
	$effect(() => {
		if (!session.ready) return;
		if (!session.authenticated && !onWelcome) goto(welcome, { replaceState: true });
		else if (session.authenticated && onWelcome) goto(resolve('/'), { replaceState: true });
	});
</script>

<svelte:head><link rel="icon" href={logo} /></svelte:head>

<div class="min-h-screen bg-paper text-ink">
	<nav class="border-b border-line bg-card">
		<div class="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
			<a href={resolve('/')} class="flex items-center gap-2">
				<img src={logo} alt="" class="h-6 w-6" />
				<span class="font-display text-lg font-bold tracking-tight">leechess</span>
			</a>
			{#if session.authenticated}
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
			{/if}
			<div class="ml-auto flex items-center gap-3">
				{#if session.name}
					<span class="text-sm text-muted" data-testid="nav-username">
						Playing as <span class="font-semibold text-ink">{session.name}</span>
					</span>
				{/if}
				{#if session.authenticated}
					<SettingsMenu />
				{/if}
			</div>
		</div>
	</nav>
	<main class="mx-auto max-w-5xl px-4 py-6">
		{#if session.ready}
			<UpgradePrompt />
			{@render children()}
		{/if}
	</main>
</div>
