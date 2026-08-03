<script lang="ts" module>
	/** Levels 1-5 content, supplied by the screen that knows the answer
	 * (Puzzles today; Play can join once it has motif data client-side). */
	export interface HintContent {
		/** Level 1 — category ("There's a tactic in this position"). */
		category: string;
		/** Level 2 — humanized motif name ("hanging piece"). */
		motif: string;
		/** Level 4 — the move to play, as SAN. */
		moveSan: string;
		/** Level 4 — one-line templated reason. */
		reason: string;
		/** Level 5 — the full solution line, as SANs. */
		line: string[];
	}
</script>

<script lang="ts">
	// Shared hint ladder (Play's Nudge mode / Puzzles). Levels 1-5 reveal one
	// rung at a time, never all at once, and only when `hint` content is
	// provided. The parent owns `level` (bindable) — it needs it to highlight
	// Level 3's squares on the board and to report hint usage with puzzle
	// attempts.
	interface Props {
		/** Ladder content for Levels 1-5. */
		hint?: HintContent | null;
		/** Highest level revealed so far (0-5). */
		level?: number;
		/** Own bordered card with its own heading (Puzzles), vs. bare rows meant
		 * to sit inside a host panel (Play's insight bar). */
		standalone?: boolean;
	}

	let { hint = null, level = $bindable(0), standalone = true }: Props = $props();

	const MAX_LEVEL = 5;
	const nextLabels: Record<number, string> = {
		0: 'Get a hint',
		1: 'What should I look for?',
		2: 'Show me where',
		3: 'Show me the move',
		4: 'Show the full line'
	};
</script>

{#snippet rungs(content: HintContent)}
	<ol class="flex flex-col gap-1.5">
		{#if level >= 1}
			<li data-testid="hint-level-1" class="rung text-body">{content.category}</li>
		{/if}
		{#if level >= 2}
			<li data-testid="hint-level-2" class="rung text-body">
				Look for a
				<span
					class="inline-flex items-center rounded-xs border border-accent-line px-2 py-0.5 text-[10px] font-semibold tracking-[0.09em] text-accent uppercase"
				>
					{content.motif}
				</span>
			</li>
		{/if}
		{#if level >= 3}
			<li data-testid="hint-level-3" class="rung text-body">
				The key squares are highlighted on the board.
			</li>
		{/if}
		{#if level >= 4}
			<li data-testid="hint-level-4" class="rung text-body">
				<span class="font-mono font-semibold">{content.moveSan}</span> — {content.reason}
			</li>
		{/if}
		{#if level >= 5}
			<li data-testid="hint-level-5" class="rung text-body">
				Full line: <span class="font-mono">{content.line.join(' ')}</span>
			</li>
		{/if}
	</ol>

	{#if level < MAX_LEVEL}
		<button
			data-testid="hint-reveal"
			onclick={() => (level += 1)}
			class="mt-2 w-full rounded-xs border border-accent-line px-3 py-1.5 text-xs font-semibold tracking-[0.07em] text-accent uppercase hover:bg-accent-soft"
		>
			{nextLabels[level]}
		</button>
	{/if}
{/snippet}

{#if hint}
	{#if standalone}
		<section class="rounded-xs border border-line bg-card p-3 text-sm" data-testid="hint-ladder">
			<h2 class="mb-2 flex items-baseline justify-between font-semibold text-ink">
				Hints
				<span class="text-xs font-normal text-faint">level {level}/{MAX_LEVEL}</span>
			</h2>
			{@render rungs(hint)}
		</section>
	{:else}
		<!-- Hosted: a labelled row matching the panel's Coach/Ideas rows. -->
		<div class="panel-row" data-testid="hint-ladder">
			<span class="panel-row-label" title="hint level {level}/{MAX_LEVEL}"> Tactic </span>
			<div class="min-w-0">{@render rungs(hint)}</div>
		</div>
	{/if}
{/if}

<style>
	/* A rung is the answer to a question the player just asked, and it used to
	 * arrive already in place — which reads as though it had been there all
	 * along, sitting on a button that silently relabelled itself underneath.
	 * Rising into place says a new one arrived, and says which one is new.
	 *
	 * @starting-style is doing the work that would otherwise need per-rung
	 * bookkeeping: it applies only to elements being inserted, so the rungs
	 * already on screen stay exactly where they are while the new one comes
	 * up. Revealing level 4 does not re-animate levels 1 through 3. */
	.rung {
		transition:
			opacity 200ms var(--ease-rise),
			transform 200ms var(--ease-rise);
	}

	@starting-style {
		.rung {
			transform: translateY(0.25rem);
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.rung {
			transition: opacity 150ms var(--ease-rise);
		}
	}
</style>
