<script lang="ts">
	// A button that commits only once it has been held down. For actions that
	// are unrecoverable and one click away — resignation, today — where the
	// cost of a slip is a lost game and the cost of the hold is a second.
	//
	// The fill is not decoration: it is the affordance. It says the press was
	// heard, says the action has not happened yet, and says how much longer
	// you have to change your mind. That is why it survives reduced motion —
	// there is no static version of "keep holding" to fall back to.
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface Props extends HTMLButtonAttributes {
		/** Fired once the hold has been held to completion. */
		oncomplete: () => void;
		/** How long the button must be held, in ms. */
		holdMs?: number;
		children: Snippet;
	}

	let { oncomplete, holdMs = 1200, class: className = '', children, ...rest }: Props = $props();

	let el: HTMLButtonElement;
	let holding = $state(false);

	function start() {
		holding = true;
	}

	function cancel() {
		holding = false;
	}

	/** Capture the pointer for the whole hold, so the press belongs to this
	 * button until it is released.
	 *
	 * Without it the hold is cancelled by the button moving rather than by the
	 * pointer moving. On the Play screen the insight panel sits directly above
	 * Resign and grows while Stockfish replies — the opening line resolves, the
	 * ideas chips arrive — which slides the button out from under a finger that
	 * never went anywhere, fires pointerleave, and quietly drops the hold. */
	function onPointerDown(event: PointerEvent) {
		el.setPointerCapture(event.pointerId);
		start();
	}

	/** Sliding off the button still cancels — capture just means it has to be
	 * measured rather than delivered as pointerleave. Against the live rect,
	 * which is the entire point: the button moving is not the pointer leaving. */
	function onPointerMove(event: PointerEvent) {
		if (!holding) return;
		const box = el.getBoundingClientRect();
		const inside =
			event.clientX >= box.left &&
			event.clientX <= box.right &&
			event.clientY >= box.top &&
			event.clientY <= box.bottom;
		if (!inside) cancel();
	}

	/** The fill reaching full width IS the completion — the timer and the thing
	 * you are watching cannot disagree, because they are the same thing. A
	 * backgrounded tab stops painting and so never commits, which is the right
	 * failure: nobody resigns a game they are not looking at. */
	function onTransitionEnd(event: TransitionEvent) {
		if (!holding || event.propertyName !== 'clip-path') return;
		holding = false;
		oncomplete();
	}

	const HOLD_KEYS = new Set(['Enter', ' ']);

	function onKeyDown(event: KeyboardEvent) {
		if (!HOLD_KEYS.has(event.key)) return;
		// Suppresses the click the browser would synthesize from this press,
		// which would otherwise commit instantly and skip the hold entirely.
		// Also stops Space from scrolling the page while held.
		event.preventDefault();
		// Auto-repeat fires keydown continuously while held; restarting the fill
		// on each one would mean the button could never finish.
		if (event.repeat) return;
		start();
	}

	function onKeyUp(event: KeyboardEvent) {
		if (HOLD_KEYS.has(event.key)) cancel();
	}

	function onClick(event: MouseEvent) {
		// Real presses never get here as anything actionable: a pointer press
		// ends in pointerup (detail 1, ignored below) and a key press has its
		// synthesized click suppressed in onKeyDown. What is left is
		// programmatic activation — assistive technology calling .click() —
		// which carries no pointer state at all. Holding is not a gesture some
		// AT can express, and an activation it had to construct deliberately is
		// already past the slip this guards against.
		if (event.detail === 0) oncomplete();
	}
</script>

<button
	bind:this={el}
	type="button"
	class="hold {className}"
	class:holding
	style="--hold-ms: {holdMs}ms"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={cancel}
	onpointercancel={cancel}
	onkeydown={onKeyDown}
	onkeyup={onKeyUp}
	onblur={cancel}
	onclick={onClick}
	{...rest}
>
	<span class="hold-fill" aria-hidden="true" ontransitionend={onTransitionEnd}></span>
	<span class="hold-label">{@render children()}</span>
</button>

<style>
	.hold {
		position: relative;
		overflow: hidden;
	}

	/* Wipes left to right across the button's own face. --color-err-bg rather
	 * than the accent: this is the colour the app already uses for the
	 * consequence, and the button is filling up with it. */
	.hold-fill {
		position: absolute;
		z-index: 0;
		inset: 0;
		background: var(--color-err-bg);
		clip-path: inset(0 100% 0 0);
		/* Release: the fill retreats rather than vanishing, so a press abandoned
		 * halfway reads as cancelled instead of as a glitch. */
		transition: clip-path 200ms var(--ease-rise);
	}

	.hold.holding .hold-fill {
		clip-path: inset(0 0 0 0);
		/* linear, not eased: this bar is a clock. An eased fill would sit near
		 * the end looking finished for a good fraction of the hold. */
		transition: clip-path var(--hold-ms) linear;
	}

	.hold-label {
		position: relative;
		z-index: 1;
	}
</style>
