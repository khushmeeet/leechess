// Unit tests only (pure lib modules) — kept separate from vite.config.ts so
// the app build config stays untouched. E2e lives in playwright (*.e2e.ts).
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url))
		}
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
