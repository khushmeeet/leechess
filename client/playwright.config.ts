import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.{ts,js}',
	// One worker: specs share the WASM engine's CPU budget, and the live-
	// feedback timing assertions (500ms badge) flake under parallel load.
	workers: 1,
	use: { baseURL: 'http://localhost:4173' },
	webServer: [
		{
			// VITE_API_URL points the built SPA at the backend below; in a real
			// deploy FastAPI serves the SPA itself and requests are same-origin.
			command: 'VITE_API_URL=http://localhost:8000 npm run build && npm run preview',
			port: 4173,
			reuseExistingServer: !process.env.CI
		},
		{
			command: 'mkdir -p data && rm -f data/e2e.db && uv run uvicorn app.main:app --port 8000',
			cwd: '../server',
			port: 8000,
			// low analysis depth keeps the review e2e fast; the tests assert
			// plumbing (statuses, fields), not eval quality. PATH is stripped
			// of node_modules/.bin: the npm `stockfish` package's JS stub
			// would otherwise shadow the native binary for the analysis job.
			env: {
				LEECHESS_DB_URL: 'sqlite:///data/e2e.db',
				LEECHESS_ANALYSIS_DEPTH: '12',
				PATH: (process.env.PATH ?? '')
					.split(':')
					.filter((dir) => !dir.includes('node_modules'))
					.join(':')
			},
			reuseExistingServer: !process.env.CI
		}
	]
});
