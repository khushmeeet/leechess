<script lang="ts">
	import { onMount } from 'svelte';
	import { Chessground } from 'chessground';
	import type { Api } from 'chessground/api';
	import type { Color, Key } from 'chessground/types';
	import type { DrawShape } from 'chessground/draw';
	import 'chessground/assets/chessground.base.css';
	import 'chessground/assets/chessground.brown.css';
	import 'chessground/assets/chessground.cburnett.css';

	interface Props {
		fen: string;
		turnColor: Color;
		/** Legal destinations; omit (with viewOnly) for a display-only board. */
		dests?: Map<Key, Key[]>;
		lastMove?: [Key, Key];
		/** Which side the user may move ('both' for pass-and-play). undefined = none. */
		movableColor?: Color | 'both';
		orientation?: Color;
		viewOnly?: boolean;
		/** Engine/annotation arrows (e.g. best move vs played move on Review). */
		autoShapes?: DrawShape[];
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
		api?.set(config());
		api?.setAutoShapes(autoShapes);
	});
</script>

<div bind:this={el} class="aspect-square w-full"></div>
