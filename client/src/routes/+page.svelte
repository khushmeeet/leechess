<script lang="ts">
	import { onMount } from 'svelte';
	import Board from '$lib/components/Board.svelte';
	import ClassificationBadge from '$lib/components/ClassificationBadge.svelte';
	import EvalBar from '$lib/components/EvalBar.svelte';
	import InsightBar from '$lib/components/InsightBar.svelte';
	import { coachAdvice } from '$lib/coach';
	import { describeIdea, type Idea } from '$lib/ideas';
	import { displayPrefs } from '$lib/stores/displayPrefs.svelte';
	import { PlaySession } from '$lib/stores/play.svelte';
	import { usernamePrefs } from '$lib/stores/username.svelte';
	import { resolve } from '$app/paths';
	import type { DrawShape } from 'chessground/draw';
	import type { Key } from 'chessground/types';

	const session = new PlaySession();
	const game = session.game;

	onMount(() => {
		// leaving mid-game keeps it: the game is persisted locally and restored
		// on the next visit (PlaySession constructor), until resigned or
		// replaced by a new game; suspend stops this session's late async work
		// from clobbering the one the next visit creates
		session.start().catch((error) => console.error('engine warmup failed:', error));
		return () => session.suspend();
	});

	// candidate lines are only trusted for the position they were computed on —
	// a user move mid-search leaves them stale until the next eval lands
	const freshLines = $derived(session.ideas?.fen === game.fen ? session.ideas.lines : null);

	const candidateIdeas = $derived.by(() => {
		if (!freshLines) return [];
		return freshLines
			.filter(Boolean)
			.map((line) => describeIdea(game.fen, line.pvUci[0]))
			.filter((idea): idea is Idea => idea !== null)
			.slice(0, 3);
	});

	const coachText = $derived.by(() => {
		if (game.isGameOver) return 'Good game — open the review for the full analysis.';
		if (!freshLines) return null;
		return coachAdvice({
			fen: game.fen,
			ply: game.moves.length,
			evalCp: session.currentEval,
			lastUserClassification: session.lastFeedback?.classification ?? null,
			bestMoveSan: candidateIdeas[0]?.san ?? null,
			userColor: session.playerColor,
			inBook: session.opening?.inBook ?? false
		});
	});

	let hoverUci = $state<string | null>(null);
	const boardShapes = $derived<DrawShape[]>(
		hoverUci
			? [{ orig: hoverUci.slice(0, 2) as Key, dest: hoverUci.slice(2, 4) as Key, brush: 'green' }]
			: []
	);

	const strengthPresets = [
		{ skill: 1, label: 'Beginner' },
		{ skill: 3, label: 'Casual' },
		{ skill: 5, label: 'Club' },
		{ skill: 10, label: 'Strong' },
		{ skill: 20, label: 'Max' }
	];

	const movableColor = $derived(game.isGameOver ? undefined : session.playerColor);
	let moveListElement = $state<HTMLOListElement | null>(null);

	const movePairs = $derived.by(() => {
		const pairs: {
			number: number;
			white: { san: string; ply: number };
			black?: { san: string; ply: number };
		}[] = [];
		for (let i = 0; i < game.moves.length; i += 2) {
			pairs.push({
				number: i / 2 + 1,
				white: { san: game.moves[i].san, ply: i + 1 },
				black: game.moves[i + 1] ? { san: game.moves[i + 1].san, ply: i + 2 } : undefined
			});
		}
		return pairs;
	});

	$effect(() => {
		void movePairs.length; // tracked so the list re-scrolls on every move
		requestAnimationFrame(() => {
			if (moveListElement) moveListElement.scrollTop = moveListElement.scrollHeight;
		});
	});
</script>

<div class="flex flex-col gap-4">
	<div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
		<div class="relative flex max-w-xl self-start">
			{#if displayPrefs.showEvalBar}
				<div class="absolute inset-y-0 right-full mr-2 w-14">
					<EvalBar cp={session.currentEval} />
				</div>
			{/if}
			<div class="min-w-0 flex-1">
				<Board
					fen={game.fen}
					turnColor={game.turnColor}
					dests={game.dests}
					lastMove={game.lastMove}
					{movableColor}
					autoShapes={boardShapes}
					onmove={(orig, dest) => session.handleBoardMove(orig, dest)}
				/>
			</div>
		</div>

		<aside class="flex flex-col gap-4">
			<section class="rounded-xs border border-line bg-card p-3 text-sm">
				<div class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
					<label for="strength" class="text-muted">Strength</label>
					<select
						id="strength"
						bind:value={session.engineSkill}
						disabled={session.started}
						class="rounded-xs border border-line bg-card px-2 py-1 disabled:opacity-50"
					>
						{#each strengthPresets as preset (preset.skill)}
							<option value={preset.skill}>{preset.label} (skill {preset.skill})</option>
						{/each}
					</select>
				</div>
				<p class="mt-2 text-xs text-faint">
					engine:
					<span data-testid="engine-status" class="font-mono">
						{session.engineReady ? 'ready' : 'warming up…'}
					</span>
					· you play White{usernamePrefs.name ? ` as ${usernamePrefs.name}` : ''}
				</p>
			</section>

			<section
				class="flex min-h-56 flex-1 flex-col rounded-xs border border-line bg-card p-3"
				data-testid="moves-panel"
			>
				<h2 class="mb-2 text-sm font-semibold text-ink">
					Moves
					<span class="ml-1 font-normal text-faint">
						({session.engineThinking ? 'Stockfish thinking…' : `${game.turnColor} to move`})
					</span>
				</h2>
				{#if movePairs.length === 0}
					<p class="text-sm text-faint">No moves yet.</p>
				{:else}
					<ol
						class="min-h-0 flex-1 overflow-y-auto text-sm"
						data-testid="move-list"
						bind:this={moveListElement}
					>
						{#each movePairs as pair (pair.number)}
							<li class="grid grid-cols-[2rem_1fr_1fr] gap-1 py-0.5">
								<span class="text-faint">{pair.number}.</span>
								{#each [pair.white, pair.black] as half, i (i)}
									<span class="flex items-center gap-1.5">
										{#if half}
											{half.san}
											{#if session.badges[half.ply - 1]}
												<span
													data-testid={half.ply === session.lastFeedback?.ply
														? 'move-badge'
														: undefined}
												>
													<ClassificationBadge classification={session.badges[half.ply - 1]!} />
												</span>
											{/if}
										{/if}
									</span>
								{/each}
							</li>
						{/each}
					</ol>
				{/if}
				{#if game.isGameOver}
					<p class="mt-2 text-sm font-semibold">Game over: {game.result}</p>
				{/if}
			</section>

			<InsightBar
				opening={session.opening}
				openingState={session.openingsFailed
					? 'failed'
					: session.openingsLoaded
						? 'ready'
						: 'loading'}
				ply={game.moves.length}
				showCoach={displayPrefs.showCoach}
				coach={coachText}
				showIdeas={displayPrefs.showIdeas}
				ideas={candidateIdeas}
				gameOver={game.isGameOver}
				onideahover={(uci) => (hoverUci = uci)}
			/>

			<section class="flex flex-col gap-2">
				{#if !game.isGameOver && session.started}
					<div class="flex gap-2">
						<button
							onclick={() => session.resign()}
							class="flex-1 rounded-xs border border-line bg-card px-3 py-2 text-sm hover:bg-paper"
						>
							Resign
						</button>
					</div>
				{/if}
				<button
					onclick={() => session.newGame()}
					class="rounded-xs border border-accent-line px-3 py-2 text-xs font-semibold tracking-[0.07em] text-accent uppercase hover:bg-accent-soft"
				>
					New game
				</button>

				{#if session.completedGameId !== null}
					<p class="text-sm text-ok">
						Saved as game #{session.completedGameId}, analysis queued —
						<a
							class="underline"
							href={resolve('/review/[gameId]', { gameId: String(session.completedGameId) })}
						>
							open review
						</a>
					</p>
				{:else if session.serverGameId !== null && !session.serverError}
					<p class="text-xs text-faint">syncing to server as game #{session.serverGameId}</p>
				{/if}
				{#if session.serverError}
					<p class="text-sm break-all text-err">
						Server sync failed — the game continues locally. {session.serverError}
					</p>
				{/if}
			</section>
		</aside>
	</div>
</div>
