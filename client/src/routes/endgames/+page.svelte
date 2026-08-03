<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import AccountGate from '$lib/components/AccountGate.svelte';
	import Board from '$lib/components/Board.svelte';
	import { listDrills, type DrillRecord } from '$lib/api/client';
	import { describeOutcome, DrillSession, MOVE_CAP } from '$lib/stores/endgameDrill.svelte';
	// Aliased: `session` on this page already means the drill session.
	import { session as account } from '$lib/stores/session.svelte';
	import { dueLabel, familyLabel, isDue } from '$lib/endgames';

	const session = new DrillSession();

	// Leitner boxes 1-5, mirroring BOX_INTERVALS in server/app/spaced_repetition.py.
	const BOXES = [1, 2, 3, 4, 5];

	// Progress links here as /endgames?family=philidor.
	const familyFilter = $derived(page.url.searchParams.get('family'));

	/** The whole catalog with live Leitner state. `box` and `due_at` exist on
	 * every drill row but appear nowhere else in the UI — the queue only ever
	 * hands you one drill at a time, so this is where you see what you've
	 * built up and what's coming back. */
	let catalog = $state<DrillRecord[]>([]);

	function refreshCatalog() {
		listDrills()
			.then((drills) => (catalog = drills))
			.catch((e) => console.error('loading the drill catalog failed:', e));
	}

	function loadNext() {
		session.load(familyFilter);
	}

	$effect(() => {
		void familyFilter;
		// The catalog is per account: which drill comes next, and when it comes
		// back, is Leitner state an anonymous player has none of.
		if (account.anonymous) return;
		loadNext();
	});

	// Re-read after every finished attempt so the box and due date move in step.
	$effect(() => {
		void session.completedCount;
		if (account.anonymous) return;
		refreshCatalog();
	});

	onMount(() => () => session.suspend());

	const families = $derived([...new Set(catalog.map((drill) => drill.family))]);
	const dueCount = $derived(catalog.filter((drill) => isDue(drill.due_at)).length);

	const goalLabel = $derived(session.goal === 'win' ? 'Convert the win' : 'Hold the draw');
	const movableColor = $derived(session.userCanMove ? session.playerColor : undefined);
	const movesLeft = $derived(Math.max(0, MOVE_CAP - session.playerMoves));
</script>

<div class="mb-4 flex items-baseline justify-between">
	<h1 class="font-display text-2xl">
		Endgames
		{#if familyFilter}
			<span
				class="ml-2 inline-flex translate-y-[-3px] items-center rounded-xs border border-accent-line px-2 py-0.5 font-sans text-[10px] font-semibold tracking-[0.09em] text-accent uppercase"
			>
				{familyLabel(familyFilter)}
			</span>
		{/if}
	</h1>
	{#if !account.anonymous}
		<span class="text-sm text-muted" data-testid="drill-session-count">
			{session.completedCount} drilled this session
		</span>
	{/if}
</div>

{#snippet drillTable()}
	{#if catalog.length > 0}
		<section class="mt-8" data-testid="drill-catalog">
			<h2 class="mb-2 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
				Your drills — {dueCount} of {catalog.length} due
			</h2>
			<div class="rounded-xs border border-line bg-card">
				{#each families as family (family)}
					<div class="border-b border-line last:border-b-0">
						<p
							class="px-3 pt-3 pb-1 text-[10px] font-semibold tracking-[0.09em] text-muted uppercase"
						>
							{familyLabel(family)}
						</p>
						{#each catalog.filter((drill) => drill.family === family) as drill (drill.id)}
							<div
								class="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-3 py-1.5 text-sm {drill.id ===
								session.drill?.id
									? 'bg-accent-soft'
									: ''}"
								data-testid="drill-row"
							>
								<span class="truncate">{drill.name}</span>
								<span class="text-xs text-muted">
									{drill.goal === 'win' ? 'convert' : 'hold'}
								</span>
								<!-- Leitner box: 5 means the technique survived a 21-day gap -->
								<span class="flex gap-0.5" title="Leitner box {drill.box} of 5">
									{#each BOXES as level (level)}
										<span
											class="h-1.5 w-1.5 rounded-full {level <= drill.box
												? 'bg-accent'
												: 'bg-line'}"
										></span>
									{/each}
								</span>
								<span
									class="w-16 text-right text-xs tabular-nums {isDue(drill.due_at)
										? 'font-semibold text-accent'
										: 'text-muted'}"
								>
									{dueLabel(drill.due_at)}
								</span>
							</div>
						{/each}
					</div>
				{/each}
			</div>
		</section>
	{/if}
{/snippet}

{#if account.anonymous}
	<AccountGate
		what="Twelve curated positions — Lucena, Philidor, key squares, Vancura — played out against a full-strength engine, and scheduled to come back until the technique sticks."
	/>
{:else if session.status === 'empty'}
	<div class="max-w-xl rounded-xs border border-line bg-card p-4 text-sm text-muted">
		<p class="font-semibold text-ink">No drills due{familyFilter ? ' in this family' : ''}.</p>
		<p class="mt-1">
			Drills come back on the same Leitner schedule puzzles use — a technique you converted moves
			out to a longer interval, one you botched returns in ten minutes.
		</p>
	</div>
{:else if session.status === 'error'}
	<p class="text-sm break-all text-err">Failed to load a drill: {session.error}</p>
{:else if session.status === 'loading'}
	<p class="text-sm text-muted">Loading drill…</p>
{:else if session.drill}
	<div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
		<!-- data-fen lets the e2e suite read the live position and pick a legal
		     move; a drill has no scripted line for a test to replay. -->
		<div class="max-w-xl" data-testid="drill-board" data-fen={session.game.fen}>
			<Board
				fen={session.game.fen}
				turnColor={session.game.turnColor}
				dests={session.game.dests}
				lastMove={session.game.lastMove}
				{movableColor}
				orientation={session.playerColor}
				onmove={(orig, dest, promotion) => session.handleBoardMove(orig, dest, promotion)}
			/>
		</div>

		<aside class="flex flex-col gap-4">
			<section class="rounded-xs border border-line bg-card p-3 text-sm">
				<p class="text-[10px] font-semibold tracking-[0.09em] text-muted uppercase">
					{familyLabel(session.drill.family)}
				</p>
				<p class="mt-1 font-semibold" data-testid="drill-heading">{session.drill.name}</p>
				<p
					class="mt-2 inline-flex items-center rounded-xs border border-accent-line px-2 py-0.5 text-[10px] font-semibold tracking-[0.09em] text-accent uppercase"
					data-testid="drill-goal"
				>
					{goalLabel}
				</p>
				<p class="mt-2 text-muted">{session.drill.technique}</p>
				<p class="mt-2 font-semibold capitalize" data-testid="drill-side">
					You play {session.playerColor} · Stockfish at full strength
				</p>
			</section>

			{#if session.status === 'playing'}
				<section class="rounded-xs border border-line bg-card p-3 text-sm text-muted">
					{#if session.engineError}
						<div class="flex items-center justify-between gap-2 text-err">
							<span class="break-all">Engine stalled: {session.engineError}</span>
							<button
								data-testid="retry-engine"
								onclick={() => session.retryEngineMove()}
								class="shrink-0 rounded-xs border border-err-line px-2 py-0.5 text-xs hover:bg-err-line/40"
							>
								Retry
							</button>
						</div>
					{:else if session.engineThinking}
						<p>Stockfish is thinking…</p>
					{:else if !session.engineReady}
						<p>Warming up the engine…</p>
					{:else}
						<p>Your move. {movesLeft} moves left to show the technique.</p>
					{/if}
				</section>
			{:else}
				<div
					class="verdict rounded-xs border px-3 py-2 text-sm {session.status === 'won'
						? 'border-ok-line bg-ok-bg text-ok'
						: 'border-err-line bg-err-bg text-err'}"
					data-testid={session.status === 'won' ? 'drill-success' : 'drill-failed'}
				>
					<p class="font-semibold">
						{session.status === 'won'
							? session.goal === 'win'
								? 'Converted.'
								: 'Held.'
							: session.goal === 'win'
								? 'Not converted.'
								: 'Draw not held.'}
					</p>
					{#if session.outcome}
						<p class="mt-0.5">{describeOutcome(session.outcome, session.status === 'won')}</p>
					{/if}
					<p class="mt-0.5">
						{session.playerMoves} move{session.playerMoves === 1 ? '' : 's'} played.
					</p>
				</div>
				<div class="flex gap-2">
					<button
						data-testid="retry-drill"
						onclick={() => session.restart()}
						class="rounded-xs border border-line px-3 py-2 text-xs font-semibold tracking-[0.07em] text-muted uppercase hover:bg-line/40"
					>
						Try again
					</button>
					<button
						data-testid="next-drill"
						onclick={loadNext}
						class="rounded-xs border border-accent-line px-3 py-2 text-xs font-semibold tracking-[0.07em] text-accent uppercase hover:bg-accent-soft"
					>
						Next drill →
					</button>
				</div>
			{/if}
		</aside>
	</div>
{/if}

<!-- Always rendered, including the "nothing due" state — that's exactly when
     you want to see when each drill comes back. -->
{@render drillTable()}

<style>
	/* Converted / Held / Not converted — the verdict on a technique you just
	 * spent twenty moves trying to show. Same recipe as the puzzle verdict,
	 * because it is the same moment. */
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
