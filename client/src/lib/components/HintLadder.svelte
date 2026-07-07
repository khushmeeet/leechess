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
	// Shared hint ladder (Play / Review / Puzzles). Level 0 is the always-
	// shown pre-move nudge; Levels 1-5 reveal one rung at a time, never all
	// at once, and only when `hint` content is provided. The parent owns
	// `level` (bindable) — it needs it to highlight Level 3's squares on the
	// board and to report hint usage with puzzle attempts.
	interface Props {
		/** Level 0 nudge visibility — the parent re-shows it after every opponent move. */
		nudgeVisible: boolean;
		ondismiss: () => void;
		/** Ladder content for Levels 1-5; omit for nudge-only usage (Play). */
		hint?: HintContent | null;
		/** Highest level revealed so far (0-5). */
		level?: number;
	}

	let { nudgeVisible, ondismiss, hint = null, level = $bindable(0) }: Props = $props();

	const MAX_LEVEL = 5;
	const nextLabels: Record<number, string> = {
		0: 'Get a hint',
		1: 'What should I look for?',
		2: 'Show me where',
		3: 'Show me the move',
		4: 'Show the full line'
	};
</script>

{#if nudgeVisible}
	<div
		role="status"
		class="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
	>
		<span>Checks, captures, threats?</span>
		<button
			onclick={ondismiss}
			aria-label="Dismiss hint"
			class="rounded px-1.5 text-amber-700 hover:bg-amber-100"
		>
			✕
		</button>
	</div>
{/if}

{#if hint}
	<section
		class="rounded-md border border-stone-300 bg-white p-3 text-sm"
		data-testid="hint-ladder"
	>
		<h2 class="mb-2 flex items-baseline justify-between font-semibold text-stone-700">
			Hints
			<span class="text-xs font-normal text-stone-400">level {level}/{MAX_LEVEL}</span>
		</h2>

		<ol class="flex flex-col gap-1.5">
			{#if level >= 1}
				<li data-testid="hint-level-1" class="text-stone-700">{hint.category}</li>
			{/if}
			{#if level >= 2}
				<li data-testid="hint-level-2" class="text-stone-700">
					Look for a
					<span
						class="inline-flex items-center rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-800"
					>
						{hint.motif}
					</span>
				</li>
			{/if}
			{#if level >= 3}
				<li data-testid="hint-level-3" class="text-stone-700">
					The key squares are highlighted on the board.
				</li>
			{/if}
			{#if level >= 4}
				<li data-testid="hint-level-4" class="text-stone-700">
					<span class="font-mono font-semibold">{hint.moveSan}</span> — {hint.reason}
				</li>
			{/if}
			{#if level >= 5}
				<li data-testid="hint-level-5" class="text-stone-700">
					Full line: <span class="font-mono">{hint.line.join(' ')}</span>
				</li>
			{/if}
		</ol>

		{#if level < MAX_LEVEL}
			<button
				data-testid="hint-reveal"
				onclick={() => (level += 1)}
				class="mt-2 w-full rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50"
			>
				{nextLabels[level]}
			</button>
		{/if}
	</section>
{/if}
