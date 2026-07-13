// Builds static/openings.json from the vendored lichess chess-openings TSVs
// (scripts/chess-openings/, see its README for provenance). Each opening's PGN
// is replayed to its final position and keyed by EPD (FEN minus the move
// counters) so in-game lookup survives transpositions. Runs before dev/build.
import { readFileSync, writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';

const openings = {};
let rows = 0;

for (const volume of ['a', 'b', 'c', 'd', 'e']) {
	const tsv = readFileSync(new URL(`./chess-openings/${volume}.tsv`, import.meta.url), 'utf8');
	const lines = tsv.split('\n').filter((line) => line.trim() !== '');
	const header = lines[0].split('\t');
	const [ecoCol, nameCol, pgnCol] = ['eco', 'name', 'pgn'].map((col) => {
		const index = header.indexOf(col);
		if (index === -1) throw new Error(`${volume}.tsv: missing "${col}" column`);
		return index;
	});

	for (const line of lines.slice(1)) {
		const cells = line.split('\t');
		const chess = new Chess();
		chess.loadPgn(cells[pgnCol]);
		const epd = chess.fen().split(' ').slice(0, 4).join(' ');
		// first-wins on duplicate positions (files processed a→e, deterministic)
		openings[epd] ??= [cells[ecoCol], cells[nameCol]];
		rows += 1;
	}
}

const out = new URL('../static/openings.json', import.meta.url);
writeFileSync(out, JSON.stringify(openings));
console.log(`built openings.json: ${rows} rows, ${Object.keys(openings).length} positions`);
