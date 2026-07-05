import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';

// Required for SharedArrayBuffer, which multi-threaded stockfish.wasm depends
// on. Without these the engine silently falls back to single-threaded.
// Implemented as middleware (not `server.headers`) because SvelteKit's own
// dev/preview middleware serves pages without applying vite's header config.
// The FastAPI server sets the same headers for the deployed app.
function crossOriginIsolation(): Plugin {
	const setHeaders = (server: { middlewares: import('vite').Connect.Server }) => {
		server.middlewares.use((_req, res, next) => {
			res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
			res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
			next();
		});
	};
	return {
		name: 'cross-origin-isolation',
		configureServer: setHeaders,
		configurePreviewServer: setHeaders
	};
}

export default defineConfig({
	plugins: [
		crossOriginIsolation(),
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// SPA build: FastAPI serves the static output; /review/[gameId] is
			// resolved client-side via the fallback page.
			adapter: adapter({ fallback: 'index.html' })
		})
	]
});
