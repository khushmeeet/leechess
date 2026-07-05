import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.{ts,js}',
	use: { baseURL: 'http://localhost:4173' },
	webServer: [
		{
			// VITE_API_URL points the built SPA at the backend below; in a real
			// deploy FastAPI serves the SPA itself and requests are same-origin.
			command: 'VITE_API_URL=http://localhost:8000 npm run build && npm run preview',
			port: 4173
		},
		{
			command: 'mkdir -p data && rm -f data/e2e.db && uv run uvicorn app.main:app --port 8000',
			cwd: '../server',
			port: 8000,
			env: { LEECHESS_DB_URL: 'sqlite:///data/e2e.db' }
		}
	]
});
