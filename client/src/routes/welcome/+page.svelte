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

<div class="mx-auto max-w-3xl" data-testid="welcome">
	<header class="mb-8 text-center">
		<img src={logo} alt="" class="mx-auto mb-3 h-12 w-12" />
		<h1 class="mb-3 font-display text-3xl">leechess</h1>
		<p class="mx-auto max-w-xl text-body">
			A chess coach, not a chess server. Play a game, find out which pattern you missed and why,
			then drill that exact pattern until it stops costing you games.
		</p>
	</header>

	{#if mode === 'choose'}
		<div class="mb-8 flex flex-col items-center gap-3" data-testid="welcome-actions">
			<button
				type="button"
				onclick={() => open('guest')}
				data-testid="welcome-guest"
				class="w-64 rounded-xs border border-accent-line px-3 py-2 text-xs font-semibold tracking-[0.07em] text-accent uppercase hover:bg-accent-soft"
			>
				Start playing
			</button>
			<div class="flex items-center gap-2 text-sm">
				<button
					type="button"
					onclick={() => open('signup')}
					data-testid="welcome-signup"
					class="rounded-xs border border-line bg-card px-3 py-2 hover:bg-paper"
				>
					Create an account
				</button>
				<button
					type="button"
					onclick={() => open('signin')}
					data-testid="welcome-signin"
					class="rounded-xs border border-line bg-card px-3 py-2 hover:bg-paper"
				>
					Sign in
				</button>
			</div>
			<p class="max-w-sm text-center text-xs text-muted">
				Starting to play makes a guest account straight away, so your games are saved. You can set a
				password later without losing anything.
			</p>
		</div>
	{:else}
		<div class="mx-auto mb-8 max-w-sm rounded-xs border border-line bg-card p-4">
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
						class="rounded-xs border border-line bg-card px-2 py-1 text-sm text-ink"
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
							class="rounded-xs border border-line bg-card px-2 py-1 text-sm text-ink"
						/>
					</label>
				{/if}

				{#if mode === 'signup'}
					<!-- Said plainly, next to the field, because it is true and
					     because there is no second chance to mention it. -->
					<p class="text-xs text-muted" data-testid="no-recovery-warning">
						There's no password reset — leechess has no email address for you. Save it in a password
						manager.
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
						class="rounded-xs border border-line bg-card px-3 py-2 text-sm hover:bg-paper"
					>
						Back
					</button>
				</div>
			</form>
		</div>
	{/if}

	<h2 class="mb-3 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
		What you get
	</h2>
	<div class="grid gap-3 sm:grid-cols-2">
		{#each loop as step (step.title)}
			<section class="rounded-xs border border-line bg-card p-3">
				<h3 class="mb-1 font-display text-lg">{step.title}</h3>
				<p class="text-sm text-body">{step.body}</p>
			</section>
		{/each}
	</div>

	<p class="mt-6 text-center text-xs text-muted">
		Single player. No matchmaking, no rating ladder, nothing shared with anyone.
	</p>
</div>
