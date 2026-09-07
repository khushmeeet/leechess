<script lang="ts">
	import './layout.css';
	import logo from '$lib/assets/logo.svg';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import SettingsMenu from '$lib/components/SettingsMenu.svelte';
	import { displayPrefs } from '$lib/stores/displayPrefs.svelte';
	import { session } from '$lib/stores/session.svelte';

	let { children } = $props();

	const links = [
		{ href: resolve('/'), label: 'Play' },
		{ href: resolve('/review'), label: 'Review' },
		{ href: resolve('/puzzles'), label: 'Puzzles' },
		{ href: resolve('/endgames'), label: 'Endgames' },
		{ href: resolve('/progress'), label: 'Progress' },
		{ href: resolve('/literature'), label: 'Literature' }
	];

	const welcome = resolve('/welcome');
	const onWelcome = $derived(page.url.pathname === welcome);

	// A friend game's link has to work for someone who has never been here.
	// They are not signed in and have not chosen to play anonymously — they
	// clicked a link — so the guard below would send them to a sign-up form
	// instead of the board they were invited to. The screen admits them
	// anonymously once it mounts; this is what lets it get that far.
	const onInvite = $derived(page.url.pathname.startsWith('/play/'));

	// That exemption is for arriving, not for staying. Once a visitor has been
	// admitted on an invite screen, losing it means they left (Settings →
	// Leave) or their session lapsed — and both of those belong on the welcome
	// screen exactly like anywhere else. Without this the invite route
	// swallows the redirect and leaves them on a board with no nav, which
	// reads as zen mode with no way out of it.
	//
	// Keyed by path, not a bare "has ever been admitted": that would hold
	// against the *next* link they open, so leaving a game would quietly make
	// every other invite in the same tab bounce to the welcome screen. Cleared
	// when the redirect fires, so re-opening the link they just left works too.
	//
	// Plain, not $state: written and read inside the one effect below, so there
	// is nothing to notify and no ordering to get wrong.
	let admittedOn: string | null = null;

	// Zen belongs to Play alone. The nav is the only way off a screen, so
	// hiding it anywhere the board isn't the whole point would strand the
	// visitor — and Play is the one screen that carries its own way out.
	const zen = $derived(displayPrefs.zenMode && page.url.pathname === resolve('/'));

	// onMount rather than the component body, matching how the play screen
	// starts its engine — a side effect that only makes sense in a browser
	// belongs after mount, not during initialization.
	onMount(() => {
		session.load();
	});

	// Nowhere to be but /welcome without an account or an anonymous session, or
	// signed in and still sitting on it. Gated on `ready` so the first paint
	// after a reload doesn't bounce a signed-in visitor through the welcome
	// screen before /auth/session lands. This is also what a 401 mid-session
	// lands on: the client clears the store, and the redirect follows.
	//
	// Only an account is sent away from /welcome. An anonymous player has a
	// reason to be there — it is where the sign-up form lives, and bouncing
	// them off it would make every "save your progress" link in the app a dead
	// end.
	$effect(() => {
		if (!session.ready) return;
		const path = page.url.pathname;
		if (session.admitted) admittedOn = path;
		// An invite link is only waved through for someone still on their way in.
		const arriving = onInvite && admittedOn !== path;
		if (!session.admitted && !onWelcome && !arriving) {
			admittedOn = null;
			goto(welcome, { replaceState: true });
		} else if (session.authenticated && onWelcome) {
			goto(resolve('/'), { replaceState: true });
		}
	});
</script>

<svelte:head><link rel="icon" href={logo} /></svelte:head>

<div class="app-shell">
	<a class="skip-link" href="#main-content">Skip to content</a>
	{#if session.admitted && !onWelcome && !zen}
		<header class="site-header">
			<div class="header-inner">
				<a href={resolve('/')} class="wordmark" aria-label="leechess home">
					<BrandMark class="brand-knight" />
					<span>leechess</span>
				</a>
				<nav class="primary-nav" aria-label="Main navigation">
					{#each links as link (link.href)}
						{@const active =
							link.href === resolve('/')
								? page.url.pathname === link.href || onInvite
								: page.url.pathname === link.href || page.url.pathname.startsWith(`${link.href}/`)}
						<a href={link.href} aria-current={active ? 'page' : undefined}>
							{link.label}
						</a>
					{/each}
				</nav>
				<div class="account-controls">
					{#if session.name}
						<span class="account-name" data-testid="nav-username" title={session.name}>
							{session.name}
						</span>
					{/if}
					{#if session.anonymous}
						<a href="{welcome}?mode=signup" data-testid="nav-sign-up" class="nav-signup">
							Sign up
						</a>
					{/if}
					<SettingsMenu />
				</div>
			</div>
		</header>
	{/if}
	<!-- Zen's stage positions itself against the viewport, so the page's own
	     column would only add a scrollbar behind it. -->
	<main id="main-content" class={zen ? '' : 'app-main'} class:welcome-main={onWelcome}>
		{#if session.ready}
			{@render children()}
		{/if}
	</main>
</div>

<style>
	.site-header {
		border-bottom: 3px double var(--color-line);
		background: var(--color-ornament-soft);
	}
	.header-inner {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		max-width: 64rem;
		min-height: 3rem;
		margin-inline: auto;
		padding-inline: 1rem;
	}
	.wordmark {
		display: flex;
		flex: none;
		align-items: center;
		gap: 0.375rem;
		font-family: var(--font-display);
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: -0.02em;
	}
	.wordmark :global(.brand-knight) {
		width: 1.5rem;
		height: 1.875rem;
	}
	.primary-nav {
		display: flex;
		align-self: stretch;
		justify-content: center;
		gap: 0.125rem;
		margin-inline: auto;
	}
	.primary-nav a {
		position: relative;
		display: flex;
		align-items: center;
		min-height: 2rem;
		padding: 0.125rem 0.625rem 0;
		border-bottom: 2px solid transparent;
		font-size: 0.875rem;
		font-variant-caps: small-caps;
		letter-spacing: 0.035em;
		color: var(--color-body);
	}
	.primary-nav a[aria-current='page'] {
		border-color: var(--color-accent);
		color: var(--color-accent);
		font-weight: 700;
	}
	.primary-nav a[aria-current='page']::after {
		content: '';
		position: absolute;
		bottom: -3px;
		left: calc(50% - 2px);
		width: 4px;
		height: 4px;
		background: currentColor;
		transform: rotate(45deg);
		pointer-events: none;
	}
	.primary-nav a:hover {
		color: var(--color-accent);
	}
	.account-controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.account-name {
		max-width: 7rem;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 0.75rem;
		color: var(--color-muted);
	}
	.nav-signup {
		display: inline-flex;
		align-items: center;
		min-height: 1.75rem;
		padding-inline: 0.5rem;
		border: 1px solid var(--color-accent-line);
		border-radius: 1px;
		font-size: 0.75rem;
		color: var(--color-accent);
		white-space: nowrap;
	}
	:global(.welcome-main) {
		padding-block: 1rem;
	}
	@media (max-width: 46rem) {
		.header-inner {
			flex-wrap: wrap;
			gap: 0 0.75rem;
			padding-block-start: 0.375rem;
		}
		.primary-nav {
			order: 3;
			width: 100%;
			justify-content: space-between;
			gap: 0;
		}
		.account-controls {
			margin-inline-start: auto;
		}
		.primary-nav a {
			padding-inline: 0.375rem;
		}
	}
	@media (max-width: 36rem) {
		.header-inner {
			padding-inline: 0.75rem;
		}
		.wordmark {
			font-size: 1.375rem;
		}
		.primary-nav a {
			font-size: 0.75rem;
			font-variant-caps: normal;
			letter-spacing: 0;
			padding-inline: 0.125rem;
		}
		.account-name {
			display: none;
		}
	}
</style>
