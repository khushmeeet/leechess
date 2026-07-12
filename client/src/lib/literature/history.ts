/** The history timeline of the Literature screen. Original summaries written
 * against the linked Wikipedia articles; each era cites the article that
 * grounds it. */

export interface Era {
	period: string;
	title: string;
	body: string;
	source: string;
	sourceTitle: string;
}

const W = 'https://en.wikipedia.org/wiki/';

export const ERAS: Era[] = [
	{
		period: 'c. 600',
		title: 'Chaturanga',
		body: 'Chess’s earliest traceable ancestor appears in northern India around the sixth century as chaturanga — “four divisions,” after the arms of an Indian army: infantry, cavalry, elephants, and chariots. Those divisions survive in today’s pawns, knights, bishops, and rooks, and the game’s essential idea — armies on an 8×8 board, victory through the enemy king — was already in place.',
		source: W + 'Chaturanga',
		sourceTitle: 'Chaturanga — Wikipedia'
	},
	{
		period: 'c. 650–1200',
		title: 'Shatranj and the long westward road',
		body: 'Persia adopted the game as shatranj, and the Islamic world carried it from Spain to Central Asia. Its masters — al-Adli, as-Suli — wrote the first real chess literature: openings, problems, and endgame studies, a thousand years before databases. Persian gave the game its most famous words: shāh (king) became “check,” and shāh māt — “the king is helpless” — became checkmate.',
		source: W + 'Shatranj',
		sourceTitle: 'Shatranj — Wikipedia'
	},
	{
		period: 'c. 1475–1600',
		title: 'The queen’s revolution',
		body: 'In late fifteenth-century Valencia, the game was rebuilt: the slow counsellor became the all-powerful queen and the leaping elephant a long-range bishop, so sharply faster that contemporaries called it “mad queen chess.” Print arrived almost at once — Lucena’s 1497 treatise is the oldest surviving printed chess book — and in 1561 the priest Ruy López published the analysis that still carries his name at the top of modern opening theory.',
		source: W + 'History_of_chess',
		sourceTitle: 'History of chess — Wikipedia'
	},
	{
		period: '1749–1851',
		title: 'Philidor and the Romantics',
		body: 'François-André Philidor, the strongest player of the eighteenth century, published L’Analyse in 1749 and its heresy that “pawns are the soul of chess.” The game’s home became the coffee-house — above all the Café de la Régence in Paris — and its ideal the dashing gambit and the sacrificial king-hunt. The Romantic era peaked in London in 1851, when the first international tournament crowned Adolf Anderssen, author of the Immortal Game played the same summer.',
		source: W + 'Romantic_chess',
		sourceTitle: 'Romantic chess — Wikipedia'
	},
	{
		period: '1858–1886',
		title: 'Morphy, Steinitz, and a crown',
		body: 'Paul Morphy of New Orleans toured Europe in 1858 and beat everyone who dared, decades ahead of his time, then walked away from the game entirely. Wilhelm Steinitz converted Morphy’s lessons into the first true theory of position — accumulate small advantages, attack only when justified — and in 1886 beat Zukertort in the first official World Championship match.',
		source: W + 'World_Chess_Championship',
		sourceTitle: 'World Chess Championship — Wikipedia'
	},
	{
		period: '1886–1948',
		title: 'The classical champions',
		body: 'Emanuel Lasker held the title for twenty-seven years; Capablanca barely seemed to make an error; Alekhine attacked like weather. In the 1920s the hypermoderns — Réti, Nimzowitsch and My System — argued the centre could be ruled from a distance, and FIDE, founded in Paris in 1924, began knitting national federations into a world game. When Alekhine died holding the title in 1946, FIDE took custody of the crown itself.',
		source: W + 'History_of_chess',
		sourceTitle: 'History of chess — Wikipedia'
	},
	{
		period: '1948–1990',
		title: 'The Soviet era — and Fischer',
		body: 'From Botvinnik’s 1948 title on, the Soviet school — Smyslov, Tal, Petrosian, Spassky — treated the championship as a domestic affair, backed by state training and the new Elo rating system (adopted by FIDE in 1970). Bobby Fischer shattered the monopoly alone at Reykjavík in 1972, the Cold War’s most-watched chessboard. Karpov reclaimed the title for the USSR, and his wars with Kasparov — including the aborted 48-game marathon of 1984–85 — ended with Kasparov, at twenty-two, the youngest world champion yet.',
		source: W + 'World_Chess_Championship',
		sourceTitle: 'World Chess Championship — Wikipedia'
	},
	{
		period: '1990–today',
		title: 'Engines, the internet, and the new boom',
		body: 'In 1997 IBM’s Deep Blue beat Kasparov — the first match defeat of a reigning champion by a machine — and within a decade engines outclassed everyone. Chess moved online, and in 2017 DeepMind’s AlphaZero learned the game from scratch by playing itself, beating the best engine with moves that looked like art. Magnus Carlsen dominated a decade before relinquishing the title in 2023; streaming and The Queen’s Gambit made the old game young again; and in 2024 Gukesh Dommaraju became, at eighteen, the youngest undisputed world champion in history.',
		source: W + 'History_of_chess',
		sourceTitle: 'History of chess — Wikipedia'
	}
];
