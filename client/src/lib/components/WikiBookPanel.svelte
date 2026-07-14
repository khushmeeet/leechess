<script lang="ts">
	/** Wikibooks "Chess Opening Theory" prose for the position on the Review
	 * board. The html arrives sanitized from the server (app/wikibook.py);
	 * this component only styles it and carries the CC BY-SA attribution. */
	import type { WikibookPage } from '$lib/api/client';

	interface Props {
		page: WikibookPage;
		/** True when a parent (the small-screen <details>) already provides
		 * the "Opening theory" heading — skips the panel's own header. */
		embedded?: boolean;
	}

	let { page, embedded = false }: Props = $props();

	// Fresh page, fresh scroll — otherwise stepping to the next move leaves
	// the reader mid-way down the previous page's prose.
	let proseEl = $state<HTMLElement | null>(null);
	$effect(() => {
		void page.ply;
		if (proseEl) proseEl.scrollTop = 0;
	});
</script>

<section
	class="flex min-h-0 flex-col rounded-xs border border-line bg-card"
	data-testid="wikibook-panel"
>
	<header
		class="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 {embedded
			? 'hidden'
			: ''}"
	>
		<svg
			class="shrink-0 text-accent"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.7"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M2 4h6a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H2z" />
			<path d="M22 4h-6a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H22z" />
		</svg>
		<h2 class="text-xs font-semibold tracking-[0.09em] text-ink uppercase">Opening theory</h2>
	</header>

	<div
		bind:this={proseEl}
		class="wikibook-prose max-h-96 min-h-0 overflow-y-auto px-3 py-2.5 text-sm text-body xl:max-h-none xl:flex-1"
	>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized server-side -->
		{@html page.html}
	</div>

	<footer class="shrink-0 border-t border-line px-3 py-1.5 text-[11px] text-muted">
		From
		<a
			href={page.url}
			target="_blank"
			rel="noopener"
			class="text-accent underline decoration-accent-line underline-offset-2 hover:decoration-solid"
		>
			Chess Opening Theory on WikiBooks
		</a>
		· CC BY-SA
	</footer>
</section>

<style>
	/* The injected markup can't carry utility classes, so the prose look is
	   defined here against the theme tokens (dark mode included for free). */
	.wikibook-prose :global(h2),
	.wikibook-prose :global(h3),
	.wikibook-prose :global(h4),
	.wikibook-prose :global(h5),
	.wikibook-prose :global(h6) {
		margin: 1rem 0 0.35rem;
		font-weight: 600;
		color: var(--color-ink);
	}
	.wikibook-prose :global(h2) {
		font-size: 0.95rem;
	}
	.wikibook-prose :global(h3),
	.wikibook-prose :global(h4),
	.wikibook-prose :global(h5),
	.wikibook-prose :global(h6) {
		font-size: 0.85rem;
	}
	.wikibook-prose :global(:first-child) {
		margin-top: 0;
	}
	.wikibook-prose :global(p),
	.wikibook-prose :global(blockquote),
	.wikibook-prose :global(ul),
	.wikibook-prose :global(ol),
	.wikibook-prose :global(dl) {
		margin: 0 0 0.6rem;
		line-height: 1.55;
	}
	.wikibook-prose :global(ul),
	.wikibook-prose :global(ol) {
		padding-left: 1.1rem;
	}
	.wikibook-prose :global(ul) {
		list-style: disc;
	}
	.wikibook-prose :global(ol) {
		list-style: decimal;
	}
	.wikibook-prose :global(dd) {
		margin-left: 1.1rem;
	}
	.wikibook-prose :global(blockquote) {
		padding-left: 0.75rem;
		border-left: 2px solid var(--color-line);
		color: var(--color-muted);
	}
	.wikibook-prose :global(a) {
		color: var(--color-accent);
		text-decoration: underline;
		text-decoration-color: var(--color-accent-line);
		text-underline-offset: 2px;
	}
	.wikibook-prose :global(a:hover) {
		text-decoration-color: var(--color-accent);
	}
	.wikibook-prose :global(sup) {
		font-size: 0.7em;
	}
	.wikibook-prose :global(code),
	.wikibook-prose :global(pre) {
		font-family: var(--font-mono, monospace);
		font-size: 0.85em;
	}
</style>
