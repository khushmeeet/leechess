<script lang="ts">
	import { onMount } from 'svelte';
	import { Chessground } from 'chessground';
	import type { Api } from 'chessground/api';
	import type { Key } from 'chessground/types';
	import 'chessground/assets/chessground.base.css';
	import 'chessground/assets/chessground.brown.css';
	import 'chessground/assets/chessground.cburnett.css';

	interface Props {
		fen: string;
		turnColor: 'white' | 'black';
		dests: Map<Key, Key[]>;
		lastMove?: [Key, Key];
		/** Called when the user completes a move on the board. */
		onmove: (orig: Key, dest: Key) => void;
	}

	let { fen, turnColor, dests, lastMove, onmove }: Props = $props();

	let el: HTMLElement;
	let api: Api | undefined;

	onMount(() => {
		// chessground is imperative, not component-driven: instantiate once,
		// then push state changes into it via api.set() (see $effect below).
		api = Chessground(el, {
			fen,
			turnColor,
			lastMove,
			movable: { free: false, color: turnColor, dests, showDests: true },
			events: { move: (orig, dest) => onmove(orig, dest) }
		});
		return () => api?.destroy();
	});

	$effect(() => {
		api?.set({
			fen,
			turnColor,
			lastMove,
			movable: { free: false, color: turnColor, dests, showDests: true }
		});
	});
</script>

<div bind:this={el} class="aspect-square w-full"></div>
