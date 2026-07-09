<script lang="ts">
	import { Chess } from 'chess.js';
	import type { Key } from 'chessground/types';
	import type { DrawShape } from 'chessground/draw';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { getReview, practiceGame, type GameDetail, type MoveRecord } from '$lib/api/client';
	import type { Classification } from '$lib/classification';
	import Board from '$lib/components/Board.svelte';
	import ClassificationBadge from '$lib/components/ClassificationBadge.svelte';
	import CplGraph from '$lib/components/CplGraph.svelte';

	let game = $state<GameDetail | null>(null);
	let error = $state<string | null>(null);
	let selectedPly = $state(1);

	const analyzing = $derived(
		game !== null && (game.analysis_status === 'pending' || game.analysis_status === 'analyzing')
	);

	// Fetch, then poll every 1.5s while the analysis job is still running.
	$effect(() => {
		const gameId = page.params.gameId!;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let cancelled = false;

		async function load() {
			try {
				const fetched = await getReview(gameId);
				if (cancelled) return;
				game = fetched;
				error = null;
				const status = fetched.analysis_status;
				if (status === 'pending' || status === 'analyzing') {
					timer = setTimeout(load, 1500);
				}
			} catch (e) {
				if (!cancelled) error = e instanceof Error ? e.message : String(e);
			}
		}

		load();
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	});

	const selectedMove = $derived(game?.moves[selectedPly - 1] ?? null);

	/** SAN → orig/dest squares, derived on the position before the move. */
	function sanToKeys(fenBefore: string, san: string): [Key, Key] | null {
		try {
			const move = new Chess(fenBefore).move(san);
			return [move.from as Key, move.to as Key];
		} catch {
			return null;
		}
	}

	function uciToSan(fenBefore: string, uci: string): string {
		try {
			const chess = new Chess(fenBefore);
			const move = chess.move({
				from: uci.slice(0, 2),
				to: uci.slice(2, 4),
				promotion: uci[4] ?? undefined
			});
			return move.san;
		} catch {
			return uci;
		}
	}

	/** True when the engine's best move differs from what was played. */
	const bestDiffers = $derived.by(() => {
		if (!selectedMove?.best_move) return false;
		const played = sanToKeys(selectedMove.fen_before, selectedMove.san);
		const best = selectedMove.best_move;
		return played !== null && played[0] + played[1] !== best.slice(0, 4);
	});

	// Board shows the position where the decision was made, with the played
	// move and (when it differs) the engine's best move as arrows.
	const shapes = $derived.by((): DrawShape[] => {
		if (!selectedMove) return [];
		const result: DrawShape[] = [];
		const played = sanToKeys(selectedMove.fen_before, selectedMove.san);
		if (played) {
			result.push({ orig: played[0], dest: played[1], brush: bestDiffers ? 'red' : 'green' });
		}
		if (bestDiffers && selectedMove.best_move) {
			result.push({
				orig: selectedMove.best_move.slice(0, 2) as Key,
				dest: selectedMove.best_move.slice(2, 4) as Key,
				brush: 'green'
			});
		}
		return result;
	});

	const boardFen = $derived(
		selectedMove?.fen_before ?? game?.moves[0]?.fen_before ?? '8/8/8/8/8/8/8/8 w - - 0 1'
	);
	const boardTurn = $derived(
		boardFen.split(' ')[1] === 'b' ? ('black' as const) : ('white' as const)
	);

	const movePairs = $derived.by(() => {
		if (!game) return [];
		const pairs: { number: number; white: MoveRecord; black?: MoveRecord }[] = [];
		for (let i = 0; i < game.moves.length; i += 2) {
			pairs.push({ number: i / 2 + 1, white: game.moves[i], black: game.moves[i + 1] });
		}
		return pairs;
	});

	/** Mistake/blunder/inaccuracy counts and average centipawn loss per side. */
	const summary = $derived.by(() => {
		if (!game) return null;
		const sides = {
			white: { count: 0, totalLoss: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
			black: { count: 0, totalLoss: 0, inaccuracy: 0, mistake: 0, blunder: 0 }
		};
		for (const move of game.moves) {
			if (move.eval_before === null || move.eval_after === null) return null;
			const isWhite = move.ply % 2 === 1;
			const side = sides[isWhite ? 'white' : 'black'];
			side.count += 1;
			side.totalLoss += Math.max(
				0,
				isWhite ? move.eval_before - move.eval_after : move.eval_after - move.eval_before
			);
			const c = move.classification;
			if (c === 'inaccuracy' || c === 'mistake' || c === 'blunder') side[c] += 1;
		}
		return {
			white: {
				...sides.white,
				avgCpl: sides.white.count ? sides.white.totalLoss / sides.white.count : 0
			},
			black: {
				...sides.black,
				avgCpl: sides.black.count ? sides.black.totalLoss / sides.black.count : 0
			}
		};
	});

	function select(ply: number) {
		if (game) selectedPly = Math.min(Math.max(1, ply), game.moves.length);
	}

	// "Practice these misses" — this game's puzzles become due immediately.
	let practiceQueued = $state<number | null>(null);
	let practiceError = $state<string | null>(null);

	async function practice() {
		if (!game) return;
		try {
			practiceQueued = (await practiceGame(game.id)).queued;
			practiceError = null;
		} catch (e) {
			practiceError = e instanceof Error ? e.message : String(e);
		}
	}

	const sideNames = ['white', 'black'] as const;
</script>

{#if error}
	<p class="text-red-700">Failed to load game: {error}</p>
{:else if !game}
	<p class="text-stone-500">Loading game…</p>
{:else}
	<h1 class="mb-1 text-lg font-semibold">Game #{game.id}</h1>
	<p class="mb-4 text-sm text-stone-500">
		{game.white} vs {game.black} · {game.result} · {game.mode}
	</p>

	{#if analyzing}
		<div
			class="mb-4 flex items-center gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900"
			data-testid="analysis-status"
		>
			<span
				class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-sky-600 border-t-transparent"
			></span>
			Analyzing with Stockfish… this page refreshes automatically.
		</div>
	{:else if game.analysis_status === 'failed'}
		<div class="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
			Analysis failed — the raw moves are shown without evaluations.
		</div>
	{/if}

	<div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
		<div class="max-w-xl">
			<Board fen={boardFen} turnColor={boardTurn} viewOnly autoShapes={shapes} />

			<div class="mt-2 flex items-center gap-2">
				<button
					onclick={() => select(selectedPly - 1)}
					disabled={selectedPly <= 1}
					class="rounded-md border border-stone-300 bg-white px-3 py-1 text-sm hover:bg-stone-50 disabled:opacity-40"
				>
					← Prev
				</button>
				<button
					onclick={() => select(selectedPly + 1)}
					disabled={selectedPly >= game.moves.length}
					class="rounded-md border border-stone-300 bg-white px-3 py-1 text-sm hover:bg-stone-50 disabled:opacity-40"
				>
					Next →
				</button>
				{#if selectedMove}
					<span class="ml-2 text-sm text-stone-600" data-testid="selected-move">
						{Math.ceil(selectedMove.ply / 2)}{selectedMove.ply % 2 ? '.' : '…'}
						<span class="font-semibold">{selectedMove.san}</span>
						{#if selectedMove.classification}
							<ClassificationBadge classification={selectedMove.classification as Classification} />
						{/if}
					</span>
				{/if}
			</div>

			{#if selectedMove?.best_move && bestDiffers}
				<p class="mt-2 text-sm text-stone-600" data-testid="best-move-hint">
					You played <span class="font-mono font-semibold">{selectedMove.san}</span> — best was
					<span class="font-mono font-semibold text-green-700">
						{uciToSan(selectedMove.fen_before, selectedMove.best_move)}
					</span>
				</p>
			{/if}

			{#if selectedMove && selectedMove.motifs.length > 0}
				<div class="mt-2 flex flex-wrap items-center gap-1.5" data-testid="motif-tags">
					<span class="text-sm text-stone-500">Motifs:</span>
					{#each selectedMove.motifs as motif (motif)}
						<span
							class="inline-flex items-center rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-800"
						>
							{motif.replaceAll('_', ' ')}
						</span>
					{/each}
				</div>
			{/if}

			{#if selectedMove?.explanation}
				<div
					class="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-stone-800"
					data-testid="why-panel"
				>
					<h2 class="mb-1 text-xs font-semibold tracking-wide text-amber-800 uppercase">Why</h2>
					<p>{selectedMove.explanation}</p>
				</div>
			{/if}

			<div class="mt-4">
				<CplGraph moves={game.moves} {selectedPly} onselect={select} />
			</div>

			{#if summary}
				<table class="mt-4 w-full max-w-md text-sm" data-testid="game-summary">
					<thead>
						<tr class="text-left text-stone-500">
							<th class="py-1 font-normal"></th>
							<th class="py-1 font-normal">avg CPL</th>
							<th class="py-1 font-normal">Inaccuracies</th>
							<th class="py-1 font-normal">Mistakes</th>
							<th class="py-1 font-normal">Blunders</th>
						</tr>
					</thead>
					<tbody>
						{#each sideNames as side (side)}
							<tr class="border-t border-stone-200">
								<td class="py-1 font-semibold capitalize">{side} ({game[side]})</td>
								<td class="py-1 font-mono">{summary[side].avgCpl.toFixed(0)}</td>
								<td class="py-1">{summary[side].inaccuracy}</td>
								<td class="py-1">{summary[side].mistake}</td>
								<td class="py-1">{summary[side].blunder}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}

			{#if game.analysis_status === 'complete'}
				<div class="mt-4 flex flex-wrap items-center gap-3">
					<button
						data-testid="practice-misses"
						onclick={practice}
						class="rounded-md border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-800 hover:bg-violet-100"
					>
						Practice these misses
					</button>
					{#if practiceQueued !== null}
						<span class="text-sm text-green-700" data-testid="practice-result">
							{practiceQueued} puzzle{practiceQueued === 1 ? '' : 's'} queued —
							<a class="underline" href={resolve('/puzzles')}>drill now</a>
						</span>
					{/if}
					{#if practiceError}
						<span class="text-sm break-all text-red-700">{practiceError}</span>
					{/if}
				</div>
			{/if}
		</div>

		<aside>
			<section class="rounded-md border border-stone-300 bg-white p-3">
				<h2 class="mb-2 text-sm font-semibold text-stone-700">Moves ({game.moves.length} plies)</h2>
				<ol class="max-h-[28rem] overflow-y-auto text-sm" data-testid="move-list">
					{#each movePairs as pair (pair.number)}
						<li class="grid grid-cols-[2rem_1fr_1fr] gap-1 py-0.5">
							<span class="text-stone-400">{pair.number}.</span>
							{#each [pair.white, pair.black] as move, i (i)}
								<span>
									{#if move}
										<button
											onclick={() => select(move.ply)}
											class="flex w-full items-center gap-1.5 rounded px-1 text-left hover:bg-stone-100 {selectedPly ===
											move.ply
												? 'bg-amber-100 font-semibold'
												: ''}"
										>
											{move.san}
											{#if move.classification}
												<ClassificationBadge
													classification={move.classification as Classification}
													compact
												/>
											{/if}
											{#if move.motifs.length > 0}
												<span
													class="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500"
													title={move.motifs.join(', ').replaceAll('_', ' ')}
												></span>
											{/if}
										</button>
									{/if}
								</span>
							{/each}
						</li>
					{/each}
				</ol>
			</section>
		</aside>
	</div>
{/if}
