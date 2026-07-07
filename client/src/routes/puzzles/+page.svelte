<script lang="ts">
	import type { DrawShape } from 'chessground/draw';
	import type { Key } from 'chessground/types';
	import { page } from '$app/state';
	import Board from '$lib/components/Board.svelte';
	import HintLadder, { type HintContent } from '$lib/components/HintLadder.svelte';
	import { humanizeMotif, motifReason } from '$lib/motifs';
	import { PuzzleSession } from '$lib/stores/puzzle.svelte';

	const session = new PuzzleSession();
	let nudgeDismissed = $state(false);

	// Progress screen (Phase 4) links here as /puzzles?motif=fork.
	const motifFilter = $derived(page.url.searchParams.get('motif'));

	function loadNext() {
		nudgeDismissed = false;
		session.load(motifFilter);
	}

	$effect(() => {
		void motifFilter;
		loadNext();
	});

	// Ladder content: only while solving — once solved the banner takes over.
	const hint = $derived.by((): HintContent | null => {
		const puzzle = session.puzzle;
		const next = session.nextPlayerMove;
		if (!puzzle || session.status !== 'solving' || !next) return null;
		return {
			category: 'There’s a tactic in this position.',
			motif: humanizeMotif(puzzle.motif),
			moveSan: next.san,
			reason: motifReason(puzzle.motif, next.san),
			line: session.solutionSans
		};
	});

	// Level 3: circle the piece to move and its target square; Level 4+
	// (move revealed in text) upgrades to an arrow.
	const shapes = $derived.by((): DrawShape[] => {
		const next = session.nextPlayerMove;
		if (!next || session.status !== 'solving') return [];
		const from = next.uci.slice(0, 2) as Key;
		const to = next.uci.slice(2, 4) as Key;
		if (session.hintLevel >= 4) {
			return [{ orig: from, dest: to, brush: 'green' }];
		}
		if (session.hintLevel === 3) {
			return [
				{ orig: from, brush: 'green' },
				{ orig: to, brush: 'blue' }
			];
		}
		return [];
	});

	const turnColor = $derived(
		session.fen.split(' ')[1] === 'b' ? ('black' as const) : ('white' as const)
	);
	const movableColor = $derived(session.status === 'solving' ? session.playerColor : undefined);
</script>

<div class="mb-4 flex items-baseline justify-between">
	<h1 class="text-lg font-semibold">
		Puzzles
		{#if motifFilter}
			<span
				class="ml-2 inline-flex items-center rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-800"
			>
				{humanizeMotif(motifFilter)}
			</span>
		{/if}
	</h1>
	<span class="text-sm text-stone-500" data-testid="session-count">
		{session.completedCount} completed this session
	</span>
</div>

{#if session.status === 'empty'}
	<div class="max-w-xl rounded-md border border-stone-300 bg-white p-4 text-sm text-stone-600">
		<p class="font-semibold text-stone-800">
			No puzzles due{motifFilter ? ' for this motif' : ''}.
		</p>
		<p class="mt-1">
			Play a game — analysis queues your missed tactics automatically. For a generic pool, run the
			Lichess import (<span class="font-mono">server/scripts/import_lichess_puzzles.py</span>).
		</p>
	</div>
{:else if session.status === 'error'}
	<p class="text-sm break-all text-red-700">Failed to load a puzzle: {session.error}</p>
{:else if session.status === 'loading'}
	<p class="text-sm text-stone-500">Loading puzzle…</p>
{:else if session.puzzle}
	<div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
		<div class="max-w-xl">
			<Board
				fen={session.fen}
				{turnColor}
				dests={session.dests}
				lastMove={session.lastMove}
				{movableColor}
				orientation={session.orientation}
				autoShapes={shapes}
				syncKey={session.boardSyncKey}
				onmove={(orig, dest) => session.handleBoardMove(orig, dest)}
			/>
		</div>

		<aside class="flex flex-col gap-4">
			<section class="rounded-md border border-stone-300 bg-white p-3 text-sm">
				<p class="font-semibold" data-testid="puzzle-heading">Puzzle #{session.puzzle.id}</p>
				<p class="mt-1 text-stone-500">
					{#if session.puzzle.source_move_id !== null}
						From your own game — find what the analysis flagged.
					{:else}
						Lichess puzzle{session.puzzle.difficulty ? ` · rated ${session.puzzle.difficulty}` : ''}
					{/if}
				</p>
				<p class="mt-1 font-semibold capitalize" data-testid="puzzle-turn">
					{session.playerColor} to move
				</p>
			</section>

			{#if session.status === 'solved'}
				<div
					class="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900"
					data-testid="puzzle-correct"
				>
					<p class="font-semibold">Correct!</p>
					{#if session.wrong || session.hintLevel > 0}
						<p class="mt-0.5 text-green-800">
							{session.wrong
								? 'Got there after a retry'
								: `Solved with ${session.hintLevel} hint level${session.hintLevel === 1 ? '' : 's'}`}
							— it'll come back around sooner.
						</p>
					{/if}
				</div>
				<button
					data-testid="next-puzzle"
					onclick={loadNext}
					class="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-stone-50"
				>
					Next puzzle →
				</button>
			{:else}
				{#if session.wrong}
					<div
						class="flex items-center justify-between gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
						data-testid="puzzle-retry"
					>
						<span>Not quite — try again.</span>
						<button
							data-testid="reveal-answer"
							onclick={() => session.revealAnswer()}
							class="shrink-0 rounded border border-red-300 px-2 py-0.5 text-xs hover:bg-red-100"
						>
							Reveal answer
						</button>
					</div>
				{/if}

				<HintLadder
					nudgeVisible={!nudgeDismissed}
					ondismiss={() => (nudgeDismissed = true)}
					{hint}
					bind:level={session.hintLevel}
				/>
			{/if}
		</aside>
	</div>
{/if}
