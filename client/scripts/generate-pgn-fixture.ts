// Generates the cross-library PGN fixture used by the server's
// test_pgn_roundtrip.py: a short game exported from chess.js with the FEN
// recorded after every ply, so python-chess can be asserted against the exact
// same data the client would produce.
//
// Run: bun scripts/generate-pgn-fixture.ts
import { writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';

const sans = [
	'e4',
	'e5',
	'Nf3',
	'Nc6',
	'Bc4',
	'Bc5',
	'O-O',
	'Nf6',
	'd3',
	'O-O',
	'Bg5',
	'h6',
	'Bxf6',
	'Qxf6',
	'Nc3',
	'd6',
	'Nd5',
	'Qd8',
	'c3',
	'a6'
];

const chess = new Chess();
chess.setHeader('Event', 'leechess fixture');
chess.setHeader('White', 'client');
chess.setHeader('Black', 'client');
chess.setHeader('Result', '*');

const fens: string[] = [];
for (const san of sans) {
	chess.move(san);
	fens.push(chess.fen());
}

const fixture = { pgn: chess.pgn(), sans, fens };
const out = new URL('../../server/tests/fixtures/clientside_game.json', import.meta.url);
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n');
console.log(`wrote ${out.pathname} (${sans.length} plies)`);
