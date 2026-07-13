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
	import { linkMoves, linkWhy, type WhyAction } from '$lib/summaryLinks';

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
		if (citedShape) result.push(citedShape);
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
		if (!game) return;
		selectedPly = Math.min(Math.max(1, ply), game.moves.length);
		citedShape = null;
	}

	// Move references in the LLM texts ("4. Bc4") become board links.
	const summarySegments = $derived(game?.summary ? linkMoves(game.summary, game.moves) : []);
	const explanationSegments = $derived(
		game && selectedMove?.explanation
			? linkWhy(
					selectedMove.explanation,
					selectedMove.fen_before,
					selectedMove.fen_after,
					game.moves
				)
			: []
	);

	// Clicking a cited move/square in the "Why" text previews it on the board
	// as a blue arrow/circle; clicking again (or changing move) clears it.
	let citedShape = $state<DrawShape | null>(null);

	function citeWhy(action: WhyAction) {
		if (action.type === 'ply') {
			select(action.ply);
			return;
		}
		const shape: DrawShape =
			action.type === 'arrow'
				? { orig: action.from as Key, dest: action.to as Key, brush: 'blue' }
				: { orig: action.square as Key, brush: 'blue' };
		citedShape = citedShape?.orig === shape.orig && citedShape?.dest === shape.dest ? null : shape;
	}

	// ← / → scrub through the game like the Prev/Next buttons.
	function handleKeydown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.key === 'ArrowLeft') {
			select(selectedPly - 1);
			event.preventDefault();
		} else if (event.key === 'ArrowRight') {
			select(selectedPly + 1);
			event.preventDefault();
		}
	}

	// Keep the selected move visible in the move list. Manual scrollTop math
	// on the list only — scrollIntoView would also scroll the page itself.
	let moveListEl = $state<HTMLOListElement | null>(null);
	$effect(() => {
		const list = moveListEl;
		if (!list) return;
		const item = list.querySelector<HTMLElement>(`[data-ply="${selectedPly}"]`);
		if (!item) return;
		const top = item.offsetTop;
		const bottom = top + item.offsetHeight;
		if (top < list.scrollTop) list.scrollTop = top;
		else if (bottom > list.scrollTop + list.clientHeight)
			list.scrollTop = bottom - list.clientHeight;
	});

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

<svelte:window onkeydown={handleKeydown} />

{#if error}
	<p class="text-err">Failed to load game: {error}</p>
{:else if !game}
	<p class="text-muted">Loading game…</p>
{:else}
	<div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
		<h1 class="font-display text-2xl">Game #{game.id}</h1>
		<p class="text-sm text-muted">
			{game.white} vs {game.black} · {game.result} · {game.mode}
		</p>
		{#if game.analysis_status === 'complete'}
			<div class="flex flex-wrap items-center gap-3 sm:ml-auto">
				{#if practiceQueued !== null}
					<span class="text-sm text-ok" data-testid="practice-result">
						{practiceQueued} puzzle{practiceQueued === 1 ? '' : 's'} queued —
						<a class="underline" href={resolve('/puzzles')}>drill now</a>
					</span>
				{/if}
				{#if practiceError}
					<span class="text-sm break-all text-err">{practiceError}</span>
				{/if}
				<button
					data-testid="practice-misses"
					onclick={practice}
					class="rounded-xs border border-accent-line px-3 py-1.5 text-xs font-semibold tracking-[0.07em] text-accent uppercase hover:bg-accent-soft"
				>
					Practice these misses
				</button>
			</div>
		{/if}
	</div>

	{#if analyzing}
		<div
			class="mb-4 flex items-center gap-2 rounded-xs border border-info-line bg-info-bg px-3 py-2 text-sm text-info"
			data-testid="analysis-status"
		>
			<span
				class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-info border-t-transparent"
			></span>
			Analyzing with Stockfish… this page refreshes automatically.
		</div>
	{:else if game.analysis_status === 'failed'}
		<div class="mb-4 rounded-xs border border-err-line bg-err-bg px-3 py-2 text-sm text-err">
			Analysis failed — the raw moves are shown without evaluations.
		</div>
	{/if}

	<div class="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] md:gap-x-10">
		<div class="min-w-0">
			<!-- Cap the board by viewport height so board + controls + why panel
			     fit on screen without page scrolling (22rem ≈ the chrome above
			     and below the board). -->
			<div class="w-full" style="max-width: min(100%, clamp(20rem, 100dvh - 22rem, 36rem))">
				<Board fen={boardFen} turnColor={boardTurn} viewOnly autoShapes={shapes} />
			</div>

			<div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
				<button
					onclick={() => select(selectedPly - 1)}
					disabled={selectedPly <= 1}
					class="rounded-xs border border-line bg-card px-3 py-1 text-sm hover:bg-paper disabled:opacity-40"
				>
					← Prev
				</button>
				<button
					onclick={() => select(selectedPly + 1)}
					disabled={selectedPly >= game.moves.length}
					class="rounded-xs border border-line bg-card px-3 py-1 text-sm hover:bg-paper disabled:opacity-40"
				>
					Next →
				</button>
				{#if selectedMove}
					<span class="ml-1 text-sm text-body" data-testid="selected-move">
						{Math.ceil(selectedMove.ply / 2)}{selectedMove.ply % 2 ? '.' : '…'}
						<span class="font-semibold">{selectedMove.san}</span>
						{#if selectedMove.classification}
							<ClassificationBadge classification={selectedMove.classification as Classification} />
						{/if}
					</span>
				{/if}
				{#if selectedMove?.best_move && bestDiffers}
					<span class="text-sm text-body" data-testid="best-move-hint">
						— best was
						<span class="font-mono font-semibold text-ok">
							{uciToSan(selectedMove.fen_before, selectedMove.best_move)}
						</span>
					</span>
				{/if}
			</div>

			{#if selectedMove && selectedMove.motifs.length > 0}
				<div class="mt-2 flex flex-wrap items-center gap-1.5" data-testid="motif-tags">
					<span class="text-sm text-muted">Motifs:</span>
					{#each selectedMove.motifs as motif (motif)}
						<span
							class="inline-flex items-center rounded-xs border border-accent-line px-2 py-0.5 text-[10px] font-semibold tracking-[0.09em] text-accent uppercase"
						>
							{motif.replaceAll('_', ' ')}
						</span>
					{/each}
				</div>
			{/if}

			{#if selectedMove?.explanation}
				<div
					class="mt-3 rounded-xs border border-warn-line bg-warn-bg p-3 text-sm text-body"
					data-testid="why-panel"
				>
					<h2 class="mb-1 text-xs font-semibold tracking-wide text-warn uppercase">Why</h2>
					<!-- One line (prettier-ignore) — template whitespace between
					     segments would render as stray spaces in the prose. -->
					<!-- prettier-ignore -->
					<p>{#each explanationSegments as segment, i (i)}{@const action = segment.action}{#if action === null}{segment.text}{:else}<button onclick={() => citeWhy(action)} class="cursor-pointer font-semibold text-warn underline decoration-warn-line decoration-dotted underline-offset-2 hover:decoration-solid">{segment.text}</button>{/if}{/each}</p>
				</div>
			{/if}

			{#if game.summary}
				<section
					class="mt-3 rounded-xs border border-accent-line bg-accent-soft p-3 text-sm text-body"
					data-testid="coach-summary"
				>
					<h2 class="mb-1 text-xs font-semibold tracking-wide text-accent uppercase">
						Coach’s takeaways
					</h2>
					<!-- Kept on one line (prettier-ignore) — any template whitespace
					     between segments would render as stray spaces inside the
					     whitespace-pre-line prose. -->
					<!-- prettier-ignore -->
					<p class="whitespace-pre-line">{#each summarySegments as segment, i (i)}{@const ply = segment.ply}{#if ply === null}{segment.text}{:else}<button onclick={() => select(ply)} class="cursor-pointer font-semibold text-accent underline decoration-accent-line decoration-dotted underline-offset-2 hover:decoration-solid">{segment.text}</button>{/if}{/each}</p>
				</section>
			{/if}
		</div>

		<!-- Everything that pairs with the board lives in one viewport-height
		     sidebar; the move list is the only thing that scrolls. -->
		<aside
			class="flex min-w-0 flex-col gap-3 md:sticky md:top-4 md:max-h-[calc(100dvh-2rem)] md:self-start"
		>
			<div class="shrink-0">
				<CplGraph moves={game.moves} {selectedPly} onselect={select} />
			</div>

			<section class="flex min-h-0 flex-col rounded-xs border border-line bg-card p-3 md:flex-1">
				<h2 class="mb-2 shrink-0 text-sm font-semibold text-ink">
					Moves ({game.moves.length} plies)
				</h2>
				<ol
					bind:this={moveListEl}
					class="relative max-h-96 min-h-0 overflow-y-auto text-sm md:max-h-none md:flex-1"
					data-testid="move-list"
				>
					{#each movePairs as pair (pair.number)}
						<li class="grid grid-cols-[2rem_1fr_1fr] gap-1 py-0.5">
							<span class="text-faint">{pair.number}.</span>
							{#each [pair.white, pair.black] as move, i (i)}
								<span>
									{#if move}
										<button
											onclick={() => select(move.ply)}
											data-ply={move.ply}
											class="flex w-full items-center gap-1.5 rounded-xs px-1 text-left hover:bg-paper {selectedPly ===
											move.ply
												? 'bg-warn-bg font-semibold'
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
													class="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
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

			{#if summary}
				<table class="w-full shrink-0 text-xs" data-testid="game-summary">
					<thead>
						<tr class="text-left text-muted">
							<th class="py-1 font-normal"></th>
							<th class="py-1 font-normal" title="Average centipawn loss">avg CPL</th>
							<th class="py-1 font-normal" title="Inaccuracies">Inacc</th>
							<th class="py-1 font-normal" title="Mistakes">Mist</th>
							<th class="py-1 font-normal" title="Blunders">Blund</th>
						</tr>
					</thead>
					<tbody>
						{#each sideNames as side (side)}
							<tr class="border-t border-line">
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
		</aside>
	</div>
{/if}
