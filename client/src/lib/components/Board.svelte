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
		/** Called when the user completes a move on the board. For promotions,
		 * `promotion` is the piece letter (q/n/r/b) chosen in the picker. */
		onmove?: (orig: Key, dest: Key, promotion?: string) => void;
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

	/** A pawn just landed on the last rank: the move is held back until the
	 * user picks the promotion piece (or cancels, snapping the pawn back). */
	let pendingPromotion = $state<{ orig: Key; dest: Key; color: PieceColor } | null>(null);

	const PROMOTION_ROLES = [
		{ role: 'queen', letter: 'q' },
		{ role: 'knight', letter: 'n' },
		{ role: 'rook', letter: 'r' },
		{ role: 'bishop', letter: 'b' }
	] as const;

	function handleMove(orig: Key, dest: Key): void {
		// chessground has already moved the piece when this fires, so the pawn
		// itself is found on the destination square
		const piece = api?.state.pieces.get(dest);
		if (piece?.role === 'pawn' && (dest[1] === '8' || dest[1] === '1')) {
			pendingPromotion = { orig, dest, color: piece.color };
			return;
		}
		onmove?.(orig, dest);
	}

	function choosePromotion(letter: string): void {
		const pending = pendingPromotion;
		pendingPromotion = null;
		if (pending) onmove?.(pending.orig, pending.dest, letter);
	}

	function cancelPromotion(): void {
		pendingPromotion = null;
		api?.set(config()); // fen prop never changed — this snaps the pawn back
	}

	// picker geometry: the column sits on the destination file, growing from
	// the promotion square's edge of the board toward the middle
	const promotionLeftPct = $derived.by(() => {
		if (!pendingPromotion) return 0;
		const file = pendingPromotion.dest.charCodeAt(0) - 97; // a → 0
		return (orientation === 'white' ? file : 7 - file) * 12.5;
	});
	const promotionFromTop = $derived.by(() => {
		if (!pendingPromotion) return true;
		const rank = Number(pendingPromotion.dest[1]);
		return (orientation === 'white' ? 9 - rank : rank) === 1;
	});

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
			events: { move: (orig, dest) => handleMove(orig, dest) }
		});
		api.setAutoShapes(autoShapes);
		return () => api?.destroy();
	});

	$effect(() => {
		void syncKey;
		api?.set(config());
		api?.setAutoShapes(autoShapes);
	});

	$effect(() => {
		// the position changed under an open picker — its held-back move no
		// longer applies to the board
		void fen;
		pendingPromotion = null;
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
	<div class="relative aspect-square w-full">
		<div bind:this={el} class="h-full w-full"></div>
		{#if pendingPromotion}
			<div
				class="promo-backdrop"
				data-testid="promotion-backdrop"
				onclick={cancelPromotion}
				aria-hidden="true"
			></div>
			<div
				class="promo-column"
				class:from-bottom={!promotionFromTop}
				style="left: {promotionLeftPct}%"
				data-testid="promotion-picker"
				role="dialog"
				aria-label="Choose promotion piece"
			>
				{#each PROMOTION_ROLES as { role, letter } (role)}
					<button
						type="button"
						onclick={() => choosePromotion(letter)}
						data-testid="promote-{role}"
						aria-label="Promote to {role}"
					>
						<piece class="{role} {pendingPromotion.color}"></piece>
					</button>
				{/each}
			</div>
		{/if}
	</div>
	{@render eliminatedRow(bottomColor)}
</div>

<svelte:window
	onkeydown={(event) => {
		if (pendingPromotion && event.key === 'Escape') cancelPromotion();
	}}
/>

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

	.promo-backdrop {
		position: absolute;
		inset: 0;
		z-index: 10;
		background: rgb(0 0 0 / 30%);
	}

	.promo-column {
		position: absolute;
		top: 0;
		z-index: 11;
		display: flex;
		width: 12.5%;
		flex-direction: column;
		box-shadow: 0 2px 8px rgb(0 0 0 / 35%);
	}

	.promo-column.from-bottom {
		top: auto;
		bottom: 0;
		flex-direction: column-reverse;
	}

	.promo-column button {
		aspect-ratio: 1;
		width: 100%;
		border: 1px solid var(--color-line);
		background: var(--color-card);
		cursor: pointer;
	}

	.promo-column button:hover {
		background: var(--color-accent-soft);
	}

	.promo-column piece {
		display: block;
		width: 100%;
		height: 100%;
		background-position: center;
		background-repeat: no-repeat;
		background-size: 88%;
	}
</style>
