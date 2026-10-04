<script lang="ts">
	import type { LineMove } from '$lib/lines';
	import type { NotationTarget } from '$lib/notation';
	import type { Square } from 'chess.js';

	// A line of moves ("21. Bxc8 Raxc8 22. Qxf5") the player can step through:
	// clicking a move asks the screen to show the position after it, and
	// pointing at one reports it like the notation in coaching text does, so
	// the board can light up the piece that moves.
	interface Props {
		moves: LineMove[];
		/** Index of the move whose position is on the board, if any. */
		active?: number | null;
		onpick?: (index: number) => void;
		onhover?: (target: NotationTarget | null) => void;
		testid?: string;
	}

	let { moves, active = null, onpick, onhover, testid = 'move-line' }: Props = $props();

	function target(move: LineMove): NotationTarget {
		return {
			kind: 'move',
			from: move.uci.slice(0, 2) as Square,
			to: move.uci.slice(2, 4) as Square
		};
	}
</script>

<span
	class="inline-flex flex-wrap gap-x-1 align-baseline font-mono text-[13px] leading-6"
	data-testid={testid}
>
	{#each moves as move, i (i)}
		<span class="whitespace-nowrap">
			{#if move.number}<span class="text-faint">{move.number}</span>{/if}<button
				type="button"
				class="line-move {active === i ? 'active' : ''}"
				data-testid="line-move"
				aria-pressed={active === i}
				onclick={() => onpick?.(i)}
				onpointerenter={() => onhover?.(target(move))}
				onpointerleave={() => onhover?.(null)}
				onfocus={() => onhover?.(target(move))}
				onblur={() => onhover?.(null)}>{move.san}</button
			>
		</span>
	{/each}
</span>

<style>
	.line-move {
		padding: 0 0.15em;
		border-radius: 2px;
		font-weight: 600;
		color: var(--color-ink);
		cursor: pointer;
	}

	.line-move:hover,
	.line-move:focus-visible {
		background-color: var(--color-accent-soft);
	}

	.line-move:focus-visible {
		outline: 2px solid var(--color-accent-line);
		outline-offset: 1px;
	}

	.line-move.active {
		background-color: var(--color-ink);
		color: var(--color-paper);
	}
</style>
