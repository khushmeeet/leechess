import { defineConfig } from '@playwright/test';

// The suite used to run the backend on 8000 with `reuseExistingServer: !CI`,
// which meant a developer with the normal app already on 8000 silently handed
// the browser tests their real database: none of the environment below
// (throwaway db, LLM/Wikibooks/auto-seed off, the reset endpoint) would have
// applied. The backend now has a port of its own, and reuse is off for BOTH
// servers — if something else already holds a port, the run fails to start
// instead of quietly adopting a stranger's process.
const API_PORT = 8123;
// The preview stays on vite's default, which is one of the origins the
// backend's dev CORS list allows; `--strictPort` plus no reuse means the run
// aborts rather than binding somewhere the browser could not call the API
// from.
const PREVIEW_PORT = 4173;
const API_URL = `http://localhost:${API_PORT}`;

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.{ts,js}',
	// One worker: specs share the WASM engine's CPU budget, the live-
	// feedback timing assertions (500ms badge) flake under parallel load, and
	// the per-test database reset in e2e/fixtures.ts is process-wide.
	workers: 1,
	use: {
		baseURL: `http://localhost:${PREVIEW_PORT}`,
		// Tall enough for the whole board to be on screen. At Playwright's
		// 1280x720 default the first rank falls below the fold, and
		// page.mouse.click (unlike locator.click) does not scroll — so clicks
		// on g1/b1 landed outside the viewport and were silently swallowed.
		// That is what made "the game continues where it left off" unable to
		// play Ng1-f3 after a reload. Specs that care about narrow layouts set
		// their own viewport.
		viewport: { width: 1280, height: 900 }
	},
	webServer: [
		{
			// VITE_API_URL points the built SPA at the backend below; in a real
			// deploy FastAPI serves the SPA itself and requests are same-origin.
			// The value is baked in at build time, which is the other reason not
			// to reuse a stray preview server: it would be pointed elsewhere.
			command: `VITE_API_URL=${API_URL} npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
			port: PREVIEW_PORT,
			reuseExistingServer: false
		},
		{
			command: `mkdir -p data && rm -f data/e2e.db && uv run uvicorn app.main:app --port ${API_PORT}`,
			cwd: '../server',
			port: API_PORT,
			// low analysis depth keeps the review e2e fast; the tests assert
			// plumbing (statuses, fields), not eval quality. PATH is stripped
			// of node_modules/.bin: the npm `stockfish` package's JS stub
			// would otherwise shadow the native binary for the analysis job.
			env: {
				LEECHESS_DB_URL: 'sqlite:///data/e2e.db',
				LEECHESS_ANALYSIS_DEPTH: '12',
				// the analysis job's Phase 5 LLM pass must never hit the real
				// (paid) Claude API from the e2e suite
				LEECHESS_EXPLANATIONS: 'off',
				// likewise the review WikiBook panel must never hit the real
				// Wikibooks API
				LEECHESS_WIKIBOOK: 'off',
				// and never auto-download the Lichess puzzle dump
				LEECHESS_AUTO_SEED: 'off',
				// mounts POST /testing/reset, which e2e/fixtures.ts calls before
				// every test so no spec inherits another's data
				LEECHESS_TEST_RESET: 'on',
				// preview and API are both plain http, and a browser will not send
				// a Secure cookie back over that — every request after sign-in
				// would look anonymous
				LEECHESS_AUTH_COOKIE_SECURE: 'off',
				// >=32 bytes, or PyJWT warns on every token it signs and verifies
				LEECHESS_AUTH_SECRET: 'e2e-secret-not-for-deployment-0123456789',
				PATH: (process.env.PATH ?? '')
					.split(':')
					.filter((dir) => !dir.includes('node_modules'))
					.join(':')
			},
			reuseExistingServer: false
		}
	]
});

export { API_URL, API_PORT, PREVIEW_PORT };
