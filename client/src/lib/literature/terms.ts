/** The glossary of the Literature screen. Every definition is original text
 * written against the linked source (Wikipedia's chess corpus and the FIDE
 * Laws of Chess), so each entry can be checked against where it came from.
 * A future Wikipedia-synced version is sketched in
 * chess-learning-app-literature-live-sync-plan.md at the repo root. */

export type TermCategory = 'rules' | 'tactics' | 'strategy' | 'endgame' | 'openings' | 'culture';

export const CATEGORY_LABELS: Record<TermCategory, string> = {
	rules: 'Rules & notation',
	tactics: 'Tactics',
	strategy: 'Strategy',
	endgame: 'Endgame',
	openings: 'Openings',
	culture: 'Competition & culture'
};

export interface Term {
	term: string;
	def: string;
	category: TermCategory;
	source: string;
}

// Source shorthands. Glossary anchors are lowercase-with-underscores; if an
// anchor is ever renamed upstream the link still lands on the glossary.
const G = 'https://en.wikipedia.org/wiki/Glossary_of_chess#';
const W = 'https://en.wikipedia.org/wiki/';
const FIDE = 'https://handbook.fide.com/chapter/E012023';

export const TERMS: Term[] = [
	// ——— Rules & notation ———
	{
		term: 'Check',
		def: 'A direct attack on the king. It must be answered immediately — by moving the king, blocking, or capturing the attacker — and no move may ever leave one’s own king in check.',
		category: 'rules',
		source: FIDE
	},
	{
		term: 'Checkmate',
		def: 'A check that no legal move can answer. It ends the game on the spot, won by the side giving it — from the Persian shāh māt, “the king is helpless.”',
		category: 'rules',
		source: FIDE
	},
	{
		term: 'Stalemate',
		def: 'The player to move is not in check but has no legal move: the game is drawn. One of the defender’s great escape hatches in otherwise lost endgames.',
		category: 'rules',
		source: FIDE
	},
	{
		term: 'Castling',
		def: 'The only move that touches two pieces: the king steps two squares toward a rook and the rook hops to the square the king crossed. Forbidden once either piece has moved, while in check, or through an attacked square.',
		category: 'rules',
		source: FIDE
	},
	{
		term: 'Kingside & queenside',
		def: 'The board’s two halves: files e–h (where the kings start) and a–d (where the queens do). Castling short — O-O — goes kingside; castling long — O-O-O — queenside.',
		category: 'rules',
		source: G + 'kingside'
	},
	{
		term: 'En passant',
		def: 'French for “in passing”: when a pawn advances two squares, an enemy pawn beside its arrival square may capture it as if it had moved only one. The right lasts a single move, then vanishes.',
		category: 'rules',
		source: FIDE
	},
	{
		term: 'Promotion',
		def: 'A pawn that reaches the far rank must become a queen, rook, bishop, or knight of its own colour — its player’s choice, almost always a queen.',
		category: 'rules',
		source: FIDE
	},
	{
		term: 'Underpromotion',
		def: 'Promoting to anything less than a queen — usually a knight for a fork or check the queen could not give, occasionally a rook or bishop to sidestep stalemate.',
		category: 'rules',
		source: G + 'underpromotion'
	},
	{
		term: 'Fifty-move rule',
		def: 'Either player may claim a draw once fifty consecutive moves by each side have passed with no capture and no pawn move. The clock that quietly runs under every long endgame grind.',
		category: 'rules',
		source: FIDE
	},
	{
		term: 'Threefold repetition',
		def: 'A draw may be claimed when the same position — same side to move, same castling and en passant rights — occurs for the third time. The moves in between need not repeat.',
		category: 'rules',
		source: FIDE
	},
	{
		term: 'Touch-move rule',
		def: 'Over the board, deliberately touching your piece commits you to moving it if it has a legal move; touching an enemy piece commits you to capturing it if you legally can.',
		category: 'rules',
		source: FIDE
	},
	{
		term: 'J’adoube',
		def: '“I adjust” — announced before straightening a piece on its square, so the touch-move rule is not triggered. Say it first, then touch.',
		category: 'rules',
		source: G + 'j%27adoube'
	},
	{
		term: 'Ranks, files & diagonals',
		def: 'The board’s three kinds of lines: ranks run sideways (1–8), files run up the board (a–h), and diagonals are the slanted rows of same-coloured squares that bishops and queens travel.',
		category: 'rules',
		source: G + 'rank'
	},
	{
		term: 'Algebraic notation',
		def: 'The standard shorthand for recording moves: a piece letter and its destination — Nf3, Qxd5 — with x for captures, + for check, # for mate, and O-O for castling.',
		category: 'rules',
		source: W + 'Algebraic_notation_(chess)'
	},
	{
		term: 'PGN',
		def: 'Portable Game Notation: the plain-text format chess games travel in. Tag pairs (Event, players, Result) followed by the movetext in algebraic notation — every game in this app is one.',
		category: 'rules',
		source: W + 'Portable_Game_Notation'
	},
	{
		term: 'FEN',
		def: 'Forsyth–Edwards Notation: a whole position on one line — piece placement rank by rank, side to move, castling rights, en passant square, and the move counters.',
		category: 'rules',
		source: W + 'Forsyth%E2%80%93Edwards_Notation'
	},
	{
		term: 'Ply',
		def: 'One move by one side; a full move is two plies. Engines measure search depth in plies — “depth 20” means ten of your moves and ten replies deep.',
		category: 'rules',
		source: W + 'Ply_(game_theory)'
	},
	{
		term: 'Material',
		def: 'The army itself, weighed on the traditional scale: pawn 1, knight and bishop 3, rook 5, queen 9. Being “up material” means the ledger favours you — though position can outweigh the ledger.',
		category: 'rules',
		source: W + 'Chess_piece_relative_value'
	},
	{
		term: 'The exchange',
		def: 'The specific trade of a minor piece for a rook. The side with the rook has “won the exchange”; giving it up on purpose is an exchange sacrifice.',
		category: 'rules',
		source: G + 'exchange'
	},
	{
		term: 'Tempo',
		def: 'One move considered as a unit of time. You gain a tempo when your opponent must spend a move answering you; you lose one when a piece must move twice to reach its post.',
		category: 'rules',
		source: G + 'tempo'
	},
	{
		term: 'Dead position',
		def: 'A position from which no series of legal moves could ever produce checkmate — bare kings, most famously. The game is drawn the moment it arises.',
		category: 'rules',
		source: FIDE
	},

	// ——— Tactics ———
	{
		term: 'Tactic',
		def: 'A short forcing operation — checks, captures, threats — that wins material or delivers mate. Strategy decides where the pieces belong; tactics decide what they take.',
		category: 'tactics',
		source: W + 'Chess_tactic'
	},
	{
		term: 'Fork',
		def: 'One piece attacks two or more targets at once, and only one can be saved. Knights are the classic forkers — their crooked move makes double attacks the straight pieces never see.',
		category: 'tactics',
		source: W + 'Fork_(chess)'
	},
	{
		term: 'Pin',
		def: 'A piece that cannot — or should not — move, because a bigger prize stands behind it on the same line. Against the king the pin is absolute (moving is illegal); against anything else it is relative.',
		category: 'tactics',
		source: W + 'Pin_(chess)'
	},
	{
		term: 'Skewer',
		def: 'A pin turned inside out: the more valuable piece stands in front, must step aside, and surrenders the piece sheltering behind it.',
		category: 'tactics',
		source: W + 'Skewer_(chess)'
	},
	{
		term: 'Discovered attack',
		def: 'Moving one piece unmasks an attack from another waiting behind it. The moving piece is free to make its own threat — two attacks for the price of one move.',
		category: 'tactics',
		source: W + 'Discovered_attack'
	},
	{
		term: 'Discovered check',
		def: 'A discovered attack in which the unmasked piece gives check. The piece that moved can grab almost anything — the check must be answered first.',
		category: 'tactics',
		source: W + 'Discovered_attack'
	},
	{
		term: 'Double check',
		def: 'Two pieces give check at once, always by discovery. No block or capture can parry both, so the king must move — the most forcing move in chess.',
		category: 'tactics',
		source: G + 'double_check'
	},
	{
		term: 'Double attack',
		def: 'Any single move that creates two threats at once. The fork is its most famous shape, but a move can also threaten mate on one wing and a loose piece on the other.',
		category: 'tactics',
		source: G + 'double_attack'
	},
	{
		term: 'Battery',
		def: 'Two or more pieces stacked on one line — queen and rook doubling a file, queen and bishop sharing a diagonal — so that the front piece’s move unleashes the rear one.',
		category: 'tactics',
		source: G + 'battery'
	},
	{
		term: 'Zwischenzug',
		def: 'German for “in-between move”: instead of the expected recapture, an even more forcing move first — a check or bigger threat — and only then the recapture. Also called an intermezzo.',
		category: 'tactics',
		source: W + 'Zwischenzug'
	},
	{
		term: 'Deflection',
		def: 'Dragging a defender away from its duty, usually with a sacrifice it cannot refuse. Once the guard leaves its post, the real blow lands.',
		category: 'tactics',
		source: G + 'deflection'
	},
	{
		term: 'Decoy',
		def: 'The mirror of deflection: luring an enemy piece — often the king itself — onto a square where something terrible awaits it.',
		category: 'tactics',
		source: G + 'decoy'
	},
	{
		term: 'Overloading',
		def: 'Giving one defender too many jobs. A piece guarding two things defends neither: attack one duty and the other falls.',
		category: 'tactics',
		source: W + 'Overloading_(chess)'
	},
	{
		term: 'Interference',
		def: 'Thrusting a piece — often a sacrifice — onto the line between an enemy piece and whatever it defends, cutting the wire.',
		category: 'tactics',
		source: W + 'Interference_(chess)'
	},
	{
		term: 'Removing the defender',
		def: 'Capturing or driving off the piece that holds the opponent’s position together. Also called undermining: don’t attack the strong point, attack what supports it.',
		category: 'tactics',
		source: W + 'Undermining_(chess)'
	},
	{
		term: 'X-ray',
		def: 'A piece’s influence continuing through an enemy piece on its line — the hidden defence or attack that materialises the moment the blocker moves or is exchanged.',
		category: 'tactics',
		source: G + 'x-ray'
	},
	{
		term: 'Desperado',
		def: 'A piece that is lost anyway sells itself as dearly as possible, grabbing whatever it can before being taken. Often the punchline of a zwischenzug sequence.',
		category: 'tactics',
		source: W + 'Desperado_(chess)'
	},
	{
		term: 'Windmill',
		def: 'A repeating cycle of discovered checks that strips the board bare, the victim powerless to interrupt. Torre’s windmill against Lasker (Moscow 1925) is the canonical nightmare.',
		category: 'tactics',
		source: W + 'Windmill_(chess)'
	},
	{
		term: 'Sacrifice',
		def: 'Giving up material on purpose — for attack, for mate, or for compensation that has no number. The move that makes chess an art as well as an argument.',
		category: 'tactics',
		source: W + 'Sacrifice_(chess)'
	},
	{
		term: 'Exchange sacrifice',
		def: 'Surrendering a rook for a minor piece to buy something the ledger can’t see: a monster knight, wrecked enemy pawns, an unstoppable attack.',
		category: 'tactics',
		source: G + 'exchange_sacrifice'
	},
	{
		term: 'Greek gift',
		def: 'The classic bishop sacrifice Bxh7+ against a castled king, followed by Ng5+ and the queen’s arrival. Centuries old and still collecting victims.',
		category: 'tactics',
		source: W + 'Greek_gift_sacrifice'
	},
	{
		term: 'Clearance',
		def: 'Moving — or sacrificing — a piece purely to vacate the square or line another piece urgently needs. The furniture is rearranged; the attack walks in.',
		category: 'tactics',
		source: G + 'clearance'
	},
	{
		term: 'Smothered mate',
		def: 'A knight mates a king walled in by its own pieces. The classic finish: queen sacrifice on g8, rook takes, knight to f7 — checkmate with the whole royal court watching.',
		category: 'tactics',
		source: W + 'Smothered_mate'
	},
	{
		term: 'Back-rank mate',
		def: 'Mate delivered along the home rank to a king trapped behind its own unmoved pawns. The reason strong players give their king “luft” — air — with a quiet pawn move.',
		category: 'tactics',
		source: W + 'Back-rank_checkmate'
	},
	{
		term: 'Mating net',
		def: 'A configuration from which the enemy king cannot escape, even if the mate itself is moves away. The hunter stops chasing and starts closing gates.',
		category: 'tactics',
		source: G + 'mating_net'
	},
	{
		term: 'Perpetual check',
		def: 'An endless series of checks the defender can never escape, forcing a draw by repetition — the losing side’s most beloved swindle.',
		category: 'tactics',
		source: W + 'Perpetual_check'
	},
	{
		term: 'Trapped piece',
		def: 'A piece with no safe square left. It need not be attacked yet — once it cannot run, the capture is only a matter of arrangement.',
		category: 'tactics',
		source: G + 'trapped_piece'
	},
	{
		term: 'Combination',
		def: 'A forcing, usually sacrificial sequence that welds several tactical motifs into one irresistible whole. The landmark games below are mostly famous for exactly this.',
		category: 'tactics',
		source: W + 'Combination_(chess)'
	},
	{
		term: 'Motif',
		def: 'The recurring tactical pattern — pin, fork, deflection — that a combination is built from. The puzzle trainer here tags every exercise by its motif so the patterns sink in.',
		category: 'tactics',
		source: G + 'motif'
	},

	// ——— Strategy ———
	{
		term: 'Strategy',
		def: 'The long game: pawn structure, piece placement, king safety, and plans measured in phases rather than moves. Tactics serve strategy; strategy earns tactics.',
		category: 'strategy',
		source: W + 'Chess_strategy'
	},
	{
		term: 'Development',
		def: 'Getting pieces off their starting squares to working posts — the opening’s first law. Count how many of your pieces are doing something; the Opera Game shows what happens when you don’t.',
		category: 'strategy',
		source: G + 'development'
	},
	{
		term: 'The centre',
		def: 'The four middle squares and their orbit. Pieces posted there reach everywhere; pieces that control it dictate where the game is played.',
		category: 'strategy',
		source: G + 'center'
	},
	{
		term: 'Initiative',
		def: 'The privilege of making threats the opponent must answer. It is the most perishable advantage in chess — unused for a move or two, it simply evaporates.',
		category: 'strategy',
		source: G + 'initiative'
	},
	{
		term: 'Space',
		def: 'Territory claimed by your pawn front. More space means freer pieces and easier regrouping; the cramped side suffocates slowly unless it can trade pieces.',
		category: 'strategy',
		source: G + 'space'
	},
	{
		term: 'Pawn structure',
		def: 'The skeleton of the position — the pawns’ arrangement, which changes slowly and cannot change back. It dictates the right plans for both sides long before the players choose them.',
		category: 'strategy',
		source: W + 'Pawn_structure'
	},
	{
		term: 'Doubled pawns',
		def: 'Two friendly pawns stacked on one file, unable to defend one another. Usually a liability, occasionally a strength — the open file next door can be worth the scars.',
		category: 'strategy',
		source: W + 'Doubled_pawns'
	},
	{
		term: 'Isolated pawn',
		def: 'A pawn with no friend on either adjacent file — no pawn can ever defend it. The isolated queen’s pawn is a whole opening philosophy: middlegame dynamism traded against endgame grief.',
		category: 'strategy',
		source: W + 'Isolated_pawn'
	},
	{
		term: 'Backward pawn',
		def: 'A pawn that has fallen behind its neighbours and cannot advance without being lost, usually stuck on a half-open file where a rook glares at it all game.',
		category: 'strategy',
		source: W + 'Backward_pawn'
	},
	{
		term: 'Passed pawn',
		def: 'A pawn no enemy pawn can block or capture on its road to promotion. “A criminal that must be kept under lock and key,” said Nimzowitsch — every endgame bends around one.',
		category: 'strategy',
		source: W + 'Passed_pawn'
	},
	{
		term: 'Connected passed pawns',
		def: 'Two passed pawns on adjacent files, shepherding each other forward. Against rooks they are frequently decisive; the defender can stop one but rarely both.',
		category: 'strategy',
		source: W + 'Passed_pawn'
	},
	{
		term: 'Pawn island',
		def: 'A connected group of friendly pawns. Count your islands against your opponent’s: fewer islands means fewer fronts to defend when the endgame arrives.',
		category: 'strategy',
		source: G + 'pawn_island'
	},
	{
		term: 'Pawn chain',
		def: 'Pawns locked diagonally, each defending the next. Nimzowitsch’s prescription is proverbial: attack the chain at its base, where no pawn defends.',
		category: 'strategy',
		source: W + 'Pawn_chain'
	},
	{
		term: 'Pawn break',
		def: 'The pawn advance that challenges the enemy structure and opens lines. Nearly every middlegame plan is really the preparation of one break, timed well.',
		category: 'strategy',
		source: G + 'break'
	},
	{
		term: 'Hanging pawns',
		def: 'Two adjacent friendly pawns on half-open files with no pawn support on either side — dynamic while they can advance, targets the moment they’re fixed.',
		category: 'strategy',
		source: G + 'hanging_pawns'
	},
	{
		term: 'Pawn storm',
		def: 'Hurling pawns at the enemy king’s shelter to prise open files, the standard plan when the kings castle on opposite wings and both sides race.',
		category: 'strategy',
		source: G + 'pawn_storm'
	},
	{
		term: 'Weak square',
		def: 'A square your pawns can no longer defend — a hole. An enemy piece that settles there cannot be evicted by pawns, only expensively exchanged.',
		category: 'strategy',
		source: G + 'weak_square'
	},
	{
		term: 'Outpost',
		def: 'A protected square deep in enemy territory, safe from pawn attack — a knight’s dream address. Kasparov’s knight on d3 against Karpov in 1985 was nicknamed “the octopus.”',
		category: 'strategy',
		source: G + 'outpost'
	},
	{
		term: 'Good & bad bishop',
		def: 'A bishop hemmed in by its own pawns on its colour is “bad”; one sweeping open diagonals is “good.” The difference decides many an endgame before it begins.',
		category: 'strategy',
		source: G + 'bad_bishop'
	},
	{
		term: 'Bishop pair',
		def: 'Both bishops against bishop-and-knight or two knights. On an open board the pair is a small, stubborn, real advantage — two long guns covering both colours.',
		category: 'strategy',
		source: G + 'bishop_pair'
	},
	{
		term: 'Opposite-coloured bishops',
		def: 'Bishops that can never meet or trade. In endgames they breathe drawishness — each side owns half the squares — but in middlegame attacks the attacker is effectively a piece up.',
		category: 'strategy',
		source: W + 'Opposite-colored_bishops_endgame'
	},
	{
		term: 'Fianchetto',
		def: 'Italian for “little flank”: developing a bishop to b2 or g2 (b7 or g7), where it commands the long diagonal from home. The signature of hypermodern openings.',
		category: 'strategy',
		source: W + 'Fianchetto'
	},
	{
		term: 'Open & half-open files',
		def: 'A file with no pawns is open — the rook’s highway. A file with only enemy pawns is half-open: a ready-made siege line against them.',
		category: 'strategy',
		source: G + 'open_file'
	},
	{
		term: 'Seventh rank',
		def: 'The rank the enemy pawns call home. A rook that reaches it eats sideways and boxes in the king; two rooks there — “pigs on the seventh” — are usually decisive.',
		category: 'strategy',
		source: G + 'seventh_rank'
	},
	{
		term: 'Rook lift',
		def: 'Swinging a rook up and over — Re1–e3–g3 — in front of its own pawns, joining an attack no file would carry it to.',
		category: 'strategy',
		source: G + 'rook_lift'
	},
	{
		term: 'Blockade',
		def: 'Planting a piece — ideally a knight — directly in front of an enemy passed or isolated pawn. The pawn stops, and its own body shields the blockader from the rooks behind it.',
		category: 'strategy',
		source: G + 'blockade'
	},
	{
		term: 'Prophylaxis',
		def: 'Preventing the opponent’s idea before pursuing your own — Nimzowitsch’s great teaching. Ask what they want to do; make that impossible; then play your move.',
		category: 'strategy',
		source: W + 'Prophylaxis_(chess)'
	},
	{
		term: 'Minority attack',
		def: 'Marching fewer pawns against more — classically two against three on the queenside — to force open a file and saddle the defender with a lasting weakness.',
		category: 'strategy',
		source: G + 'minority_attack'
	},
	{
		term: 'Compensation',
		def: 'What you hold instead of the material you gave: time, open lines, a stranded enemy king, an outpost for life. Judging it accurately is half of chess maturity.',
		category: 'strategy',
		source: G + 'compensation'
	},
	{
		term: 'Simplification',
		def: 'Trading pieces on purpose — to convert an extra pawn, to strangle an attack, or to steer into an endgame the structure already promises you.',
		category: 'strategy',
		source: G + 'simplification'
	},
	{
		term: 'Candidate moves',
		def: 'The shortlist of plausible moves you gather before calculating any of them deeply — Kotov’s discipline from Think Like a Grandmaster. Breadth first, then depth.',
		category: 'strategy',
		source: G + 'candidate_move'
	},

	// ——— Endgame ———
	{
		term: 'Endgame',
		def: 'The final phase: queens often gone, kings promoted to fighting pieces, and every pawn a potential queen. Here technique is knowledge — the positions below have names because they recur.',
		category: 'endgame',
		source: W + 'Chess_endgame'
	},
	{
		term: 'Opposition',
		def: 'Kings facing each other with one square between them: whoever must move gives ground. The tug-of-war that decides most king-and-pawn endings.',
		category: 'endgame',
		source: W + 'Opposition_(chess)'
	},
	{
		term: 'Zugzwang',
		def: 'German for “compulsion to move”: every legal move makes things worse, and passing is not allowed. The obligation to move — usually a right — becomes the losing burden. See the Immortal Zugzwang Game below.',
		category: 'endgame',
		source: W + 'Zugzwang'
	},
	{
		term: 'Triangulation',
		def: 'Losing a move on purpose: the king walks a small triangle while the enemy king has only two squares, handing the opponent the move — and the zugzwang.',
		category: 'endgame',
		source: W + 'Triangulation_(chess)'
	},
	{
		term: 'Key squares',
		def: 'The squares in a pawn ending whose occupation by the attacking king guarantees the result by force. Learn the key squares and the counting does itself.',
		category: 'endgame',
		source: W + 'King_and_pawn_versus_king_endgame'
	},
	{
		term: 'Lucena position',
		def: 'The most important winning method in rook endgames: the attacking king shelters behind its pawn, and the rook “builds a bridge” to block the checks as the pawn queens.',
		category: 'endgame',
		source: W + 'Lucena_position'
	},
	{
		term: 'Philidor position',
		def: 'The standard rook-endgame draw: keep your rook on the third rank so the enemy king can’t cross, and the moment the pawn advances, check from behind forever.',
		category: 'endgame',
		source: W + 'Philidor_position'
	},
	{
		term: 'Wrong rook pawn',
		def: 'A rook’s pawn whose promotion corner is the opposite colour from your bishop. The defending king reaches the corner and cannot be dug out — a whole extra piece, and only a draw.',
		category: 'endgame',
		source: G + 'wrong_rook_pawn'
	},
	{
		term: 'Fortress',
		def: 'A defensive wall the stronger side can never breach, however it manoeuvres. The defender stops trying to fix the material and starts building one instead.',
		category: 'endgame',
		source: W + 'Fortress_(chess)'
	},
	{
		term: 'Tarrasch rule',
		def: 'Rooks belong behind passed pawns — your own, to push them home, and your opponent’s, to punish every advance. Old advice that engines have only confirmed.',
		category: 'endgame',
		source: W + 'Tarrasch_rule'
	},
	{
		term: 'Corresponding squares',
		def: 'Paired squares in locked pawn endings: when one king stands here, the other must stand exactly there, or lose. The mathematics of mutual zugzwang, worked out square by square.',
		category: 'endgame',
		source: W + 'Corresponding_squares'
	},
	{
		term: 'Tablebase',
		def: 'A computed database of perfect play for every position with few enough pieces — seven, at present. Not opinion but fact: the endgame, solved from the back cover.',
		category: 'endgame',
		source: W + 'Endgame_tablebase'
	},
	{
		term: 'Theoretical draw',
		def: 'A position known — from centuries of analysis or the tablebases — to be drawn with best play. “Theoretically drawn” and “easily drawn” are, painfully, different things.',
		category: 'endgame',
		source: G + 'theoretical_draw'
	},

	// ——— Openings ———
	{
		term: 'Opening',
		def: 'The first phase, with its three standing orders: develop the pieces, fight for the centre, tuck the king away. The named systems are simply centuries of tested move orders.',
		category: 'openings',
		source: W + 'Chess_opening'
	},
	{
		term: 'Book',
		def: 'Published opening theory. Players are “in book” while they follow known analysis and “out of book” the move somebody thinks for themselves.',
		category: 'openings',
		source: G + 'book'
	},
	{
		term: 'Main line',
		def: 'The most respected, most analysed continuation of an opening — the road most travelled. Everything branching off it is a sideline, sound or shady by degrees.',
		category: 'openings',
		source: G + 'main_line'
	},
	{
		term: 'Novelty',
		def: 'The first move of a game never played before — where preparation ends and both players are finally alone. Annotated TN, for theoretical novelty.',
		category: 'openings',
		source: G + 'novelty'
	},
	{
		term: 'Transposition',
		def: 'Arriving at a known position by an unexpected move order. A quiet weapon: steer the game into territory you know and your opponent hoped to avoid.',
		category: 'openings',
		source: W + 'Transposition_(chess)'
	},
	{
		term: 'Gambit',
		def: 'Offering material in the opening — nearly always a pawn — for faster development, the centre, or an attack. The romantic era’s whole aesthetic, and still sound more often than suspected.',
		category: 'openings',
		source: W + 'Gambit'
	},
	{
		term: 'Open & closed games',
		def: 'Openings beginning 1.e4 e5 are the open games; 1.d4 d5 the closed; Black’s asymmetric replies to 1.e4 — the Sicilian, French, Caro-Kann — the semi-open.',
		category: 'openings',
		source: W + 'Open_Game'
	},
	{
		term: 'Hypermodernism',
		def: 'The 1920s heresy of Réti and Nimzowitsch: don’t occupy the centre with pawns — control it from afar with pieces, invite the broad pawn centre, then tear it down.',
		category: 'openings',
		source: W + 'Hypermodernism_(chess)'
	},
	{
		term: 'ECO codes',
		def: 'The Encyclopaedia of Chess Openings’ index, A00–E99: five volumes of opening space compressed into letter-number labels every database speaks.',
		category: 'openings',
		source: W + 'Encyclopaedia_of_Chess_Openings'
	},
	{
		term: 'Italian Game',
		def: '1.e4 e5 2.Nf3 Nc6 3.Bc4 — the oldest opening in the literature, analysed in the first printed chess books. Quiet move orders hide real venom; the Evergreen Game grew from its gambit cousin.',
		category: 'openings',
		source: W + 'Italian_Game'
	},
	{
		term: 'Ruy Lopez',
		def: '1.e4 e5 2.Nf3 Nc6 3.Bb5, named for the sixteenth-century Spanish priest who championed it in print. Five centuries on, it is still a main battleground of elite chess.',
		category: 'openings',
		source: W + 'Ruy_Lopez'
	},
	{
		term: 'King’s Gambit',
		def: '1.e4 e5 2.f4 — the romantic era distilled into two moves: a pawn for open lines and a lifetime of attacking chances. The Immortal Game below began with it.',
		category: 'openings',
		source: W + 'King%27s_Gambit'
	},
	{
		term: 'Sicilian Defence',
		def: '1.e4 c5 — Black’s sharpest and most popular answer to 1.e4, trading symmetry for a fight. Kasparov’s counterattacking gambit in it produced the famous sixteenth game of 1985.',
		category: 'openings',
		source: W + 'Sicilian_Defence'
	},
	{
		term: 'French Defence',
		def: '1.e4 e6 — solid and counterattacking, accepting a cramped light-squared bishop as the price of a granite pawn chain and a later strike at the centre.',
		category: 'openings',
		source: W + 'French_Defence'
	},
	{
		term: 'Caro-Kann Defence',
		def: '1.e4 c6 — the French’s sturdier cousin, developing the problem bishop before closing the door. Kasparov trusted it in the last game against Deep Blue; the machine’s knight sacrifice ended the argument.',
		category: 'openings',
		source: W + 'Caro%E2%80%93Kann_Defence'
	},
	{
		term: 'Queen’s Gambit',
		def: '1.d4 d5 2.c4 — not a true gambit, since the pawn can always be recovered, but the archetype of closed-game strategy. Fischer rode its Tartakower variation in the sixth game at Reykjavík.',
		category: 'openings',
		source: W + 'Queen%27s_Gambit'
	},
	{
		term: 'King’s Indian Defence',
		def: '1.d4 Nf6 2.c4 g6 — Black hands White the big centre, fianchettoes, and then storms back at it with everything. A favourite of Fischer and Kasparov in their title years.',
		category: 'openings',
		source: W + 'King%27s_Indian_Defence'
	},
	{
		term: 'English Opening',
		def: '1.c4 — flank play named for Howard Staunton’s advocacy in the 1840s. Flexible and transpositional: Fischer’s 1.c4 in game six of 1972 flowed straight into a Queen’s Gambit.',
		category: 'openings',
		source: W + 'English_Opening'
	},

	// ——— Competition & culture ———
	{
		term: 'FIDE',
		def: 'The Fédération Internationale des Échecs, founded in Paris in 1924 — chess’s world governing body. It writes the Laws, awards the titles, and runs the world championship cycle.',
		category: 'culture',
		source: W + 'FIDE'
	},
	{
		term: 'World Chess Championship',
		def: 'The game’s crown, contested in head-to-head matches since Steinitz beat Zukertort in 1886. Eighteen players have held the undisputed title in nearly a century and a half.',
		category: 'culture',
		source: W + 'World_Chess_Championship'
	},
	{
		term: 'Candidates Tournament',
		def: 'The gauntlet that decides who challenges the world champion — eight of the strongest players on earth, double round-robin, one ticket out.',
		category: 'culture',
		source: W + 'Candidates_Tournament'
	},
	{
		term: 'Grandmaster',
		def: 'The highest title FIDE awards, held for life. Below it, International Master and FIDE Master; ahead of it, only the champions.',
		category: 'culture',
		source: W + 'Grandmaster_(chess)'
	},
	{
		term: 'Norm',
		def: 'A qualifying performance toward a title — a tournament result at grandmaster strength against a strong, mixed-federation field. Three norms plus the rating floor earn the title.',
		category: 'culture',
		source: W + 'Norm_(chess)'
	},
	{
		term: 'Elo rating',
		def: 'The statistical strength scale devised by Arpad Elo and adopted by FIDE in 1970. Beat stronger players and yours rises; every serious player wears their number.',
		category: 'culture',
		source: W + 'Elo_rating_system'
	},
	{
		term: 'Arbiter',
		def: 'The referee of over-the-board chess: enforces the Laws, rules on draw claims and illegal moves, and keeps the clocks — and the players — honest.',
		category: 'culture',
		source: FIDE
	},
	{
		term: 'Time controls',
		def: 'The clock formats: classical games grant hours, rapid minutes, blitz a handful, bullet barely two. Same rules, utterly different games.',
		category: 'culture',
		source: W + 'Time_control'
	},
	{
		term: 'Increment',
		def: 'Seconds added to your clock after every move, so a won position need never be lost to a dead flag. Bobby Fischer patented the idea in 1989.',
		category: 'culture',
		source: W + 'Chess_clock'
	},
	{
		term: 'Zeitnot',
		def: 'German for time trouble: the scramble when the flag hangs and calculation gives way to reflex. Where winning positions go to die.',
		category: 'culture',
		source: G + 'time_trouble'
	},
	{
		term: 'Flag fall',
		def: 'Running out of time. It loses the game outright — unless the opponent lacks any possible mating material, in which case the game is drawn.',
		category: 'culture',
		source: FIDE
	},
	{
		term: 'Armageddon',
		def: 'The sudden-death tiebreak: White gets more time but must win — a draw counts as a win for Black. Chess’s penalty shoot-out.',
		category: 'culture',
		source: G + 'armageddon'
	},
	{
		term: 'Swiss system',
		def: 'The pairing method of big opens: each round you meet someone on your own score, nobody is eliminated, and hundreds of players sort themselves in nine rounds.',
		category: 'culture',
		source: W + 'Swiss-system_tournament'
	},
	{
		term: 'Round-robin',
		def: 'Everyone plays everyone, the format of elite invitationals — and, doubled, of the Candidates. No pairing luck, nowhere to hide.',
		category: 'culture',
		source: W + 'Round-robin_tournament'
	},
	{
		term: 'Chess Olympiad',
		def: 'The biennial team world championship: over 180 national teams, four boards each, and the Hamilton-Russell Cup for the winners.',
		category: 'culture',
		source: W + 'Chess_Olympiad'
	},
	{
		term: 'Simultaneous exhibition',
		def: 'One master, dozens of boards arranged in a ring, a move played at each visit. The classic way champions have met the public since Morphy.',
		category: 'culture',
		source: W + 'Simultaneous_exhibition'
	},
	{
		term: 'Blindfold chess',
		def: 'Playing without sight of the board, the moves called aloud — the traditional proof of a master’s inner board. Modern record-holders juggle dozens of games at once.',
		category: 'culture',
		source: W + 'Blindfold_chess'
	},
	{
		term: 'Correspondence chess',
		def: 'Chess by post — now by server — with days per move and research allowed. Once the home of the deepest opening analysis; engines have rewritten its meaning.',
		category: 'culture',
		source: W + 'Correspondence_chess'
	},
	{
		term: 'Kibitzer',
		def: 'A spectator offering unsolicited commentary, from the Yiddish. Every chess café has always had more kibitzers than players.',
		category: 'culture',
		source: G + 'kibitzer'
	},
	{
		term: 'Patzer',
		def: 'Affectionate slang for a weak player — likewise woodpusher. Terms of abuse only when aimed at somebody else’s game.',
		category: 'culture',
		source: G + 'patzer'
	},
	{
		term: 'Swindle',
		def: 'Rescuing a lost game with a trap the winner was never obliged to fall for. Not luck, insists every swindler — resourcefulness.',
		category: 'culture',
		source: W + 'Swindle_(chess)'
	},
	{
		term: 'Grandmaster draw',
		def: 'A short, bloodless draw by mutual agreement — a handshake before the fight. Modern tournament rules increasingly forbid offers before move thirty.',
		category: 'culture',
		source: G + 'grandmaster_draw'
	},
	{
		term: 'Brilliancy',
		def: 'A game of exceptional beauty — deep sacrifice, hidden geometry — of the kind old tournaments honoured with a brilliancy prize. Several live in the landmark games below.',
		category: 'culture',
		source: G + 'brilliancy'
	},
	{
		term: 'Annotation symbols',
		def: 'The annotator’s punctuation: !! brilliant, ! good, !? interesting, ?! dubious, ? a mistake, ?? a blunder. A century of judgment compressed into typography.',
		category: 'culture',
		source: W + 'Chess_annotation_symbols'
	},
	{
		term: 'Engine',
		def: 'A chess-playing program. Since Deep Blue beat Kasparov in 1997 the machines have led; since AlphaZero taught itself in 2017, they have also had style.',
		category: 'culture',
		source: W + 'Chess_engine'
	},
	{
		term: 'Centipawn',
		def: 'One hundredth of a pawn — the engine’s unit of judgment. The review screen’s CPL, centipawn loss, measures how far each of your moves fell from the engine’s best.',
		category: 'culture',
		source: G + 'centipawn'
	},
	{
		term: 'Evaluation',
		def: 'The engine’s verdict on a position, counted in pawns from White’s side: +1.5 means White stands a pawn and a half better, 0.0 dead level, and a mating line shows as mate-in-N.',
		category: 'culture',
		source: W + 'Evaluation_function'
	},
	{
		term: 'Blunder',
		def: 'A move that throws away the game or a large part of it — the ?? of the annotation symbols. Inaccuracy, mistake, blunder: the same scale of evaluation swings this app uses in review.',
		category: 'culture',
		source: G + 'blunder'
	}
];
