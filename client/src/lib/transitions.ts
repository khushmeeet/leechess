/** Shared Svelte transitions.
 *
 * Most entrances in the app are CSS-only, via @starting-style in the
 * component's own scoped styles — nothing that only ever appears needs
 * JavaScript to appear. These exist for the handful of surfaces that come AND
 * go: @starting-style has no say in what happens on the way out, so a panel
 * that fades in and then vanishes on a frame is worse than one that never
 * animated at all.
 *
 * The curve is `cubicOut`, which is the closest of Svelte's built-in easings
 * to the app's --ease-rise (cubic-bezier(0.2, 0, 0, 1)) — near enough that a
 * CSS entrance and a JS one running side by side read as the same gesture.
 */
import { prefersReducedMotion } from 'svelte/motion';
import { fade, fly, type FlyParams, type TransitionConfig } from 'svelte/transition';

/** The app's standard entrance: up 4px and in, out the way it came.
 *
 * Use as `in:rise` / `out:rise={{ duration: 160 }}` rather than a single
 * `transition:` — exits want to be quicker than entrances, and the directive
 * form is the only way to say so.
 *
 * Reduced motion gets a plain fade rather than nothing: these mark sections
 * that appear mid-game, and the appearance itself is the information. A
 * shorter fade keeps that legible without the travel.
 */
export function rise(
	node: Element,
	{ duration = 200, y = 4, delay = 0 }: FlyParams = {}
): TransitionConfig {
	if (prefersReducedMotion.current) return fade(node, { duration: Math.min(duration, 150), delay });
	return fly(node, { y, duration, delay, opacity: 0 });
}
