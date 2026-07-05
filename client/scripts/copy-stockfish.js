// Copies the stockfish WASM builds from node_modules into static/ so the Web
// Worker can load them from /stockfish/. Runs automatically before dev/build.
import { copyFileSync, mkdirSync } from 'node:fs';

const files = [
	'stockfish-18-lite.js', // multi-threaded, needs crossOriginIsolated
	'stockfish-18-lite.wasm',
	'stockfish-18-lite-single.js', // fallback when SharedArrayBuffer is unavailable
	'stockfish-18-lite-single.wasm'
];

mkdirSync(new URL('../static/stockfish/', import.meta.url), { recursive: true });
for (const file of files) {
	copyFileSync(
		new URL(`../node_modules/stockfish/bin/${file}`, import.meta.url),
		new URL(`../static/stockfish/${file}`, import.meta.url)
	);
}
console.log(`copied ${files.length} stockfish files to static/stockfish/`);
