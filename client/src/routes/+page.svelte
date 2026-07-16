<script lang="ts">
	import { onMount } from 'svelte';
	import Board from '$lib/components/Board.svelte';
	import ClassificationBadge from '$lib/components/ClassificationBadge.svelte';
	import EvalBar from '$lib/components/EvalBar.svelte';
	import InsightBar from '$lib/components/InsightBar.svelte';
	import logo from '$lib/assets/logo.svg';
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
		{ skill: 1, label: 'Beginner', elo: '1470' },
		{ skill: 3, label: 'Casual', elo: '1740' },
		{ skill: 5, label: 'Club', elo: '2200' },
		{ skill: 10, label: 'Strong', elo: '2790' },
		{ skill: 20, label: 'Max', elo: '3200+' }
	];

	type ResultOutcome = 'win' | 'loss' | 'draw';

	const resultOutcome = $derived.by((): ResultOutcome | null => {
		if (!game.isGameOver) return null;
		if (game.result === '1/2-1/2') return 'draw';
		const winner = game.result === '1-0' ? 'white' : game.result === '0-1' ? 'black' : null;
		if (!winner) return 'draw';
		return winner === session.playerColor ? 'win' : 'loss';
	});

	const resultContent = $derived.by(() => {
		if (resultOutcome === 'win') {
			return {
				title: 'You won!',
				message: 'A brilliant finish. The board is yours.'
			};
		}
		if (resultOutcome === 'loss') {
			return {
				title: 'You lost',
				message: 'A tough game. Review it, learn, and come back stronger.'
			};
		}
		return {
			title: 'A hard-fought draw',
			message: 'Evenly matched. The review may reveal where the balance could have tipped.'
		};
	});

	const confetti = Array.from({ length: 28 }, (_, index) => {
		const angle = (index / 28) * Math.PI * 2;
		const radius = 150 + (index % 5) * 24;
		return {
			burstX: Math.cos(angle) * radius,
			burstY: Math.sin(angle) * radius * 0.72 - 55,
			landX: Math.cos(angle) * (160 + (index % 4) * 30),
			delay: (index % 4) * 40,
			duration: 1450 + (index % 5) * 100,
			midSpin: 130 + (index % 4) * 55,
			spin: 430 + (index % 4) * 180,
			width: 5 + (index % 3) * 2,
			height: 9 + (index % 2) * 4,
			color: [
				'var(--color-highlight)',
				'var(--color-accent)',
				'var(--color-ok)',
				'var(--color-card)',
				'var(--color-muted)'
			][index % 5]
		};
	});

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
				<div class="absolute top-7 right-full bottom-7 mr-2 w-14">
					<EvalBar cp={session.currentEval} />
				</div>
			{/if}
			<div class="relative min-w-0 flex-1">
				<Board
					fen={game.fen}
					turnColor={game.turnColor}
					dests={game.dests}
					lastMove={game.lastMove}
					{movableColor}
					autoShapes={boardShapes}
					onmove={(orig, dest) => session.handleBoardMove(orig, dest)}
				/>

				{#if resultOutcome}
					<div
						class="result-overlay {resultOutcome}"
						data-testid="game-result-overlay"
						data-outcome={resultOutcome}
						role="status"
						aria-live="assertive"
						aria-atomic="true"
					>
						{#if resultOutcome === 'win'}
							<div class="confetti" data-testid="game-result-confetti" aria-hidden="true">
								{#each confetti as piece, index (index)}
									<i
										class:round={index % 4 === 0}
										style={`--burst-x: ${piece.burstX.toFixed(1)}px; --burst-y: ${piece.burstY.toFixed(1)}px; --land-x: ${piece.landX.toFixed(1)}px; --delay: ${piece.delay}ms; --duration: ${piece.duration}ms; --mid-spin: ${piece.midSpin}deg; --spin: ${piece.spin}deg; --piece-width: ${piece.width}px; --piece-height: ${piece.height}px; --piece-color: ${piece.color}`}
									></i>
								{/each}
							</div>
						{/if}

						<div class="result-banner rounded-xs border border-line bg-card p-3 text-sm">
							<img src={logo} alt="leechess" class="result-logo" data-testid="game-result-logo" />
							<div class="result-copy">
								<p class="text-[10px] font-semibold tracking-[0.09em] text-faint uppercase">
									Final score · {game.result === '1/2-1/2' ? '½–½' : game.result.replace('-', '–')}
								</p>
								<h2 class="mt-0.5 font-display text-2xl leading-tight text-ink">
									{resultContent.title}
								</h2>
								<p class="mt-1 text-sm text-muted">{resultContent.message}</p>
							</div>
						</div>
					</div>
				{/if}
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
							<option value={preset.skill}>{preset.label} (≈{preset.elo} Elo)</option>
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
				<h2 class="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
					Moves
					{#if session.engineError}
						<span class="font-normal text-err">(engine stalled)</span>
						<button
							type="button"
							class="ml-auto rounded-xs border border-line px-2 py-0.5 text-xs font-normal text-ink hover:bg-paper"
							data-testid="engine-retry"
							onclick={() => session.retryEngineMove()}
						>
							Retry
						</button>
					{:else}
						<span class="font-normal text-faint">
							({session.engineThinking ? 'Stockfish thinking…' : `${game.turnColor} to move`})
						</span>
					{/if}
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

<style>
	.result-overlay {
		position: absolute;
		inset: 1.75rem 0;
		z-index: 10;
		display: grid;
		place-items: center;
		overflow: hidden;
		padding: 1rem;
		background: rgb(25 21 16 / 62%);
		isolation: isolate;
		pointer-events: none;
		animation: overlay-in 180ms cubic-bezier(0.2, 0, 0, 1) both;
	}

	.result-banner {
		position: relative;
		z-index: 2;
		display: flex;
		width: min(88%, 22rem);
		align-items: center;
		gap: 0.75rem;
		animation: banner-in 280ms 50ms cubic-bezier(0.2, 0, 0, 1) both;
	}

	.result-logo {
		width: 2.5rem;
		height: 2.5rem;
		flex: none;
	}

	.result-copy {
		min-width: 0;
		text-wrap: pretty;
	}

	.confetti {
		position: absolute;
		inset: 0;
		z-index: 1;
		overflow: hidden;
	}

	.confetti i {
		position: absolute;
		top: 50%;
		left: 50%;
		display: block;
		width: var(--piece-width);
		height: var(--piece-height);
		border-radius: 1px;
		background: var(--piece-color);
		box-shadow: 0 1px 1px rgb(0 0 0 / 15%);
		will-change: transform, opacity;
		animation: confetti-burst var(--duration) var(--delay) cubic-bezier(0.16, 0.72, 0.3, 1) both;
	}

	.confetti i.round {
		border-radius: 999px;
	}

	@keyframes overlay-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes banner-in {
		from {
			opacity: 0;
			transform: translateY(0.4rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes confetti-burst {
		0% {
			opacity: 0;
			transform: translate3d(-50%, -50%, 0) rotate(0) scale(0.35);
		}
		10% {
			opacity: 1;
		}
		45% {
			opacity: 1;
			transform: translate3d(calc(-50% + var(--burst-x)), calc(-50% + var(--burst-y)), 0)
				rotate(var(--mid-spin)) scale(1);
		}
		100% {
			opacity: 0;
			transform: translate3d(calc(-50% + var(--land-x)), 22rem, 0) rotate(var(--spin)) scale(0.85);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.result-overlay,
		.result-banner {
			animation: none;
		}

		.confetti i {
			display: none;
			animation: none;
		}
	}
</style>
