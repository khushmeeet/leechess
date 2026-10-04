// Builds static/openings.json from the vendored lichess chess-openings TSVs
// (shared/chess-openings/, see its README for provenance — the server reads the
// same files for its book, app/openings.py). Each opening's PGN is replayed
// and every position along it is keyed by EPD (FEN minus the move counters),
// so in-game lookup survives transpositions. A line's final position maps to
// its [eco, name]; the positions on the way there map to null — they are
// still book (a move into one is a known move), just not a named opening.
// Runs before dev/build.
import { readFileSync, writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';

const openings = {};
let rows = 0;

const epdOf = (chess) => chess.fen().split(' ').slice(0, 4).join(' ');

for (const volume of ['a', 'b', 'c', 'd', 'e']) {
	const tsv = readFileSync(
		new URL(`../../shared/chess-openings/${volume}.tsv`, import.meta.url),
		'utf8'
	);
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
		// first-wins on duplicate positions (files processed a→e, deterministic);
		// a name always beats the null of a position passed through
		openings[epdOf(chess)] ||= [cells[ecoCol], cells[nameCol]];
		const replay = new Chess();
		for (const san of chess.history()) {
			replay.move(san);
			const epd = epdOf(replay);
			if (!(epd in openings)) openings[epd] = null;
		}
		rows += 1;
	}
}

const named = Object.values(openings).filter(Boolean).length;
const out = new URL('../static/openings.json', import.meta.url);
writeFileSync(out, JSON.stringify(openings));
console.log(
	`built openings.json: ${rows} rows, ${named} named positions, ` +
		`${Object.keys(openings).length} book positions`
);
