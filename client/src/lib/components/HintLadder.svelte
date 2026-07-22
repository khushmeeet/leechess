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
	// Shared hint ladder (Play / Review / Puzzles). Levels 1-5 reveal one rung
	// at a time, never all at once, and only when `hint` content is provided.
	// The parent owns `level` (bindable) — it needs it to highlight Level 3's
	// squares on the board and to report hint usage with puzzle attempts.
	//
	// Play adds a Level 0 `nudge`: the always-shown "Checks, captures, threats?"
	// pre-move prompt, dismissable per move (reset when `nudgeKey` changes). It's
	// independent of the tactic ladder — the nudge can show with no `hint` (a
	// quiet position), and Play's "nudge-only" mode caps reveals via `maxLevel`.
	// Puzzles/Review pass neither, so their behaviour is unchanged.
	interface Props {
		/** Ladder content for Levels 1-5. */
		hint?: HintContent | null;
		/** Highest level revealed so far (0-5). */
		level?: number;
		/** Level 0 pre-move prompt; null hides the nudge banner entirely. */
		nudge?: string | null;
		/** Bumps to re-show a dismissed nudge (e.g. the current ply). */
		nudgeKey?: number;
		/** Cap on how far the reveal ladder goes (1 = nudge-only). */
		maxLevel?: number;
	}

	let {
		hint = null,
		level = $bindable(0),
		nudge = null,
		nudgeKey = 0,
		maxLevel = 5
	}: Props = $props();

	// Dismissal is keyed on the ply: a new nudgeKey means a new move, so the
	// dismissed prompt reappears without the parent tracking any state.
	let dismissedKey = $state<number | null>(null);
	const nudgeVisible = $derived(nudge !== null && dismissedKey !== nudgeKey);

	const cap = $derived(Math.min(maxLevel, 5));
	const nextLabels: Record<number, string> = {
		0: 'Get a hint',
		1: 'What should I look for?',
		2: 'Show me where',
		3: 'Show me the move',
		4: 'Show the full line'
	};
</script>

{#if hint || nudgeVisible}
	<section class="rounded-xs border border-line bg-card p-3 text-sm" data-testid="hint-ladder">
		<h2 class="mb-2 flex items-baseline justify-between font-semibold text-ink">
			Hints
			{#if hint}
				<span class="text-xs font-normal text-faint">level {level}/{cap}</span>
			{/if}
		</h2>

		{#if nudgeVisible}
			<div
				class="mb-2 flex items-center justify-between gap-2 rounded-xs border border-accent-line bg-accent-soft px-2.5 py-1.5"
				data-testid="hint-nudge"
			>
				<span class="text-body">{nudge}</span>
				<button
					type="button"
					aria-label="Dismiss nudge"
					data-testid="hint-nudge-dismiss"
					onclick={() => (dismissedKey = nudgeKey)}
					class="shrink-0 rounded-xs px-1 text-faint hover:text-ink"
				>
					×
				</button>
			</div>
		{/if}

		{#if hint}
			<ol class="flex flex-col gap-1.5">
				{#if level >= 1}
					<li data-testid="hint-level-1" class="text-body">{hint.category}</li>
				{/if}
				{#if level >= 2}
					<li data-testid="hint-level-2" class="text-body">
						Look for a
						<span
							class="inline-flex items-center rounded-xs border border-accent-line px-2 py-0.5 text-[10px] font-semibold tracking-[0.09em] text-accent uppercase"
						>
							{hint.motif}
						</span>
					</li>
				{/if}
				{#if level >= 3}
					<li data-testid="hint-level-3" class="text-body">
						The key squares are highlighted on the board.
					</li>
				{/if}
				{#if level >= 4}
					<li data-testid="hint-level-4" class="text-body">
						<span class="font-mono font-semibold">{hint.moveSan}</span> — {hint.reason}
					</li>
				{/if}
				{#if level >= 5}
					<li data-testid="hint-level-5" class="text-body">
						Full line: <span class="font-mono">{hint.line.join(' ')}</span>
					</li>
				{/if}
			</ol>

			{#if level < cap}
				<button
					data-testid="hint-reveal"
					onclick={() => (level += 1)}
					class="mt-2 w-full rounded-xs border border-accent-line px-3 py-1.5 text-xs font-semibold tracking-[0.07em] text-accent uppercase hover:bg-accent-soft"
				>
					{nextLabels[level]}
				</button>
			{/if}
		{/if}
	</section>
{/if}
