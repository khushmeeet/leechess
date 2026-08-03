<script lang="ts">
	// A friend game: a board, and a link to send. Everything the Play screen
	// wraps around its board — the coach line, the ideas row, the hint ladder,
	// the takeback offer — is absent here rather than hidden, because all of it
	// reads out what Stockfish would do and the opponent is a person. What is
	// left is furniture, and Settings decides how much of it appears.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import Board from '$lib/components/Board.svelte';
	import ClassificationBadge from '$lib/components/ClassificationBadge.svelte';
	import EvalBar from '$lib/components/EvalBar.svelte';
	import logo from '$lib/assets/logo.svg';
	import { liveGameLink } from '$lib/api/live';
	import { classifyMove, clampEval, type Classification } from '$lib/classification';
	import { gameOutcome } from '$lib/result';
	import { displayPrefs } from '$lib/stores/displayPrefs.svelte';
	import { LiveSession, openFriendGame } from '$lib/stores/live.svelte';
	import { session as account } from '$lib/stores/session.svelte';
	import { stockfish } from '$lib/stores/stockfish';

	const token = page.params.token!;
	const live = new LiveSession(token);
	const game = live.game;

	onMount(() => {
		// A visitor who followed a link has no session at all. Playing needs
		// none, so admit them rather than bouncing them to the welcome screen —
		// the layout guard lets this route through for exactly this moment.
		if (!account.admitted) account.playAnonymously();
		live.start().catch((error) => console.error('friend game failed to start:', error));
		return () => live.close();
	});

	// ── The optional engine extras ─────────────────────────────────────────
	// Off unless Settings says otherwise, and never shown to a spectator.
	// Both of these run Stockfish locally on the live position, which is why
	// they are opt-in and why the Settings copy says what they are.

	const wantsEngine = $derived(
		!live.isSpectator && (displayPrefs.friendEvalBar || displayPrefs.friendBadges)
	);

	let currentEval = $state<number | null>(null);
	let badges = $state<(Classification | null)[]>([]);
	/** Serializes engine work: one WASM engine, and each eval is the next
	 * move's baseline. Same shape as PlaySession's chain, minus the opponent. */
	let chain: Promise<void> = Promise.resolve();
	let baseline = 0;
	let evaluatedPlies = 0;
	let warmed = false;

	function evaluatePosition() {
		if (!wantsEngine) return;
		const ply = game.moves.length;
		if (ply === evaluatedPlies) return;
		// A takeback cannot happen here, so the move list only ever grows —
		// but a reconnect can replay it wholesale, so re-baseline rather than
		// assuming the last eval still describes the previous position.
		const rewound = ply < evaluatedPlies;
		evaluatedPlies = ply;
		const move = game.moves.at(-1);
		const fen = game.fen;
		chain = chain
			.then(async () => {
				if (!warmed) {
					await stockfish.warmup();
					warmed = true;
				}
				if (game.fen !== fen) return; // a move landed mid-search
				const before = baseline;
				const result = await stockfish.evaluate(fen, 14, 1);
				if (game.fen !== fen) return;
				const after =
					result.mate !== undefined
						? result.mate > 0
							? clampEval(Infinity)
							: clampEval(-Infinity)
						: clampEval(result.cp ?? 0);
				baseline = after;
				currentEval = after;
				// Only your own moves get a badge: the point is what *you*
				// played, and grading your opponent live would be a running
				// commentary on their game that they never asked for.
				if (
					displayPrefs.friendBadges &&
					move &&
					!rewound &&
					moverColor(move.fenBefore) === live.color
				) {
					badges[move.ply - 1] = classifyMove(
						before,
						after,
						moverColor(move.fenBefore) === 'white',
						false
					);
				}
			})
			.catch((error) => console.error('friend-game eval:', error));
	}

	function moverColor(fenBefore: string): 'white' | 'black' {
		return fenBefore.split(' ')[1] === 'b' ? 'black' : 'white';
	}

	$effect(() => {
		void game.fen;
		void wantsEngine;
		evaluatePosition();
	});

	// ── Board ──────────────────────────────────────────────────────────────

	// A spectator is held off the board by this alone, and deliberately not by
	// Board's `viewOnly`. chessground binds its pointer handlers once, at
	// construction, and skips binding entirely when viewOnly is set — so a
	// board that mounts view-only never becomes playable, whatever is set on
	// it afterwards. This screen mounts before the seat is known (claiming one
	// is a round trip), which would make every friend game a dead board.
	// `movable.color` is read on each interaction instead, so undefined here
	// refuses a move now and permits one the moment there is a seat.
	const movableColor = $derived(live.myTurn ? (live.color ?? undefined) : undefined);

	const outcome = $derived(
		live.status === 'finished' ? (gameOutcome(live.result, live.color ?? 'white') ?? 'draw') : null
	);

	const resultTitle = $derived.by(() => {
		if (live.isSpectator) {
			if (live.result === '1/2-1/2') return 'Drawn';
			return live.result === '1-0' ? 'White wins' : 'Black wins';
		}
		if (outcome === 'win') return 'You won!';
		if (outcome === 'loss') return 'You lost';
		return 'A draw';
	});

	const endLine = $derived(live.endReason ? `by ${live.endReason}` : '');

	// ── The link ───────────────────────────────────────────────────────────

	const link = $derived(liveGameLink(token));
	let copied = $state(false);
	let copyFailed = $state(false);

	async function copyLink() {
		copyFailed = false;
		try {
			await navigator.clipboard.writeText(link);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Clipboard access is refused in plenty of ordinary situations
			// (no permission, an insecure origin). The field beside this button
			// holds the link either way, so say to use that rather than failing
			// silently and looking like the button does nothing.
			copyFailed = true;
		}
	}

	let rematchBusy = $state(false);

	/** Another game with the same person means another link to send them —
	 * the seats of a finished game are spent. */
	async function playAgain() {
		if (rematchBusy) return;
		rematchBusy = true;
		try {
			await goto(resolve('/play/[token]', { token: await openFriendGame() }));
		} finally {
			rematchBusy = false;
		}
	}

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

	let moveListElement = $state<HTMLOListElement | null>(null);
	$effect(() => {
		void movePairs.length;
		requestAnimationFrame(() => {
			if (moveListElement) moveListElement.scrollTop = moveListElement.scrollHeight;
		});
	});

	function seatLabel(seat: { name: string | null }, color: 'white' | 'black') {
		return seat.name ?? (color === 'white' ? 'White' : 'Black');
	}
</script>

<svelte:head><title>leechess — playing a friend</title></svelte:head>

<div class="flex flex-col gap-4" data-testid="friend-game">
	{#if live.status === 'gone'}
		<section class="rounded-xs border border-line bg-card p-4 text-sm" data-testid="friend-gone">
			<h1 class="mb-1 font-display text-xl">That link has expired</h1>
			<p class="text-muted">
				Friend games are cleared once nobody has touched them for a couple of days. Start a new one
				and send the new link.
			</p>
			<button
				type="button"
				onclick={playAgain}
				disabled={rematchBusy}
				data-testid="friend-new-after-gone"
				class="mt-3 rounded-xs border border-accent-line px-3 py-2 text-xs font-semibold tracking-[0.07em] text-accent uppercase hover:bg-accent-soft disabled:opacity-50"
			>
				Start a new game
			</button>
		</section>
	{:else}
		<div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
			<div class="relative flex max-w-xl self-start">
				{#if displayPrefs.friendEvalBar && !live.isSpectator}
					<div class="absolute top-7 right-full bottom-7 mr-2 w-14">
						<EvalBar cp={currentEval} orientation={live.orientation} />
					</div>
				{/if}
				<div class="relative min-w-0 flex-1">
					<Board
						fen={game.fen}
						turnColor={game.turnColor}
						dests={game.dests}
						lastMove={game.lastMove}
						{movableColor}
						orientation={live.orientation}
						onmove={(orig, dest, promotion) => live.handleBoardMove(orig, dest, promotion)}
					/>

					{#if live.status === 'finished'}
						<div
							class="absolute inset-x-0 inset-y-7 z-10 grid place-items-center bg-[rgb(25_21_16/62%)] p-4"
							data-testid="friend-result"
							role="status"
							aria-live="assertive"
						>
							<div
								class="flex w-[min(88%,22rem)] items-center gap-3 rounded-xs border border-line bg-card p-3"
							>
								<img src={logo} alt="" class="h-10 w-10 flex-none" />
								<div class="min-w-0">
									<p class="text-[10px] font-semibold tracking-[0.09em] text-faint uppercase">
										{live.result === '1/2-1/2' ? '½–½' : live.result.replace('-', '–')}
										{endLine}
									</p>
									<h2 class="mt-0.5 font-display text-2xl leading-tight text-ink">
										{resultTitle}
									</h2>
									{#if live.saved}
										<p class="mt-1 text-sm text-ok">
											Saved{live.saved.number === null ? '' : ` as game #${live.saved.number}`} —
											<a
												class="underline"
												data-testid="friend-review-link"
												href={resolve('/review/[gameId]', {
													gameId: String(live.saved.gameId)
												})}
											>
												open review
											</a>
										</p>
									{:else if !live.isSpectator && !live.willSave}
										<p class="mt-1 text-sm text-muted">
											Nothing was saved — an account is what turns a finished game into a review.
										</p>
									{/if}
								</div>
							</div>
						</div>
					{/if}
				</div>
			</div>

			<aside class="flex flex-col gap-4">
				<!-- Who is here, and whether their game is being kept. The second
				     half matters more than it looks: it is the only difference
				     between the two ways of playing, and there is no second
				     chance to mention it. -->
				<!-- data-you is the machine-readable version of the "(you)" beside a
				     name: which side this browser holds, or absent when watching. -->
				<section
					class="rounded-xs border border-line bg-card p-3 text-sm"
					data-testid="friend-seats"
					data-you={live.color ?? undefined}
				>
					{#each [{ seat: live.black, color: 'black' as const }, { seat: live.white, color: 'white' as const }] as { seat, color } (color)}
						<div class="flex items-center gap-2 py-0.5">
							<span
								class="h-3 w-3 flex-none rounded-full border border-line"
								style="background: {color === 'white' ? '#f4efe4' : '#2b2620'}"
								aria-hidden="true"
							></span>
							<span class="min-w-0 flex-1 truncate text-ink">
								{seatLabel(seat, color)}
								{#if color === live.color}<span class="text-faint">(you)</span>{/if}
							</span>
							{#if !seat.seated}
								<span class="text-[11px] text-faint">waiting</span>
							{:else}
								<span
									class="text-[11px] {seat.present ? 'text-ok' : 'text-faint'}"
									data-testid="presence-{color}"
								>
									{seat.present ? 'here' : 'away'}
								</span>
							{/if}
						</div>
					{/each}
					<p class="mt-2 border-t border-line pt-2 text-[11px] text-muted">
						{#if live.isSpectator}
							Both seats are taken — you're watching.
						{:else if live.willSave}
							Your side is saved and analyzed when the game ends.
						{:else}
							Nothing is saved: no account, no review.
						{/if}
					</p>
				</section>

				{#if live.status === 'waiting'}
					<section
						class="rounded-xs border border-accent-line bg-accent-soft p-3"
						data-testid="friend-invite"
					>
						<h2 class="mb-1 text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">
							Send this link
						</h2>
						<p class="mb-2 text-sm text-body">
							Whoever opens it first plays {live.color === 'white' ? 'Black' : 'White'}. The game
							starts as soon as they arrive.
						</p>
						<div class="flex gap-1">
							<input
								type="text"
								readonly
								value={link}
								data-testid="friend-link"
								onfocus={(event) => event.currentTarget.select()}
								class="min-w-0 flex-1 rounded-xs border border-line bg-paper px-2 py-1 font-mono text-xs text-ink"
							/>
							<button
								type="button"
								onclick={copyLink}
								data-testid="friend-copy"
								class="rounded-xs border border-line bg-card px-2 py-1 text-xs whitespace-nowrap hover:bg-paper"
							>
								{copied ? 'Copied' : 'Copy'}
							</button>
						</div>
						{#if copyFailed}
							<p class="mt-1 text-[11px] text-muted">
								Couldn't reach the clipboard — select the link above and copy it.
							</p>
						{/if}
					</section>
				{/if}

				<section
					class="rounded-xs border border-line bg-card p-3 text-sm"
					data-testid="friend-status"
				>
					{#if !live.connected && live.status !== 'finished'}
						<p class="text-err" data-testid="friend-reconnecting">
							Reconnecting… the game is safe, this board will catch up.
						</p>
					{:else if live.status === 'waiting'}
						<p class="text-muted">Waiting for your friend to open the link.</p>
					{:else if live.status === 'finished'}
						<p class="font-semibold text-ink">Game over — {live.result} {endLine}</p>
					{:else if live.isSpectator}
						<p class="text-muted">{game.turnColor === 'white' ? 'White' : 'Black'} to move.</p>
					{:else}
						<p
							class:font-semibold={live.myTurn}
							class:text-ink={live.myTurn}
							class:text-muted={!live.myTurn}
						>
							{live.myTurn
								? 'Your move.'
								: `Waiting for ${seatLabel(live.opponent, live.color === 'white' ? 'black' : 'white')}.`}
						</p>
					{/if}
					{#if live.error}
						<p class="mt-1 text-err" role="alert" data-testid="friend-error">{live.error}</p>
					{/if}
				</section>

				<!-- Your opponent walked off. Without this the only ways out are to
			     resign, which records a loss you did not suffer, or to walk away
			     and let the game be swept. -->
				{#if live.status === 'playing' && !live.isSpectator && live.claimWait !== null}
					<section
						class="rounded-xs border border-accent-line bg-card p-3 text-sm"
						data-testid="claim-panel"
						role="status"
						aria-live="polite"
					>
						{#if live.canClaim}
							<p class="mb-2 text-body">
								{seatLabel(live.opponent, live.color === 'white' ? 'black' : 'white')} left the game.
							</p>
							<button
								type="button"
								onclick={() => live.claim()}
								data-testid="claim-win"
								class="w-full rounded-xs border border-accent-line px-3 py-2 text-xs font-semibold tracking-[0.07em] text-accent uppercase hover:bg-accent-soft"
							>
								Claim the win
							</button>
						{:else}
							<p class="text-muted" data-testid="claim-countdown">
								Your opponent left. You can claim the win in {live.claimCountdown}s.
							</p>
						{/if}
					</section>
				{/if}

				{#if live.drawOfferFrom && live.drawOfferFrom !== live.color && live.status === 'playing'}
					<section
						class="rounded-xs border border-accent-line bg-card p-3 text-sm"
						data-testid="draw-offer"
						role="status"
						aria-live="polite"
					>
						<p class="mb-2 text-body">Your opponent offers a draw.</p>
						<div class="flex gap-2">
							<button
								type="button"
								onclick={() => live.acceptDraw()}
								data-testid="draw-accept"
								class="flex-1 rounded-xs border border-line bg-paper px-2 py-1 hover:bg-accent-soft"
							>
								Accept
							</button>
							<button
								type="button"
								onclick={() => live.declineDraw()}
								data-testid="draw-decline"
								class="flex-1 rounded-xs border border-line bg-paper px-2 py-1 hover:bg-accent-soft"
							>
								Decline
							</button>
						</div>
					</section>
				{/if}

				{#if displayPrefs.friendMoveList}
					<section
						class="flex min-h-40 flex-1 flex-col rounded-xs border border-line bg-card p-3"
						data-testid="friend-moves"
					>
						<h2 class="mb-2 text-sm font-semibold text-ink">Moves</h2>
						{#if movePairs.length === 0}
							<p class="text-sm text-faint">No moves yet.</p>
						{:else}
							<ol
								class="min-h-0 flex-1 overflow-y-auto text-sm"
								data-testid="friend-move-list"
								bind:this={moveListElement}
							>
								{#each movePairs as pair (pair.number)}
									<li class="grid grid-cols-[2rem_1fr_1fr] gap-1 py-0.5">
										<span class="text-faint">{pair.number}.</span>
										{#each [pair.white, pair.black] as half, i (i)}
											<span class="flex items-center gap-1.5">
												{#if half}
													{half.san}
													{#if badges[half.ply - 1]}
														<ClassificationBadge classification={badges[half.ply - 1]!} />
													{/if}
												{/if}
											</span>
										{/each}
									</li>
								{/each}
							</ol>
						{/if}
					</section>
				{/if}

				{#if !live.isSpectator}
					<section class="flex flex-col gap-2">
						{#if live.status === 'playing'}
							<div class="flex gap-2">
								<button
									type="button"
									onclick={() => live.resign()}
									data-testid="friend-resign"
									class="flex-1 rounded-xs border border-line bg-card px-3 py-2 text-sm hover:bg-paper"
								>
									Resign
								</button>
								<button
									type="button"
									onclick={() => live.offerDraw()}
									disabled={live.drawOfferFrom === live.color}
									data-testid="friend-offer-draw"
									class="flex-1 rounded-xs border border-line bg-card px-3 py-2 text-sm hover:bg-paper disabled:opacity-50"
								>
									{live.drawOfferFrom === live.color ? 'Draw offered' : 'Offer draw'}
								</button>
							</div>
						{/if}
						{#if live.status === 'finished'}
							<button
								type="button"
								onclick={playAgain}
								disabled={rematchBusy}
								data-testid="friend-play-again"
								class="rounded-xs border border-accent-line px-3 py-2 text-xs font-semibold tracking-[0.07em] text-accent uppercase hover:bg-accent-soft disabled:opacity-50"
							>
								{rematchBusy ? 'Starting…' : 'Play again — new link'}
							</button>
						{/if}
						<a
							href={resolve('/')}
							class="rounded-xs border border-line bg-card px-3 py-2 text-center text-sm text-muted hover:bg-paper hover:text-ink"
						>
							Back to the engine
						</a>
					</section>
				{/if}
			</aside>
		</div>
	{/if}
</div>
