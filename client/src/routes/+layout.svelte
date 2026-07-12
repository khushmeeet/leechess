<script lang="ts">
	import './layout.css';
	import logo from '$lib/assets/logo.svg';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import SettingsMenu from '$lib/components/SettingsMenu.svelte';

	let { children } = $props();

	const links = [
		{ href: resolve('/'), label: 'Play' },
		{ href: resolve('/review'), label: 'Review' },
		{ href: resolve('/puzzles'), label: 'Puzzles' },
		{ href: resolve('/progress'), label: 'Progress' },
		{ href: resolve('/literature'), label: 'Literature' }
	];
</script>

<svelte:head><link rel="icon" href={logo} /></svelte:head>

<div class="min-h-screen bg-paper text-ink">
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
			<div class="ml-auto">
				<SettingsMenu />
			</div>
		</div>
	</nav>
	<main class="mx-auto max-w-5xl px-4 py-6">
		{@render children()}
	</main>
</div>
