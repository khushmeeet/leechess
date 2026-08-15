<script lang="ts">
	// A friend game: a board, and a link to send. Everything the Play screen
	// wraps around its board — the coach line, the ideas row, the hint ladder,
	// the takeback offer — is absent here rather than hidden, because all of it
	// reads out what Stockfish would do and the opponent is a person. What is
	// left is furniture, and Settings decides how much of it appears.
	//
	// One instance is one game. The token arrives as a prop and never changes
	// under it — the route keys on it (see routes/play/[token]/+page.svelte), so
	// starting another game with the same friend builds a fresh screen with a
	// fresh session rather than pointing this one at a different link.
	import { onMount } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fade } from 'svelte/transition';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import Board from '$lib/components/Board.svelte';
	import EvalBar from '$lib/components/EvalBar.svelte';
	import HoldButton from '$lib/components/HoldButton.svelte';
	import { liveGameLink } from '$lib/api/live';
	import { clampEval } from '$lib/classification';
	import { gameOutcome } from '$lib/result';
	import { rise } from '$lib/transitions';
	import { displayPrefs } from '$lib/stores/displayPrefs.svelte';
	import { LiveSession, openFriendGame } from '$lib/stores/live.svelte';
	import { session as account } from '$lib/stores/session.svelte';
	import { stockfish } from '$lib/stores/stockfish';

	let { token }: { token: string } = $props();

	// Read once on purpose: this component is keyed on the token, so a different
	// link is a different instance rather than the same one being repointed. A
	// session that could change its token underneath an open socket is the thing
	// the key exists to avoid.
	// svelte-ignore state_referenced_locally
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

	// ── The optional eval bar ──────────────────────────────────────────────
	// Off unless Settings says otherwise, and never shown to a spectator. It
	// runs Stockfish locally on the live position, which is why it is opt-in
	// and why the Settings copy says what it is.

	const wantsEngine = $derived(!live.isSpectator && displayPrefs.friendEvalBar);

	let currentEval = $state<number | null>(null);
	/** Serializes engine work: one WASM engine, one search at a time. Same
	 * shape as PlaySession's chain, minus the opponent. */
	let chain: Promise<void> = Promise.resolve();
	let evaluatedPlies = 0;
	let warmed = false;

	function evaluatePosition() {
		if (!wantsEngine) return;
		const ply = game.moves.length;
		// A takeback cannot happen here, so the move list only ever grows —
		// but a reconnect can replay it wholesale, which lands on the same
		// count and needs no second search.
		if (ply === evaluatedPlies) return;
		evaluatedPlies = ply;
		const fen = game.fen;
		chain = chain
			.then(async () => {
				if (!warmed) {
					await stockfish.warmup();
					warmed = true;
				}
				if (game.fen !== fen) return; // a move landed mid-search
				const result = await stockfish.evaluate(fen, 14, 1);
				if (game.fen !== fen) return;
				currentEval =
					result.mate !== undefined
						? result.mate > 0
							? clampEval(Infinity)
							: clampEval(-Infinity)
						: clampEval(result.cp ?? 0);
			})
			.catch((error) => console.error('friend-game eval:', error));
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
		// No exclamation mark on the win. It is set at three times the size of
		// anything else on the screen, over the board it was won on — the type
		// is the celebration, and a spike of punctuation beside it only breaks
		// the optical centre of a two-word line. "Drawn" for the same reason
		// "Drawn" is what a spectator is told and "½" is what the seat rows
		// record: the scoresheet's word, not a sentence about one.
		if (outcome === 'win') return 'You won';
		if (outcome === 'loss') return 'You lost';
		return 'Drawn';
	});

	const endLine = $derived(live.endReason ? `by ${live.endReason}` : '');

	/** The result overlay arrives in three beats — the wash, the verdict, the
	 * manner under it. The offsets are what make it one gesture instead of
	 * three things appearing at once; reduced motion collapses the sequence
	 * into a single moment. */
	const beat = (ms: number) => (prefersReducedMotion.current ? 0 : ms);

	/** One seat's point, the way a scoresheet writes it — a halved point rather
	 * than the server's `1/2-1/2`. Empty while the game has no result to
	 * record. */
	function seatScore(color: 'white' | 'black'): string {
		if (live.result === '1/2-1/2') return '½';
		if (live.result === '1-0') return color === 'white' ? '1' : '0';
		if (live.result === '0-1') return color === 'black' ? '1' : '0';
		return '';
	}

	/** The opponent as a person, for the two sentences that talk about them.
	 *
	 * Both seats are anonymous unless somebody signed in, and falling back to
	 * the colour had the rail saying "Waiting for Black" — a side of the board
	 * standing in for the person on the other end. Sentence-initial in both
	 * places it is used. The seat rows keep `seatLabel`: labelling an empty
	 * seat "White" is the one place that fallback is simply the truth. */
	const opponentName = $derived(live.opponent.name ?? 'Your opponent');

	// ── What the rail leads with ───────────────────────────────────────────
	// One line, and it is the only thing in the sidebar set in the display
	// face. It is for the states that are *not* an ordinary turn: opening,
	// reconnecting, nobody here yet, over. Everything under it — the two
	// names, the move list, the buttons — is reference, and boxing all of it
	// at the same weight is what once left the screen with four panels and no
	// answer to "what now?".
	//
	// Whose move it is is deliberately not among them. The seat rows below
	// already carry it — the side to move is named, given the accent rail and
	// labelled "to move" — and a line above them saying the same thing in the
	// largest type on the rail was one fact twice, changing every ply. Null
	// here means an ordinary turn, and an ordinary turn is what the board is
	// for: no lead, and the rail starts at the names.

	interface Lead {
		text: string;
		note: string | null;
		/** The one colour on the rail, and it means something: err is trouble,
		 * ink is something that happened, muted is a board with nothing to
		 * report. */
		tone: string;
		testid?: string;
	}

	const lead = $derived.by<Lead | null>(() => {
		if (live.status === 'connecting') {
			return { text: 'Opening the game…', note: null, tone: 'text-muted' };
		}
		if (!live.connected && live.status !== 'finished') {
			return {
				text: 'Reconnecting…',
				note: 'The game is safe — this board will catch up.',
				tone: 'text-err',
				testid: 'friend-reconnecting'
			};
		}
		if (live.status === 'finished') {
			// Verdict, then how — "You lost / by resignation", one sentence
			// across two lines. The score is not repeated here: it is written
			// beside the two names below, a point each, which is where a
			// finished game is recorded.
			return { text: resultTitle, note: endLine || null, tone: 'text-ink' };
		}
		if (live.status === 'waiting') {
			return {
				text: 'Waiting for your friend',
				note: live.color
					? `Whoever opens the link plays ${live.color === 'white' ? 'Black' : 'White'}.`
					: 'Whoever opens the link takes the free seat.',
				tone: 'text-muted'
			};
		}
		// A spectator's lead says what they are, not whose move it is: with no
		// seat, "watching" is the thing about this screen they cannot work out
		// from the board, and the turn is on the rows below like everyone
		// else's.
		if (live.isSpectator) {
			return { text: "You're watching", note: 'Both seats are taken.', tone: 'text-ink' };
		}
		return null;
	});

	/** The lead, spoken. A live region has to be in the page *before* its text
	 * changes for a screen reader to reliably read the change, and the visible
	 * lead is not: most of a game has no lead at all, so that element comes and
	 * goes. This one is always mounted, takes no space, and is the only live
	 * region on the screen — the result flash over the board is aria-hidden
	 * rather than a second voice saying the same thing. */
	const announcement = $derived(lead ? [lead.text, lead.note].filter(Boolean).join('. ') : '');

	/** Their offer, still unanswered.
	 *
	 * While it stands it is the only question on the screen, so it is the only
	 * one with buttons: Resign and Offer draw come off the rail until it is
	 * answered. Both were wrong to press anyway — offering a draw into a draw
	 * offer is the same press as Accept made harder to find, and resigning
	 * gives away a game somebody has just offered to halve. The server keeps
	 * the offer up until it is answered (a move does not clear it), so nothing
	 * is stranded: Decline puts the pair straight back. */
	const drawOffered = $derived(
		live.status === 'playing' && live.drawOfferFrom !== null && live.drawOfferFrom !== live.color
	);

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
	let rematchFailed = $state(false);

	/** Another game with the same person means another link to send them —
	 * the seats of a finished game are spent. */
	async function playAgain() {
		if (rematchBusy) return;
		rematchBusy = true;
		rematchFailed = false;
		try {
			await goto(resolve('/play/[token]', { token: await openFriendGame() }));
		} catch (error) {
			// Starting a game is the one write anybody can reach, so it is rate
			// limited and it can be refused. A button that quietly does nothing
			// is the worst version of that — say so and leave it pressable.
			console.error('starting another friend game failed:', error);
			rematchFailed = true;
		} finally {
			rematchBusy = false;
		}
	}

	// Plain SANs: the ply numbers were here to index the badge each move
	// carried, and nothing else in the list ever asked which ply it was.
	const movePairs = $derived.by(() => {
		const pairs: { number: number; white: string; black?: string }[] = [];
		for (let i = 0; i < game.moves.length; i += 2) {
			pairs.push({
				number: i / 2 + 1,
				white: game.moves[i].san,
				black: game.moves[i + 1]?.san
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
			{#if rematchFailed}
				<p class="mt-2 text-sm text-err" role="alert" data-testid="friend-rematch-failed">
					Couldn't start a new game just now — try that again in a moment.
				</p>
			{/if}
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
						<!-- The result, over the board it came from, for as long as the
						     game is over.

						     No card, no logo, no small print, no ornament and no
						     colour — a wash and two lines of type, ink on paper.
						     Everything the panel here used to also carry — whether the
						     game was kept, the link to the review, what to do next — is
						     in the rail, said once, where the buttons are. What is left
						     is the one thing this belongs on the board to say, and it
						     is set to be read over the position rather than to announce
						     itself in front of it.

						     @container so the verdict is measured against the board
						     rather than the window: the type is set in cqw, which keeps
						     it the same fraction of the squares at every size the board
						     is drawn at, on a page whose viewport says nothing about how
						     wide the board ended up.

						     aria-hidden because the rail speaks for this screen (see
						     `announcement`); two live regions would say it twice.

						     One flat value across the whole board, and a fixed one
						     rather than a token: the wash is dark in both themes, so
						     paper and ink would swap underneath it and take the type
						     with them. It is set to carry display type over the
						     lightest square palette, which is the case that decides
						     it — under that the position still reads through, as the
						     record of the game the result is standing on. -->
						<div
							class="@container absolute inset-x-0 inset-y-7 z-10 grid content-center bg-[rgb(18_16_12/78%)] text-center"
							data-testid="friend-result"
							aria-hidden="true"
							in:fade={{ duration: beat(240) }}
							out:fade={{ duration: beat(380) }}
						>
							<!-- A fixed paper white for the same reason the wash is
							     fixed, and text-ink would sink into it in light mode.
							     Same value as the White seat's dot, held a little under
							     full strength — paper is not white, and type at 100% on
							     a near-black board glares where printed ink settles. -->
							<!-- Verdict, then how — the same two lines, in the same order,
							     as the rail's. The score used to lead this as an eyebrow;
							     it is written beside the two names instead, where a
							     finished game is recorded, and reading "0–1" off the board
							     it was just played on is nobody's question.

							     The manner is set as a caption under the verdict rather
							     than beside it: at this size the two are one sentence
							     broken over two lines, and the tracking is what stops the
							     small line from reading as a subtitle to the big one. -->
							<p
								class="px-4 font-display text-[clamp(1.75rem,7cqw,2.75rem)] leading-[1.05] text-balance text-[#f4efe4]/85"
								in:rise={{ y: 8, duration: 340, delay: beat(100) }}
							>
								{resultTitle}
							</p>
							{#if endLine}
								<!-- |global because this line is one {#if} deeper than the
								     other two: a local transition plays when its own block
								     is created, and this block is created by the same tick
								     that creates the overlay around it — so without it the
								     middle beat of the sequence is simply already there. -->
								<p
									class="mt-2.5 px-4 text-[11px] font-medium tracking-[0.2em] text-[#f4efe4]/55 uppercase"
									in:rise|global={{ y: 6, duration: 300, delay: beat(180) }}
								>
									{endLine}
								</p>
							{/if}
						</div>
					{/if}
				</div>
			</div>

			<!-- py-7 is Board's captured-piece rows: one above the squares and one
			     below, 1.75rem each, which makes the board column taller than the
			     board. Without the inset the rail's first and last lines overhang
			     the squares by that much at either end and the two columns read as
			     ragged. Insetting by the same amount lines the rail up with the
			     board's own top and bottom edges — the constant the result
			     overlay's inset-y-7 already uses to sit inside the squares. The
			     top is the half that always shows; the bottom lines up when the
			     rail has the content to reach it, and is background when it does
			     not. Beside the board only: stacked, there is nothing to line up
			     with. -->
			<aside class="flex flex-col gap-5 md:py-7">
				<!-- The screen's one voice. Always mounted, never seen, and the
				     reason the sections below can come and go freely. -->
				<div class="sr-only" role="status" aria-live="polite">{announcement}</div>

				<!-- The one line that answers "what now?", unboxed and in the
				     display face so it reads before anything else in the column.
				     See the `lead` derivation for why it is the only thing here
				     that gets that treatment, and why a game in progress has no
				     line at all.

				     Rendered only when there is something to say: an empty
				     section is still a flex child, and the rail's own gap under
				     it would push the names 20px clear of the board's top edge —
				     the alignment the md:py-7 above exists for. -->
				{#if lead || live.error}
					<section data-testid="friend-status">
						{#if lead}
							<h2 class="font-display text-2xl leading-tight {lead.tone}" data-testid={lead.testid}>
								{lead.text}
							</h2>
							{#if lead.note}
								<p class="mt-1 text-sm text-muted">{lead.note}</p>
							{/if}
						{/if}
						{#if live.error}
							<p class="mt-2 text-sm text-err" role="alert" data-testid="friend-error">
								{live.error}
							</p>
						{/if}
					</section>
				{/if}

				<!-- Who is here, and whether their game is being kept. The second
				     half matters more than it looks: it is the only difference
				     between the two ways of playing, and there is no second
				     chance to mention it.

				     No card and no rule above. Two names and their presence are
				     reference — they answer a question asked once a game — so
				     they are set quietly, and the one thing here that does change
				     every ply is marked instead of announced: the side to move
				     takes the accent mark, the bolder name and the label, on the
				     name it belongs to. That mark is now the only place the rail
				     says whose turn it is.

				     The hairline that used to cap this section divided it from
				     the lead above. Most of a game has no lead, which left a rule
				     across the top of the column separating the names from
				     nothing; and where there is one, a 2xl display line over
				     13px names needs no help being told apart. The rail's own
				     gap sets the distance in both cases. -->
				<!-- data-testid on each row so a spec can name a seat: the two
				     presence spans below are inside them, not a handle on them. -->
				<!-- data-you is the machine-readable version of the "(you)" beside a
				     name: which side this browser holds, or absent when watching. -->
				<section class="text-sm" data-testid="friend-seats" data-you={live.color ?? undefined}>
					{#each [{ seat: live.black, color: 'black' as const }, { seat: live.white, color: 'white' as const }] as { seat, color } (color)}
						{@const toMove = live.status === 'playing' && game.turnColor === color}
						{@const point = live.status === 'finished' ? seatScore(color) : ''}
						<!-- Emphasis means "the side to look at", which is whoever is
						     thinking during the game and whoever won once it is over. -->
						{@const marked = toMove || point === '1'}
						<div data-testid="seat-{color}" class="relative flex items-center gap-2 py-1.5">
							{#if toMove}
								<!-- The turn mark hangs in the gutter instead of indenting the
								     row. As a border-left it held 12px of every row open for a
								     mark that is on one row at a time and on neither once the
								     game is over — so the two names stood in from the lead
								     above them and the rule and the line below them, for the
								     whole game. Out here it marks the row without moving it,
								     and the names keep the column's left edge. -->
								<span class="absolute inset-y-0 -left-2 w-0.5 bg-accent" aria-hidden="true"></span>
							{/if}
							<span
								class="h-3 w-3 flex-none rounded-full border border-line"
								style="background: {color === 'white' ? '#f4efe4' : '#2b2620'}"
								aria-hidden="true"
							></span>
							<span class="min-w-0 truncate {marked ? 'font-semibold text-ink' : 'text-muted'}">
								{seatLabel(seat, color)}
								{#if color === live.color}<span class="font-normal text-faint">(you)</span>{/if}
							</span>
							{#if toMove}
								<span
									class="flex-none text-[10px] font-semibold tracking-[0.09em] text-accent uppercase"
								>
									to move
								</span>
							{/if}
							{#if point}
								<!-- The end of the column, and the signature of this screen:
								     the two rows that carried the turn all game are also
								     where it is written down. A scoresheet's point, in the
								     display face, in the slot that said "joined" a moment
								     ago — so the rail finishes the record it was already
								     keeping instead of opening a second panel to announce
								     one. It is also why the lead above no longer repeats
								     the score. -->
								<span
									class="ml-auto flex-none pl-1 font-display text-xl leading-none tabular-nums {point ===
									'0'
										? 'text-faint'
										: 'text-ink'}"
									data-testid="score-{color}"
								>
									{point}
								</span>
							{:else}
								<!-- Three words, one per state of a seat: waiting (nobody has
								     taken it), joined (somebody has, and their board is
								     connected), away (they took it and their connection is
								     gone). "Here" was the middle one, and it read as a claim
								     about the room rather than about the game — the answer to
								     "did my friend get the link?" is that they joined. -->
								<span class="ml-auto flex-none pl-1 text-[11px]">
									{#if !seat.seated}
										<span class="text-faint">waiting</span>
									{:else}
										<span
											class={seat.present ? 'text-ok' : 'text-faint'}
											data-testid="presence-{color}"
										>
											{seat.present ? 'joined' : 'away'}
										</span>
									{/if}
								</span>
							{/if}
						</div>
					{/each}
					<!-- Whether this game is being kept — the same line before and
					     after, moving from a promise to what came of it. The finished
					     half of it used to live over on the board, in the result card,
					     which is how the screen ended up saying "nothing is saved"
					     twice in two wordings a few inches apart. Said once, here,
					     where it was already being said all game. -->
					<p class="mt-2 border-t border-line pt-2 text-[11px] text-muted">
						{#if live.saved}
							<span class="text-ok">
								Saved{live.saved.number === null ? '' : ` as game #${live.saved.number}`} —
								<a
									class="underline"
									data-testid="friend-review-link"
									href={resolve('/review/[gameId]', { gameId: String(live.saved.gameId) })}
								>
									open review
								</a>
							</span>
						{:else if live.isSpectator}
							Nothing is saved — you're only watching.
						{:else if live.status === 'finished'}
							{#if live.willSave}
								Saving this game…
							{:else}
								Nothing was saved — an account is what turns a finished game into a review.
							{/if}
						{:else if live.willSave}
							Your side is saved and analyzed when the game ends.
						{:else}
							Nothing is saved: no account, no review.
						{/if}
					</p>
				</section>

				{#if live.status === 'waiting'}
					<!-- The one card on a waiting screen, because sending the link is
					     the only thing there is to do on it. The sentence about who
					     gets which colour moved up into the lead — this is the
					     field and the button. -->
					<section
						class="rounded-xs border border-accent-line bg-accent-soft p-3"
						data-testid="friend-invite"
					>
						<h2 class="mb-2 text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">
							Send this link
						</h2>
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
								class="rounded-xs border border-accent-line bg-card px-3 py-1 text-xs font-semibold tracking-[0.07em] text-accent uppercase hover:bg-paper"
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

				<!-- Your opponent walked off. Without this the only ways out are to
			     resign, which records a loss you did not suffer, or to walk away
			     and let the game be swept. -->
				{#if live.status === 'playing' && !live.isSpectator && live.claimWait !== null}
					<section
						class="rounded-xs border border-accent-line bg-card p-3 text-sm"
						data-testid="claim-panel"
						role="status"
						aria-live="polite"
						in:rise
						out:rise={{ duration: 160 }}
					>
						{#if live.canClaim}
							<p class="mb-2 text-body">{opponentName} left the game.</p>
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

				{#if drawOffered}
					<section
						class="rounded-xs border border-accent-line bg-card p-3 text-sm"
						data-testid="draw-offer"
						role="status"
						aria-live="polite"
						in:rise
						out:rise={{ duration: 160 }}
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

				<!-- Not before the game starts. It is a tall box by design — a fixed
				     region beats one that grows a line every move and walks the
				     resign button down the column — and a tall box of nothing is the
				     largest thing on the screen at the exact moment the link is the
				     only thing on it that matters. No moves are possible yet, so
				     there is nothing to hold open. -->
				{#if displayPrefs.friendMoveList && (live.status === 'playing' || live.status === 'finished')}
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
											<span>{half ?? ''}</span>
										{/each}
									</li>
								{/each}
							</ol>
						{/if}
					</section>
				{/if}

				<!-- Deliberately not pushed to the bottom of the column. The move
				     list above grows into whatever room is left, so with one on
				     screen these buttons land on the board's bottom edge anyway;
				     with the list switched off, or before the game starts, there
				     is nothing to fill that room with, and pinning them down
				     there only opened a hand's width of nothing above them. A
				     rail that stops where its content stops is the honest
				     version of a short rail.

				     Held to the two states that have buttons in them: an empty
				     section is still a flex child, so on a waiting screen it
				     spent one of the rail's gaps on nothing. -->
				{#if !live.isSpectator && (live.status === 'playing' || live.status === 'finished')}
					<section class="flex flex-col gap-2">
						{#if live.status === 'playing' && !drawOffered}
							<div class="flex gap-2">
								<!-- A person is waiting on the other end of this one, so a
								     misclick costs them a game as well. -->
								<HoldButton
									oncomplete={() => live.resign()}
									data-testid="friend-resign"
									class="flex-1 rounded-xs border border-line bg-card px-3 py-2 text-sm hover:bg-paper"
								>
									Hold to resign
								</HoldButton>
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
							<!-- Another game on the link they already have. It takes
							     both players: this panel is where a signed-in player's
							     review link sits, and one press must not clear it out
							     from under someone still reading it. -->
							{#if live.rematchAsked}
								<div class="flex gap-2" data-testid="rematch-waiting">
									<button
										type="button"
										disabled
										data-testid="friend-play-again"
										class="flex-1 rounded-xs border border-accent-line px-3 py-2 text-xs font-semibold tracking-[0.07em] text-accent uppercase opacity-60"
									>
										Waiting for a reply
									</button>
									<button
										type="button"
										onclick={() => live.declineRematch()}
										data-testid="rematch-cancel"
										class="rounded-xs border border-line bg-card px-3 py-2 text-sm text-muted hover:bg-paper hover:text-ink"
									>
										Cancel
									</button>
								</div>
							{:else if live.rematchOffered}
								<div class="flex flex-col gap-2" data-testid="rematch-offer">
									<p class="text-sm text-body">{opponentName} wants to play again.</p>
									<div class="flex gap-2">
										<button
											type="button"
											onclick={() => live.offerRematch()}
											data-testid="friend-play-again"
											class="flex-1 rounded-xs border border-accent-line px-3 py-2 text-xs font-semibold tracking-[0.07em] text-accent uppercase hover:bg-accent-soft"
										>
											Play again
										</button>
										<button
											type="button"
											onclick={() => live.declineRematch()}
											data-testid="rematch-decline"
											class="rounded-xs border border-line bg-card px-3 py-2 text-sm text-muted hover:bg-paper hover:text-ink"
										>
											No thanks
										</button>
									</div>
								</div>
							{:else}
								<button
									type="button"
									onclick={() => live.offerRematch()}
									data-testid="friend-play-again"
									class="rounded-xs border border-accent-line px-3 py-2 text-xs font-semibold tracking-[0.07em] text-accent uppercase hover:bg-accent-soft"
								>
									Play again — same link
								</button>
							{/if}
						{/if}
					</section>
				{/if}

				<!-- The two ways out, on one line, under the one thing worth
				     pressing. A finished game had three stacked offers and two
				     hairlines between them, each set apart as if it were a
				     decision of its own; only the rematch is. These are the
				     alternatives to it — a new link when the person on the other
				     end has gone for good, and the door — so they are one quiet
				     row, in the running text of the rail rather than boxed.

				     Neither is available before the game is over, and both are
				     outside the seat check on purpose: a spectator gets no
				     buttons at all, so without this their finished game ends in a
				     rail that simply stops. -->
				{#if live.status === 'finished'}
					<div>
						<div class="flex items-center justify-center gap-2 text-xs text-muted">
							{#if !live.isSpectator}
								<button
									type="button"
									onclick={playAgain}
									disabled={rematchBusy}
									data-testid="friend-fresh-link"
									class="underline underline-offset-2 hover:text-ink disabled:opacity-50"
								>
									{rematchBusy ? 'Starting…' : 'Start a fresh link'}
								</button>
								<span class="text-faint" aria-hidden="true">·</span>
							{/if}
							<!-- Underlined like its neighbour. They are peers on one
							     line, and the row is small and muted enough that leaving
							     one of them to a hover state would read as a label. -->
							<a
								href={resolve('/')}
								data-testid="friend-leave"
								class="underline underline-offset-2 hover:text-ink"
							>
								Back to the engine
							</a>
						</div>
						{#if rematchFailed}
							<p
								class="mt-2 text-center text-sm text-err"
								role="alert"
								data-testid="friend-rematch-failed"
							>
								Couldn't start a new game just now — try that again in a moment.
							</p>
						{/if}
					</div>
				{/if}
			</aside>
		</div>
	{/if}
</div>
