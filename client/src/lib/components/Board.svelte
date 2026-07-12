<script lang="ts">
	import { onMount } from 'svelte';
	import { Chessground } from 'chessground';
	import type { Api } from 'chessground/api';
	import type { Color, Key } from 'chessground/types';
	import type { DrawShape } from 'chessground/draw';
	import 'chessground/assets/chessground.base.css';
	import '$lib/board.css';
	import '$lib/pieces.css';
	import { boardImageUrl } from '$lib/boardThemes';
	import { boardPrefs } from '$lib/stores/boardPrefs.svelte';

	interface Props {
		fen: string;
		turnColor: Color;
		/** Legal destinations; omit (with viewOnly) for a display-only board. */
		dests?: Map<Key, Key[]>;
		lastMove?: [Key, Key];
		/** Which side the user may move. undefined = none. */
		movableColor?: Color;
		orientation?: Color;
		viewOnly?: boolean;
		/** Engine/annotation arrows (e.g. best move vs played move on Review). */
		autoShapes?: DrawShape[];
		/** Bump to force a resync even when no prop changed — needed to snap
		 * a piece back after a legal-but-rejected move (wrong puzzle answer),
		 * where the FEN stays the same but chessground moved the piece. */
		syncKey?: number;
		/** Called when the user completes a move on the board. */
		onmove?: (orig: Key, dest: Key) => void;
	}

	let {
		fen,
		turnColor,
		dests,
		lastMove,
		movableColor,
		orientation = 'white',
		viewOnly = false,
		autoShapes = [],
		syncKey = 0,
		onmove
	}: Props = $props();

	let el: HTMLElement;
	let api: Api | undefined;

	function config() {
		return {
			fen,
			turnColor,
			lastMove,
			orientation,
			viewOnly,
			movable: {
				free: false,
				color: movableColor,
				dests: dests ?? new Map(),
				showDests: true
			}
		};
	}

	onMount(() => {
		// chessground is imperative, not component-driven: instantiate once,
		// then push state changes into it via api.set() (see $effect below).
		api = Chessground(el, {
			...config(),
			events: { move: (orig, dest) => onmove?.(orig, dest) }
		});
		api.setAutoShapes(autoShapes);
		return () => api?.destroy();
	});

	$effect(() => {
		void syncKey;
		api?.set(config());
		api?.setAutoShapes(autoShapes);
	});
</script>

<!-- Outer div owns the user's board prefs; chessground mutates the inner
     element's classes, so Svelte must never re-render attributes on it. -->
<div
	class="pieces-{boardPrefs.pieceSet} aspect-square w-full"
	style="--sq-lt: {boardPrefs.theme.light}; --sq-dk: {boardPrefs.theme
		.dark}; --board-image: {boardImageUrl(boardPrefs.theme)}"
>
	<div bind:this={el} class="h-full w-full"></div>
</div>
