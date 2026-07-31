<script lang="ts">
	// The signed-out landing page: what leechess is, then a way in. Guests are
	// listed first and styled as the primary action — an account only makes
	// progress reachable from another browser, and nothing here is worth
	// putting a wall in front of.
	import logo from '$lib/assets/logo.svg';
	import { authErrorMessage } from '$lib/auth/messages';
	import { session } from '$lib/stores/session.svelte';

	type Mode = 'choose' | 'guest' | 'signup' | 'signin';

	let mode = $state<Mode>('choose');
	let username = $state(session.suggestedName ?? '');
	let password = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);

	const loop = [
		{
			title: 'Play',
			body: 'Stockfish at one of five strengths, or pass-and-play. Every move is classified as you make it — Best through Blunder — and a live hint ladder nudges before it tells.'
		},
		{
			title: 'Review',
			body: 'Afterwards: a centipawn-loss graph split by opening, middlegame and endgame; the tactical motif you walked into; and a written explanation of why the move cost what it did.'
		},
		{
			title: 'Puzzles',
			body: 'Your own blunders become drillable positions, scheduled by Leitner box — ten minutes, a day, three days, a week, three weeks. Twelve motifs, from forks and pins to zwischenzug and overloading.'
		},
		{
			title: 'Endgames',
			body: 'Twelve curated positions — Lucena, Philidor, key squares, Vancura — played out against a full-strength engine rather than solved as a line. You have to actually convert it.'
		},
		{
			title: 'Progress',
			body: 'Success rate per motif over 30 days, 90 days or all time; your weakest patterns called out with a link straight to a drill; a day streak. No rating ladder — the measure is whether the mistakes stop.'
		},
		{
			title: 'Literature',
			body: 'A reference shelf: chess terminology, annotated famous games, an eras timeline, and live opening theory from Wikibooks for whatever line is on the board.'
		}
	];

	function open(next: Mode) {
		mode = next;
		error = null;
		password = '';
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		error = null;
		try {
			if (mode === 'guest') await session.startAsGuest(username.trim());
			else if (mode === 'signup') await session.register(username.trim(), password);
			else await session.login(username.trim(), password);
			// No goto: the layout guard sends a signed-in visitor off /welcome,
			// and doing it here as well raced it to the same URL.
		} catch (err) {
			error = authErrorMessage(err);
		} finally {
			busy = false;
		}
	}

	const heading = $derived(
		mode === 'guest' ? 'Pick a name' : mode === 'signup' ? 'Create an account' : 'Sign in'
	);
</script>

<svelte:head><title>leechess — learn from your own mistakes</title></svelte:head>

<!-- Sized to the viewport rather than to the content: this is the first thing
     anyone sees, and a landing page that opens mid-scroll reads as broken. The
     primer sits beside the sign-in at lg rather than below it, which is what
     keeps both halves on screen. Narrow screens stack and scroll as usual.
     3rem is the padding <main> adds; there is no nav on this route. -->
<div class="flex min-h-[calc(100svh-3rem)] flex-col justify-center" data-testid="welcome">
	<div class="grid items-center gap-8 lg:grid-cols-[1fr_20rem] lg:gap-12">
		<!-- Identity, thesis, and the way in. Ordered rather than moved: the
		     wordmark is the h1, so it stays first in the DOM for a screen reader
		     and first in the stack on a narrow screen — only the desktop layout
		     puts it to the right of the primer. -->
		<div class="flex flex-col items-center text-center lg:order-2 lg:items-start lg:text-left">
			<img src={logo} alt="" class="mb-3 h-12 w-12" />
			<h1 class="mb-3 font-display text-3xl">leechess</h1>
			<p class="mb-6 text-sm text-body">
				A chess coach, not a chess server. Play a game, find out which pattern you missed and why,
				then drill that exact pattern until it stops costing you games.
			</p>

			{#if mode === 'choose'}
				<div class="flex w-full flex-col gap-2" data-testid="welcome-actions">
					<button
						type="button"
						onclick={() => open('guest')}
						data-testid="welcome-guest"
						class="rounded-xs border border-accent-line px-3 py-2 text-xs font-semibold tracking-[0.07em] text-accent uppercase hover:bg-accent-soft"
					>
						Start playing
					</button>
					<div class="flex gap-2 text-sm">
						<button
							type="button"
							onclick={() => open('signup')}
							data-testid="welcome-signup"
							class="flex-1 rounded-xs border border-line bg-card px-3 py-2 hover:bg-paper"
						>
							Create account
						</button>
						<button
							type="button"
							onclick={() => open('signin')}
							data-testid="welcome-signin"
							class="flex-1 rounded-xs border border-line bg-card px-3 py-2 hover:bg-paper"
						>
							Sign in
						</button>
					</div>
					<p class="text-xs text-muted">
						Starting to play makes a guest account straight away, so your games are saved. You can
						set a password later without losing anything.
					</p>
				</div>
			{:else}
				<div class="w-full rounded-xs border border-line bg-card p-4 text-left">
					<h2 class="mb-3 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
						{heading}
					</h2>
					<form class="flex flex-col gap-3" onsubmit={submit}>
						<label class="flex flex-col gap-1 text-sm">
							<span class="text-muted">Username</span>
							<input
								type="text"
								bind:value={username}
								autocomplete="username"
								maxlength="24"
								required
								data-testid="auth-username"
								class="rounded-xs border border-line bg-paper px-2 py-1 text-sm text-ink"
							/>
						</label>

						{#if mode !== 'guest'}
							<label class="flex flex-col gap-1 text-sm">
								<span class="text-muted">Password</span>
								<input
									type="password"
									bind:value={password}
									autocomplete={mode === 'signup' ? 'new-password' : 'current-password'}
									required
									data-testid="auth-password"
									class="rounded-xs border border-line bg-paper px-2 py-1 text-sm text-ink"
								/>
							</label>
						{/if}

						{#if mode === 'signup'}
							<!-- Said plainly, next to the field, because it is true and
							     because there is no second chance to mention it. -->
							<p class="text-xs text-muted" data-testid="no-recovery-warning">
								There's no password reset — leechess has no email address for you. Save it in a
								password manager.
							</p>
						{/if}

						{#if error}
							<p class="text-xs text-err" role="alert" data-testid="auth-error">{error}</p>
						{/if}

						<div class="flex items-center gap-2">
							<button
								type="submit"
								disabled={busy}
								data-testid="auth-submit"
								class="rounded-xs border border-accent-line px-3 py-2 text-xs font-semibold tracking-[0.07em] text-accent uppercase hover:bg-accent-soft disabled:opacity-50"
							>
								{mode === 'guest' ? 'Start playing' : heading}
							</button>
							<button
								type="button"
								onclick={() => open('choose')}
								data-testid="auth-back"
								class="rounded-xs border border-line bg-paper px-3 py-2 text-sm hover:bg-accent-soft"
							>
								Back
							</button>
						</div>
					</form>
				</div>
			{/if}
		</div>

		<!-- the primer -->
		<div class="lg:order-1">
			<h2 class="mb-2 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
				What you get
			</h2>
			<div class="grid gap-2 sm:grid-cols-2">
				{#each loop as step (step.title)}
					<section class="rounded-xs border border-line bg-card p-3">
						<h3 class="mb-0.5 font-display text-base">{step.title}</h3>
						<p class="text-[13px] leading-snug text-body">{step.body}</p>
					</section>
				{/each}
			</div>
			<p class="mt-3 text-xs text-muted">
				Single player. No matchmaking, no rating ladder, nothing shared with anyone.
			</p>
		</div>
	</div>
</div>
