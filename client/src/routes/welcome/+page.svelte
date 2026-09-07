<script lang="ts">
	// The signed-out landing page: what leechess is, then a way in. Playing is
	// listed first and styled as the primary action — it asks for nothing at
	// all, and nothing about a board is worth putting a wall in front of. The
	// account is the second offer, and what it buys is stated rather than
	// implied: everything that remembers you.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import { authErrorMessage } from '$lib/auth/messages';
	import { openFriendGame } from '$lib/stores/live.svelte';
	import { ANONYMOUS_NAME, session } from '$lib/stores/session.svelte';

	type Mode = 'choose' | 'signup' | 'signin';

	// ?mode=signup is how the app's own sign-up links arrive here — from the
	// nav, from Settings, and from the four screens that need an account.
	// Landing on the chooser and making them pick again would be a step they
	// already took.
	const requested = page.url.searchParams.get('mode');
	let mode = $state<Mode>(requested === 'signup' || requested === 'signin' ? requested : 'choose');
	let username = $state(session.suggestedName ?? '');
	let password = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);
	let friendBusy = $state(false);
	let friendError = $state<string | null>(null);

	const loop = [
		{
			title: 'Play',
			body: 'Find your rhythm against a practice partner, or invite a friend to the board.'
		},
		{
			title: 'Review',
			body: 'Revisit your games. Understand the turning points and what to try next time.'
		},
		{
			title: 'Puzzles',
			body: 'Turn your missed tactics into practice, one carefully chosen position at a time.'
		},
		{
			title: 'Endgames',
			body: 'Study the classics. Learn to convert an advantage and hold a difficult draw.'
		},
		{
			title: 'Progress',
			body: 'Follow the patterns you are mastering and give your weakest ones another look.'
		},
		{
			title: 'Literature',
			body: 'Explore the language, history, and great games of a timeless pursuit.'
		}
	];

	function open(next: Mode) {
		mode = next;
		error = null;
		password = '';
	}

	/** Straight to the board. No account, so nothing to wait for and nothing to
	 * fill in — and no layout guard to do the navigating, because anonymous is
	 * not signed in and /welcome stays reachable from it. */
	function startPlaying() {
		session.playAnonymously();
		goto(resolve('/'));
	}

	/** Open a friend game and go to it, where the link to send is waiting.
	 *
	 * Admits an unknown visitor anonymously on the way, the same as "Play now"
	 * does: a friend game keeps nothing for a player without an account, so
	 * there is nothing here an account is needed for. Signing in later is
	 * still what turns a finished game into a review. */
	async function playWithFriend() {
		if (friendBusy) return;
		friendBusy = true;
		friendError = null;
		try {
			const token = await openFriendGame();
			if (!session.admitted) session.playAnonymously();
			await goto(resolve('/play/[token]', { token }));
		} catch {
			friendError = 'Could not start a game just now. Try again in a moment.';
		} finally {
			friendBusy = false;
		}
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		error = null;
		try {
			if (mode === 'signup') await session.register(username.trim(), password);
			else await session.login(username.trim(), password);
			// No goto: the layout guard sends a signed-in visitor off /welcome,
			// and doing it here as well raced it to the same URL.
		} catch (err) {
			error = authErrorMessage(err);
		} finally {
			busy = false;
		}
	}

	const heading = $derived(mode === 'signup' ? 'Create an account' : 'Sign in');
</script>

<svelte:head><title>leechess — learn from your own mistakes</title></svelte:head>

<div class="welcome" data-testid="welcome">
	<header class="welcome-masthead">
		<div class="welcome-wordmark">
			<BrandMark />
			<h1>leechess</h1>
		</div>
		<p class="eyebrow">The royal game. Your own journey.</p>
	</header>
	<div class="welcome-hero">
		<div class="welcome-intro">
			<p class="eyebrow">A quiet place to become a better player</p>
			<h2>An ancient game.<br /><span>A lifelong study.</span></h2>
			<div class="royal-rule" aria-hidden="true"><span>◆</span></div>
			<p class="welcome-description">
				Every move has something to teach you. Play, reflect, and return to the board with a little
				more understanding.
			</p>
			<p class="welcome-note">Personal guidance. Thoughtful practice. At your pace.</p>
		</div>
		<section class="welcome-entry study-panel" aria-label="Start playing">
			{#if mode === 'choose'}
				<p class="eyebrow">Your next move</p>
				<h2 class="section-title mb-2 mt-2">The board is yours.</h2>
			{/if}
			{#if mode === 'choose'}
				<div class="flex w-full flex-col gap-2" data-testid="welcome-actions">
					<button
						type="button"
						onclick={startPlaying}
						data-testid="welcome-play"
						class="btn-primary"
					>
						<!-- Signed out this screen is the way in; someone already
						     playing anonymously got here from a sign-up link, and for
						     them the same button is the way back out of it. -->
						{session.anonymous ? 'Back to the board' : 'Play now'}
					</button>
					<button
						type="button"
						onclick={playWithFriend}
						disabled={friendBusy}
						data-testid="welcome-play-friend"
						class="btn-secondary"
					>
						{friendBusy ? 'Starting a game…' : 'Play with a friend'}
					</button>
					{#if friendError}
						<p class="text-xs text-err" role="alert" data-testid="welcome-friend-error">
							{friendError}
						</p>
					{/if}
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
					<p class="text-xs text-muted" data-testid="play-now-terms">
						Play now asks for nothing and keeps nothing in your account. You play as
						{ANONYMOUS_NAME}. Create an account to save games and build your practice history.
					</p>
				</div>
			{:else}
				<div class="w-full text-left">
					<h2 class="section-title mb-2">
						{heading}
					</h2>
					<form class="flex flex-col gap-2" onsubmit={submit}>
						<label class="flex flex-col gap-1 text-sm">
							<span class="text-muted">Username</span>
							<input
								type="text"
								bind:value={username}
								autocomplete="username"
								maxlength="24"
								required
								data-testid="auth-username"
								class="rounded-xs border border-line bg-paper px-3 py-2 text-base text-ink"
							/>
						</label>

						<label class="flex flex-col gap-1 text-sm">
							<span class="text-muted">Password</span>
							<input
								type="password"
								bind:value={password}
								autocomplete={mode === 'signup' ? 'new-password' : 'current-password'}
								required
								data-testid="auth-password"
								class="rounded-xs border border-line bg-paper px-3 py-2 text-base text-ink"
							/>
						</label>

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
							<button type="submit" disabled={busy} data-testid="auth-submit" class="btn-primary">
								{heading}
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
		</section>
	</div>
	<section class="welcome-primer" aria-label="What you get">
		{#each loop as step, index (step.title)}
			<article>
				<span class="chapter-number" aria-hidden="true"
					>{['I', 'II', 'III', 'IV', 'V', 'VI'][index]}</span
				>
				<div>
					<h2>{step.title}</h2>
					<p>{step.body}</p>
				</div>
			</article>
		{/each}
	</section>
	<footer class="welcome-footer">
		<span>Sixty-four squares. Endless possibility.</span><span>Play · Reflect · Return</span>
	</footer>
</div>

<style>
	.welcome {
		display: flex;
		flex-direction: column;
	}
	.welcome-masthead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding-block-end: 0.625rem;
		border-bottom: 3px double var(--color-line);
	}
	.welcome-wordmark {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}
	.welcome-wordmark :global(svg) {
		width: 1.625rem;
		height: 2rem;
	}
	.welcome-wordmark h1 {
		font-family: var(--font-display);
		font-size: 1.625rem;
		font-weight: 700;
		letter-spacing: -0.02em;
	}
	.welcome-hero {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 20rem;
		align-items: center;
		gap: 2rem;
		padding-block: 1.25rem;
	}
	.welcome-intro h2 {
		margin-block: 0.625rem;
		font-family: var(--font-display);
		font-size: clamp(1.875rem, 3.2vw, 2.625rem);
		font-weight: 700;
		line-height: 1.1;
		letter-spacing: -0.025em;
	}
	.welcome-intro h2 span {
		color: var(--color-accent);
	}
	.royal-rule {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 7rem;
		margin-block: 0.75rem;
		color: var(--color-ornament);
		font-size: 0.5rem;
	}
	.royal-rule::before,
	.royal-rule::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--color-line);
	}
	.welcome-description {
		max-width: 44ch;
		font-size: 0.9375rem;
		line-height: 1.5;
		color: var(--color-body);
	}
	.welcome-note {
		margin-block-start: 0.75rem;
		font-size: 0.75rem;
		font-style: italic;
		color: var(--color-muted);
	}
	.welcome-entry {
		border-top: 3px double var(--color-ornament);
	}
	.welcome-primer {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.875rem 1.25rem;
		padding-block: 0.875rem;
		border-block: 1px solid var(--color-line);
	}
	.welcome-primer article {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
	}
	.chapter-number {
		width: 1.25rem;
		flex: none;
		font-family: var(--font-display);
		font-size: 0.875rem;
		color: var(--color-ornament);
	}
	.welcome-primer h2 {
		margin-block-end: 0.125rem;
		font-family: var(--font-display);
		font-size: 1rem;
		font-weight: 700;
	}
	.welcome-primer p {
		font-size: 0.8125rem;
		line-height: 1.4;
		color: var(--color-muted);
	}
	.welcome-footer {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding-block-start: 0.625rem;
		color: var(--color-muted);
		font-size: 0.6875rem;
	}
	@media (max-width: 44rem) {
		.welcome-hero {
			grid-template-columns: minmax(0, 1fr);
			gap: 1rem;
		}
		.welcome-entry {
			width: 100%;
			max-width: 26rem;
		}
		.welcome-primer {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.welcome-masthead > p {
			display: none;
		}
	}
	@media (max-width: 30rem) {
		.welcome-primer {
			grid-template-columns: minmax(0, 1fr);
		}
		.welcome-footer {
			flex-direction: column;
			gap: 0.25rem;
		}
	}
</style>
