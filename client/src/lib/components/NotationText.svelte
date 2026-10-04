<script lang="ts">
	import { linkNotation, type NotationTarget } from '$lib/notation';

	// Coaching prose with its chess notation set apart — moves and squares in
	// the board's own terms, each of which lights up on the board while the
	// player points at it (see $lib/notation for how they are found). The
	// screen owns the board, so this only reports what is being pointed at.
	interface Props {
		text: string;
		/** Positions the text's moves may be played in, most likely first. */
		fens: string[];
		/** The text is nothing but moves (a line), so bare squares are moves. */
		line?: boolean;
		/** The target under the pointer or focus, null when it leaves. */
		onhover?: (target: NotationTarget | null) => void;
	}

	let { text, fens, line = false, onhover }: Props = $props();

	const segments = $derived(linkNotation(text, fens, { line }));

	// A mouse points; a finger can't hover. Pointer events stand in for hover
	// with a mouse or pen, focus does for the keyboard, and a tap shows the
	// target until the next tap or move — pointerleave fires the moment a
	// finger lifts, so it is ignored for touch.
	function enter(event: PointerEvent, target: NotationTarget) {
		if (event.pointerType !== 'touch') onhover?.(target);
	}
	function leave(event: PointerEvent) {
		if (event.pointerType !== 'touch') onhover?.(null);
	}
	function tap(event: MouseEvent, target: NotationTarget) {
		if ((event as PointerEvent).pointerType === 'touch') onhover?.(target);
	}
</script>

<!-- One line (prettier-ignore): template whitespace between segments would
     render as stray spaces inside the prose. -->
<!-- prettier-ignore -->
{#each segments as segment, i (i)}{@const target = segment.target}{#if target}<button type="button" class="notation" data-testid="notation" onpointerenter={(event) => enter(event, target)} onpointerleave={leave} onfocus={() => onhover?.(target)} onblur={() => onhover?.(null)} onclick={(event) => tap(event, target)}>{segment.text}</button>{:else}{segment.text}{/if}{/each}

<style>
	.notation {
		display: inline;
		padding: 0 0.1em;
		margin: 0 -0.1em;
		border-radius: 2px;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-weight: 600;
		color: var(--color-ink);
		text-decoration: underline dotted var(--color-accent-line);
		text-underline-offset: 3px;
		cursor: default;
		transition: background-color 120ms var(--ease-rise);
	}

	.notation:hover,
	.notation:focus-visible {
		background-color: var(--color-accent-soft);
		text-decoration-color: var(--color-accent);
		text-decoration-style: solid;
	}

	.notation:focus-visible {
		outline: 2px solid var(--color-accent-line);
		outline-offset: 1px;
	}

	@media (prefers-reduced-motion: reduce) {
		.notation {
			transition: none;
		}
	}
</style>
