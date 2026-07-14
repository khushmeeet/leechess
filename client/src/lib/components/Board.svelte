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

	type PieceColor = 'white' | 'black';
	type PieceRole = 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
	type PieceCounts = Record<PieceRole, number>;

	const INITIAL_COUNTS: PieceCounts = {
		queen: 1,
		rook: 2,
		bishop: 2,
		knight: 2,
		pawn: 8
	};
	const FEN_ROLES: Record<string, PieceRole | undefined> = {
		q: 'queen',
		r: 'rook',
		b: 'bishop',
		n: 'knight',
		p: 'pawn'
	};

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

	const eliminated = $derived.by((): Record<PieceColor, PieceRole[]> => {
		const remaining: Record<PieceColor, PieceCounts> = {
			white: { queen: 0, rook: 0, bishop: 0, knight: 0, pawn: 0 },
			black: { queen: 0, rook: 0, bishop: 0, knight: 0, pawn: 0 }
		};

		for (const symbol of fen.split(' ')[0]) {
			const role = FEN_ROLES[symbol.toLowerCase()];
			if (!role) continue;
			const color = symbol === symbol.toUpperCase() ? 'white' : 'black';
			remaining[color][role] += 1;
		}

		return Object.fromEntries(
			(['white', 'black'] as const).map((color) => [
				color,
				(Object.keys(INITIAL_COUNTS) as PieceRole[]).flatMap((role) =>
					Array.from(
						{ length: Math.max(0, INITIAL_COUNTS[role] - remaining[color][role]) },
						() => role
					)
				)
			])
		) as Record<PieceColor, PieceRole[]>;
	});

	const topColor = $derived<PieceColor>(orientation === 'white' ? 'black' : 'white');
	const bottomColor = $derived<PieceColor>(orientation);

	function eliminatedLabel(color: PieceColor): string {
		const pieces = eliminated[color];
		return `${color === 'white' ? 'White' : 'Black'} eliminated pieces: ${pieces.length ? pieces.join(', ') : 'none'}`;
	}

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

{#snippet eliminatedRow(color: PieceColor)}
	<div
		class="eliminated-row"
		data-testid="eliminated-{color}"
		role="group"
		aria-label={eliminatedLabel(color)}
	>
		<span class="side-label">{color}</span>
		<div class="eliminated-pieces" aria-hidden="true">
			{#each eliminated[color] as role, index (`${role}-${index}`)}
				<piece class="eliminated-piece {role} {color}"></piece>
			{/each}
		</div>
	</div>
{/snippet}

<!-- Outer div owns the user's board prefs; chessground mutates the inner
     element's classes, so Svelte must never re-render attributes on it. -->
<div
	class="pieces-{boardPrefs.pieceSet} w-full"
	style="--sq-lt: {boardPrefs.theme.light}; --sq-dk: {boardPrefs.theme
		.dark}; --board-image: {boardImageUrl(boardPrefs.theme)}"
>
	{@render eliminatedRow(topColor)}
	<div class="aspect-square w-full">
		<div bind:this={el} class="h-full w-full"></div>
	</div>
	{@render eliminatedRow(bottomColor)}
</div>

<style>
	.eliminated-row {
		display: flex;
		height: 1.75rem;
		align-items: center;
		gap: 0.375rem;
		overflow: hidden;
	}

	.side-label {
		display: flex;
		width: 2.75rem;
		height: 100%;
		flex: none;
		align-items: center;
		color: var(--color-muted);
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0.09em;
		line-height: 1;
		text-transform: uppercase;
	}

	.eliminated-pieces {
		display: flex;
		min-width: 0;
		height: 1.375rem;
		align-items: center;
		gap: 0.125rem;
		line-height: 0;
	}

	.eliminated-piece {
		display: block;
		width: clamp(0.9375rem, 4vw, 1.25rem);
		height: clamp(0.9375rem, 4vw, 1.25rem);
		flex: none;
		background-position: center bottom;
		background-repeat: no-repeat;
		background-size: 94% 94%;
	}

	:global(:root.dark) .eliminated-piece.black {
		filter: drop-shadow(0.045rem 0 0 var(--sq-lt)) drop-shadow(-0.045rem 0 0 var(--sq-lt))
			drop-shadow(0 0.045rem 0 var(--sq-lt)) drop-shadow(0 -0.045rem 0 var(--sq-lt));
	}
</style>
