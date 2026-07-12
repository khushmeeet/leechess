<script lang="ts">
	import MiniBoard from '$lib/components/MiniBoard.svelte';
	import { ERAS } from '$lib/literature/history';
	import { GAMES } from '$lib/literature/games';
	import { CATEGORY_LABELS, TERMS, type TermCategory } from '$lib/literature/terms';

	let query = $state('');
	let category = $state<TermCategory | 'all'>('all');

	const CATEGORIES = Object.keys(CATEGORY_LABELS) as TermCategory[];

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return TERMS.filter(
			(t) =>
				(category === 'all' || t.category === category) &&
				(q === '' || t.term.toLowerCase().includes(q) || t.def.toLowerCase().includes(q))
		);
	});

	// Preserve the fixed category order regardless of how TERMS is arranged.
	const grouped = $derived(
		CATEGORIES.map((c) => ({
			category: c,
			terms: filtered.filter((t) => t.category === c)
		})).filter((g) => g.terms.length > 0)
	);

	const chipClass = (active: boolean) =>
		`rounded-xs border px-2 py-0.5 text-[10px] font-semibold tracking-[0.09em] uppercase ${
			active
				? 'border-accent-line bg-accent-soft text-accent'
				: 'border-line text-muted hover:text-ink'
		}`;
</script>

<div class="mb-1 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
	<h1 class="font-display text-2xl">Literature</h1>
	<nav class="flex gap-4 text-[10px] font-semibold tracking-[0.09em] uppercase">
		<a class="text-muted hover:text-accent" href="#terms">Terminology</a>
		<a class="text-muted hover:text-accent" href="#history">History</a>
		<a class="text-muted hover:text-accent" href="#games">Landmark games</a>
	</nav>
</div>
<p class="mb-8 max-w-2xl text-sm text-muted">
	The language, the history, and the games every student of the board inherits. Each entry links the
	source it was written against — follow the ↗ to read further.
</p>

<section id="terms" class="scroll-mt-6">
	<div class="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
		<h2 class="font-display text-xl">Terminology</h2>
		<input
			data-testid="term-search"
			type="search"
			placeholder="Search {TERMS.length} terms…"
			bind:value={query}
			class="w-60 rounded-xs border border-line bg-card px-3 py-1.5 text-sm placeholder:text-faint focus:border-accent-line focus:outline-none"
		/>
	</div>

	<div class="mt-3 flex flex-wrap gap-1.5">
		<button
			class={chipClass(category === 'all')}
			aria-pressed={category === 'all'}
			onclick={() => (category = 'all')}
		>
			All
		</button>
		{#each CATEGORIES as c (c)}
			<button
				data-testid="term-filter-{c}"
				class={chipClass(category === c)}
				aria-pressed={category === c}
				onclick={() => (category = c)}
			>
				{CATEGORY_LABELS[c]}
			</button>
		{/each}
	</div>

	{#if grouped.length === 0}
		<p class="mt-6 text-sm text-muted">
			No terms match “{query}”. Try another word, or clear the search.
		</p>
	{/if}

	{#each grouped as group (group.category)}
		<h3 class="mt-6 mb-2 text-[10px] font-semibold tracking-[0.09em] text-accent uppercase">
			{CATEGORY_LABELS[group.category]}
		</h3>
		<div class="columns-1 gap-10 md:columns-2">
			{#each group.terms as t (t.term)}
				<p
					class="mb-2.5 break-inside-avoid text-sm leading-relaxed text-body"
					data-testid="term-entry"
				>
					<span class="font-semibold text-ink">{t.term}</span> — {t.def}
					<a
						class="text-faint hover:text-accent"
						href={t.source}
						target="_blank"
						rel="noopener noreferrer"
						aria-label="Source for {t.term}">↗</a
					>
				</p>
			{/each}
		</div>
	{/each}
</section>

<section id="history" class="mt-12 scroll-mt-6">
	<h2 class="border-b border-line pb-3 font-display text-xl">A short history</h2>
	<ol>
		{#each ERAS as era (era.period)}
			<li
				class="grid gap-1 border-b border-line py-5 md:grid-cols-[160px_1fr] md:gap-6"
				data-testid="history-era"
			>
				<div class="font-display text-lg text-accent">{era.period}</div>
				<div>
					<h3 class="font-semibold text-ink">{era.title}</h3>
					<p class="mt-1 text-sm leading-relaxed text-body">{era.body}</p>
					<a
						class="mt-1.5 inline-block text-xs text-faint hover:text-accent"
						href={era.source}
						target="_blank"
						rel="noopener noreferrer">{era.sourceTitle} ↗</a
					>
				</div>
			</li>
		{/each}
	</ol>
</section>

<section id="games" class="mt-12 scroll-mt-6">
	<div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3">
		<h2 class="font-display text-xl">Landmark games</h2>
		<span class="text-xs text-muted">Diagrams show each game’s final position</span>
	</div>
	<div class="mt-5 grid gap-6 md:grid-cols-2">
		{#each GAMES as game (game.id)}
			<article class="rounded-xs border border-line bg-card p-4" data-testid="game-card">
				<div class="flex items-baseline justify-between gap-3">
					<h3 class="font-display text-lg">{game.title}</h3>
					<span class="font-display text-lg text-accent">{game.year}</span>
				</div>
				<p class="mt-0.5 text-sm text-ink">
					{game.white} <span class="text-faint">vs</span>
					{game.black}
					<span class="ml-1 font-mono text-xs text-muted"
						>{game.result === '1-0' ? '1–0' : '0–1'}</span
					>
				</p>
				<p class="text-xs text-muted">{game.event}</p>
				<div class="mx-auto mt-3 max-w-[280px]">
					<MiniBoard fen={game.finalFen} label="Final position of {game.title}" />
				</div>
				<p class="mt-3 text-sm leading-relaxed text-body">{game.why}</p>
				<details class="mt-2">
					<summary
						class="cursor-pointer text-[10px] font-semibold tracking-[0.09em] text-accent uppercase"
					>
						Moves
					</summary>
					<p class="mt-2 font-mono text-xs leading-relaxed break-words text-body">{game.pgn}</p>
				</details>
				<a
					class="mt-2 inline-block text-xs text-faint hover:text-accent"
					href={game.source}
					target="_blank"
					rel="noopener noreferrer">{game.sourceTitle} ↗</a
				>
			</article>
		{/each}
	</div>
</section>

<p class="mt-12 border-t border-line pt-4 text-xs leading-relaxed text-faint">
	Definitions and summaries are original text written for this app against the sources linked on
	each entry — chiefly Wikipedia’s chess articles and the FIDE Laws of Chess. Game scores are
	historical records, machine-checked for legality and verified against the cited articles.
</p>
