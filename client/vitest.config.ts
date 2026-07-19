// Unit tests only (pure lib modules + runes-based stores) — kept separate
// from vite.config.ts so the app build config stays untouched. E2e lives in
// playwright (*.e2e.ts).
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	// Compiles .svelte.ts rune modules (play.svelte.ts etc.) so the stores are
	// unit-testable outside a component.
	plugins: [svelte({ compilerOptions: { runes: true } })],
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url))
		},
		// Resolve svelte to its client (browser) runtime — the server runtime
		// compiles $state/$derived to plain one-shot values, which would freeze
		// the stores' reactivity under test.
		conditions: ['browser']
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
