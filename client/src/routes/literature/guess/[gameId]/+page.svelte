<script lang="ts">
	import type { DrawShape } from 'chessground/draw';
	import type { Key } from 'chessground/types';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { getGuessSummary, type GuessSummary } from '$lib/api/client';
	import Board from '$lib/components/Board.svelte';
	import { guessRecordText } from '$lib/guess';
	import { GuessRunRecorder } from '$lib/guessRuns';
	import { GAMES } from '$lib/literature/games';
	import { GuessSession } from '$lib/stores/guess.svelte';
	// Aliased: `session` in this file is the guessing session.
	import { session as account } from '$lib/stores/session.svelte';

	// Guess the move through a landmark game: the winner's side by default,
	// the other on request. Literature's games were only ever read; this is
	// the way to think through them (see $lib/guess for the scoring).
	const game = $derived(GAMES.find((candidate) => candidate.id === page.params.gameId) ?? null);

	let side = $state<'white' | 'black' | null>(null);
	const playing = $derived(side ?? (game?.result === '0-1' ? 'black' : 'white'));
	// Each run is saved to the account as it goes (anonymous play keeps
	// nothing). Checked when a guess is scored rather than here, so the
	// sign-in state settling can never restart a run under way.
	const session = $derived.by(() => {
		if (!game) return null;
		const recorder = new GuessRunRecorder(game.id, playing);
		return new GuessSession(
			game.pgn,
			playing,
			playing === 'white' ? game.white : game.black,
			(totals) => {
				if (!account.authenticated) return;
				void recorder.record(totals).then(() => {
					if (totals.finished) loadRecord();
				});
			}
		);
	});

	// The saved runs at this game, for "your best" beside the score.
	let summaries = $state<GuessSummary[]>([]);
	function loadRecord(): void {
		if (!account.authenticated) return;
		getGuessSummary()
			.then((fetched) => (summaries = fetched))
			.catch(() => {});
	}
	$effect(() => {
		if (account.authenticated) loadRecord();
	});
	const record = $derived(
		summaries.find((summary) => summary.game_id === game?.id && summary.side === playing) ?? null
	);

	const shapes = $derived.by((): DrawShape[] => {
		const feedback = session?.feedback;
		if (!session || session.status !== 'revealed' || !feedback) return [];
		const arrows: DrawShape[] = [];
		if (feedback.guess && feedback.guess.uci !== feedback.master.uci) {
			arrows.push({
				orig: feedback.guess.uci.slice(0, 2) as Key,
				dest: feedback.guess.uci.slice(2, 4) as Key,
				brush: 'paleBlue'
			});
		}
		arrows.push({
			orig: feedback.master.uci.slice(0, 2) as Key,
			dest: feedback.master.uci.slice(2, 4) as Key,
			brush: 'green'
		});
		return arrows;
	});

	const turnColor = $derived(session?.fen.split(' ')[1] === 'b' ? 'black' : 'white');
</script>

{#if !game || !session}
	<p class="text-sm text-muted">
		No such game. <a class="text-accent underline" href={resolve('/literature')}
			>Back to Literature</a
		>
	</p>
{:else}
	<div class="mb-4 flex flex-wrap items-baseline justify-between gap-3">
		<div>
			<h1 class="font-display text-2xl" data-testid="guess-heading">
				Guess the move: {game.title}
			</h1>
			<p class="text-sm text-muted">
				{game.white} <span class="text-faint">vs</span>
				{game.black} · {game.year}
			</p>
		</div>
		<div class="flex rounded-xs border border-line bg-card text-sm" role="group" aria-label="Side">
			{#each ['white', 'black'] as const as option (option)}
				<button
					type="button"
					aria-pressed={playing === option}
					data-testid="guess-side-{option}"
					onclick={() => (side = option)}
					class="px-3 py-1 capitalize first:rounded-l-xs last:rounded-r-xs {playing === option
						? 'bg-ink font-semibold text-paper'
						: 'text-muted hover:bg-paper'}"
				>
					{option === 'white' ? game.white : game.black}
				</button>
			{/each}
		</div>
	</div>

	<div class="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_minmax(260px,320px)] md:gap-x-10">
		<div class="w-full" style="max-width: min(100%, clamp(20rem, 100dvh - 14rem, 36rem))">
			<Board
				fen={session.fen}
				{turnColor}
				dests={session.status === 'guessing' ? session.dests : undefined}
				lastMove={session.lastMove}
				movableColor={session.status === 'guessing' ? playing : undefined}
				orientation={playing}
				autoShapes={shapes}
				onmove={(orig, dest, promotion) => session.guess(orig, dest, promotion)}
			/>
		</div>

		<aside class="flex flex-col gap-3 text-sm">
			<section class="rounded-xs border border-line bg-card p-3" data-testid="guess-panel">
				{#if session.status === 'done'}
					<p class="font-semibold text-ink" data-testid="guess-done">
						Game over: {session.points} of {session.maxPoints} points.
					</p>
					<p class="mt-1 text-body">
						You found {session.matched} of {session.guessed}
						{session.player}'s moves exactly. A different move that keeps the same chances scores
						nearly as well — the game is a guide, not an answer key.
					</p>
				{:else if session.status === 'revealed' && session.feedback}
					<p class="text-body" data-testid="guess-feedback">{session.feedback.text}</p>
					<button
						type="button"
						data-testid="guess-next"
						onclick={() => session.next()}
						class="mt-2 rounded-xs border border-accent-line px-2 py-0.5 text-xs font-semibold text-accent hover:bg-accent-soft"
					>
						Next move →
					</button>
				{:else}
					<p class="text-body" data-testid="guess-prompt">
						<span class="font-semibold text-ink">Move {session.moveLabel}</span>
						{session.status === 'weighing'
							? 'Weighing your move against the game’s…'
							: `What did ${session.player} play? Make your move on the board.`}
					</p>
					<button
						type="button"
						data-testid="guess-skip"
						disabled={session.status !== 'guessing'}
						onclick={() => session.skip()}
						class="mt-2 rounded-xs border border-line px-2 py-0.5 text-xs font-semibold text-ink hover:bg-paper disabled:opacity-40"
					>
						Show the move
					</button>
				{/if}
			</section>
			<p class="text-xs text-muted" data-testid="guess-score">
				{session.points} / {session.maxPoints} points · {session.matched} exact
			</p>
			{#if record}
				<p class="text-xs text-body" data-testid="guess-record">
					{guessRecordText(record, session.player)}
				</p>
			{/if}
			<p class="text-xs text-muted">
				Each guess is weighed by the engine against the move actually played: 5 points for the same
				move or one as good, less the further your winning chances fall short.
			</p>
			<a class="text-xs text-accent hover:underline" href="{resolve('/literature')}#games"
				>← All landmark games</a
			>
		</aside>
	</div>
{/if}
