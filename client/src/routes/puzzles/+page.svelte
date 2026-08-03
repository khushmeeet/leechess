<script lang="ts">
	import type { DrawShape } from 'chessground/draw';
	import type { Key } from 'chessground/types';
	import { page } from '$app/state';
	import AccountGate from '$lib/components/AccountGate.svelte';
	import Board from '$lib/components/Board.svelte';
	import HintLadder, { type HintContent } from '$lib/components/HintLadder.svelte';
	import { humanizeMotif, motifReason } from '$lib/motifs';
	import { PuzzleSession } from '$lib/stores/puzzle.svelte';
	// Aliased: `session` on this page already means the puzzle session.
	import { session as account } from '$lib/stores/session.svelte';

	const session = new PuzzleSession();

	// Progress screen (Phase 4) links here as /puzzles?motif=fork.
	const motifFilter = $derived(page.url.searchParams.get('motif'));

	function loadNext() {
		session.load(motifFilter);
	}

	$effect(() => {
		void motifFilter;
		// A puzzle is drawn from a queue that is scheduled per account, and
		// attempting one writes to it. Without an account there is no queue to
		// draw from, so nothing is asked for.
		if (account.anonymous) return;
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
	<h1 class="font-display text-2xl">
		Puzzles
		{#if motifFilter}
			<span
				class="ml-2 inline-flex translate-y-[-3px] items-center rounded-xs border border-accent-line px-2 py-0.5 font-sans text-[10px] font-semibold tracking-[0.09em] text-accent uppercase"
			>
				{humanizeMotif(motifFilter)}
			</span>
		{/if}
	</h1>
	{#if !account.anonymous}
		<span class="text-sm text-muted" data-testid="session-count">
			{session.completedCount} completed this session
		</span>
	{/if}
</div>

{#if account.anonymous}
	<AccountGate
		what="Your own blunders, turned into positions to drill and scheduled by Leitner box — ten minutes, a day, three days, a week, three weeks — plus the generic Lichess pool."
	/>
{:else if session.status === 'empty'}
	<div class="max-w-xl rounded-xs border border-line bg-card p-4 text-sm text-muted">
		<p class="font-semibold text-ink">
			No puzzles due{motifFilter ? ' for this motif' : ''}.
		</p>
		<p class="mt-1">
			Play a game — analysis queues your missed tactics automatically. The generic Lichess pool
			seeds itself in the background at server startup — check back in a few minutes.
		</p>
	</div>
{:else if session.status === 'error'}
	<p class="text-sm break-all text-err">Failed to load a puzzle: {session.error}</p>
{:else if session.status === 'loading'}
	<p class="text-sm text-muted">Loading puzzle…</p>
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
				onmove={(orig, dest, promotion) => session.handleBoardMove(orig, dest, promotion)}
			/>
		</div>

		<aside class="flex flex-col gap-4">
			<section class="rounded-xs border border-line bg-card p-3 text-sm">
				<p class="font-semibold" data-testid="puzzle-heading">Puzzle #{session.puzzle.id}</p>
				<p class="mt-1 text-muted">
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
					class="verdict rounded-xs border border-ok-line bg-ok-bg px-3 py-2 text-sm text-ok"
					data-testid="puzzle-correct"
				>
					<p class="font-semibold">Correct!</p>
					{#if session.wrong || session.hintLevel > 0}
						<p class="mt-0.5">
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
					class="rounded-xs border border-accent-line px-3 py-2 text-xs font-semibold tracking-[0.07em] text-accent uppercase hover:bg-accent-soft"
				>
					Next puzzle →
				</button>
			{:else}
				{#if session.wrong}
					<div
						class="verdict flex items-center justify-between gap-2 rounded-xs border border-err-line bg-err-bg px-3 py-2 text-sm text-err"
						data-testid="puzzle-retry"
					>
						<span>Not quite — try again.</span>
						<button
							data-testid="reveal-answer"
							onclick={() => session.revealAnswer()}
							class="shrink-0 rounded-xs border border-err-line px-2 py-0.5 text-xs hover:bg-err-line/40"
						>
							Reveal answer
						</button>
					</div>
				{/if}

				<HintLadder {hint} bind:level={session.hintLevel} />
			{/if}
		</aside>
	</div>
{/if}

<style>
	/* "Correct!" and "Not quite" are the beat this whole screen exists for, and
	 * both used to blink into the column flat. They rise in instead.
	 *
	 * Deliberately no confetti, and not for want of an excuse: the app spends
	 * that budget once, on the game-result banner, and it is worth spending
	 * there precisely because it is rare. Firing it on every solved puzzle —
	 * dozens in a sitting — would spend down the one place it means something. */
	.verdict {
		transition:
			opacity 240ms var(--ease-rise),
			transform 240ms var(--ease-rise);
	}

	@starting-style {
		.verdict {
			transform: translateY(0.25rem) scale(0.98);
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.verdict {
			transition: opacity 160ms var(--ease-rise);
		}
	}
</style>
