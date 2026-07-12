<script lang="ts">
	import type { MoveRecord } from '$lib/api/client';
	import { EVAL_CLAMP_CP } from '$lib/classification';

	interface Props {
		moves: MoveRecord[];
		selectedPly: number;
		onselect: (ply: number) => void;
	}

	let { moves, selectedPly, onselect }: Props = $props();

	const W = 600;
	const H = 160;
	const PAD = 4;

	// x for ply p (0 = starting position, N = after the last move)
	const x = $derived((ply: number) => PAD + (ply / Math.max(1, moves.length)) * (W - 2 * PAD));

	function y(cp: number): number {
		const clamped = Math.max(-EVAL_CLAMP_CP, Math.min(EVAL_CLAMP_CP, cp));
		return H / 2 - (clamped / EVAL_CLAMP_CP) * (H / 2 - PAD);
	}

	/** Eval at ply p: 0 = before move 1, otherwise after move p. */
	const evalAt = $derived((ply: number): number | null => {
		if (ply === 0) return moves[0]?.eval_before ?? null;
		return moves[ply - 1]?.eval_after ?? null;
	});

	const points = $derived.by(() => {
		const pts: string[] = [];
		for (let ply = 0; ply <= moves.length; ply++) {
			const cp = evalAt(ply);
			if (cp !== null) pts.push(`${x(ply)},${y(cp)}`);
		}
		return pts.join(' ');
	});

	// Rough phase boundaries per the plan: opening → middlegame at ply 20,
	// middlegame → endgame at ply 60. Refine with real heuristics later.
	const phaseBoundaries = $derived([20, 60].filter((ply) => ply < moves.length));
</script>

<svg
	viewBox="0 0 {W} {H}"
	class="w-full rounded-xs border border-line bg-card"
	role="img"
	aria-label="Evaluation per move"
	data-testid="cpl-graph"
>
	<!-- zero line -->
	<line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2} stroke="#e0d6bf" stroke-width="1" />

	{#each phaseBoundaries as ply (ply)}
		<line
			x1={x(ply)}
			y1={PAD}
			x2={x(ply)}
			y2={H - PAD}
			stroke="#e0d6bf"
			stroke-width="1"
			stroke-dasharray="4 4"
		/>
	{/each}

	{#if points}
		<polyline {points} fill="none" stroke="#4a4238" stroke-width="1.5" />
	{/if}

	<!-- selected ply marker -->
	{#if selectedPly >= 1}
		{@const cp = evalAt(selectedPly)}
		<line
			x1={x(selectedPly)}
			y1={PAD}
			x2={x(selectedPly)}
			y2={H - PAD}
			stroke="#b5822e"
			stroke-width="1.5"
		/>
		{#if cp !== null}
			<circle cx={x(selectedPly)} cy={y(cp)} r="3.5" fill="#b5822e" />
		{/if}
	{/if}

	<!-- click-through: one invisible hit area per move -->
	{#each moves as move (move.ply)}
		<rect
			x={x(move.ply - 0.5)}
			y="0"
			width={x(1) - x(0)}
			height={H}
			fill="transparent"
			class="cursor-pointer"
			role="button"
			tabindex="-1"
			aria-label="Jump to move {move.ply}"
			onclick={() => onselect(move.ply)}
			onkeydown={(e) => e.key === 'Enter' && onselect(move.ply)}
		/>
	{/each}
</svg>
