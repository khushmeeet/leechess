<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	let { children } = $props();

	const links = [
		{ href: resolve('/'), label: 'Play' },
		{ href: resolve('/review'), label: 'Review' },
		{ href: resolve('/puzzles'), label: 'Puzzles' },
		{ href: resolve('/progress'), label: 'Progress' }
	];
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="min-h-screen bg-stone-100 text-stone-900">
	<nav class="border-b border-stone-300 bg-white">
		<div class="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
			<span class="font-bold tracking-tight">leechess</span>
			{#each links as link (link.href)}
				<a
					href={link.href}
					class="text-sm hover:text-stone-950 {page.url.pathname === link.href
						? 'font-semibold text-stone-950 underline underline-offset-4'
						: 'text-stone-500'}"
				>
					{link.label}
				</a>
			{/each}
		</div>
	</nav>
	<main class="mx-auto max-w-5xl px-4 py-6">
		{@render children()}
	</main>
</div>
