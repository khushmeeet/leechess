/** The landmark games of the Literature screen, in chronological order.
 * Every game score was machine-checked for full legality (and checkmate,
 * where the score ends in one) with python-chess, and cross-checked
 * move-for-move against the cited Wikipedia article. finalFen is the position
 * after the last move of the score, for the diagram on each card. */

export interface LandmarkGame {
	id: string;
	year: number;
	title: string;
	white: string;
	black: string;
	event: string;
	result: '1-0' | '0-1';
	why: string;
	pgn: string;
	finalFen: string;
	source: string;
	sourceTitle: string;
}

const W = 'https://en.wikipedia.org/wiki/';

export const GAMES: LandmarkGame[] = [
	{
		id: 'immortal-1851',
		year: 1851,
		title: 'The Immortal Game',
		white: 'Adolf Anderssen',
		black: 'Lionel Kieseritzky',
		event: 'Casual game, London',
		result: '1-0',
		why: 'The Romantic era in a single game: Anderssen gives up a bishop, both rooks, and finally the queen, then mates with the three minor pieces he has left. Played casually between tournament rounds — the score traditionally ends with the announced mate, which Kieseritzky may never have allowed on the board.',
		pgn: '1. e4 e5 2. f4 exf4 3. Bc4 Qh4+ 4. Kf1 b5 5. Bxb5 Nf6 6. Nf3 Qh6 7. d3 Nh5 8. Nh4 Qg5 9. Nf5 c6 10. g4 Nf6 11. Rg1 cxb5 12. h4 Qg6 13. h5 Qg5 14. Qf3 Ng8 15. Bxf4 Qf6 16. Nc3 Bc5 17. Nd5 Qxb2 18. Bd6 Bxg1 19. e5 Qxa1+ 20. Ke2 Na6 21. Nxg7+ Kd8 22. Qf6+ Nxf6 23. Be7# 1-0',
		finalFen: 'r1bk3r/p2pBpNp/n4n2/1p1NP2P/6P1/3P4/P1P1K3/q5b1 b - - 1 23',
		source: W + 'Immortal_Game',
		sourceTitle: 'Immortal Game — Wikipedia'
	},
	{
		id: 'evergreen-1852',
		year: 1852,
		title: 'The Evergreen Game',
		white: 'Adolf Anderssen',
		black: 'Jean Dufresne',
		event: 'Casual game, Berlin',
		result: '1-0',
		why: 'Anderssen’s other masterpiece — “an evergreen in the laurel crown,” Steinitz called it. The quiet 19.Rad1 sets a combination that ends with a queen sacrifice on d7 and mate from the two bishops. Whether 19.Rad1 was actually the best move has kept annotators arguing for a century and a half.',
		pgn: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. b4 Bxb4 5. c3 Ba5 6. d4 exd4 7. O-O d3 8. Qb3 Qf6 9. e5 Qg6 10. Re1 Nge7 11. Ba3 b5 12. Qxb5 Rb8 13. Qa4 Bb6 14. Nbd2 Bb7 15. Ne4 Qf5 16. Bxd3 Qh5 17. Nf6+ gxf6 18. exf6 Rg8 19. Rad1 Qxf3 20. Rxe7+ Nxe7 21. Qxd7+ Kxd7 22. Bf5+ Ke8 23. Bd7+ Kf8 24. Bxe7# 1-0',
		finalFen: '1r3kr1/pbpBBp1p/1b3P2/8/8/2P2q2/P4PPP/3R2K1 b - - 0 24',
		source: W + 'Evergreen_Game',
		sourceTitle: 'Evergreen Game — Wikipedia'
	},
	{
		id: 'opera-1858',
		year: 1858,
		title: 'The Opera Game',
		white: 'Paul Morphy',
		black: 'Duke Karl of Brunswick & Count Isouard',
		event: 'Paris opera house, consultation game',
		result: '1-0',
		why: 'Played in a box at the Paris opera against two consulting aristocrats, and still the single most-taught game in chess: develop everything, open lines, punish the opponent who does neither. Morphy’s queen sacrifice into Rd8# arrives with his whole army developed and Black’s asleep at home.',
		pgn: '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0',
		finalFen: '1n1Rkb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2K5 b k - 1 17',
		source: W + 'Opera_Game',
		sourceTitle: 'Opera Game — Wikipedia'
	},
	{
		id: 'rubinstein-1907',
		year: 1907,
		title: 'Rubinstein’s Immortal',
		white: 'Gersz Rotlewi',
		black: 'Akiba Rubinstein',
		event: 'Łódź',
		result: '0-1',
		why: 'The most admired combination of the pre-war era: with his queen hanging, Rubinstein plays 22...Rxc3, then 23...Rd2 — every black piece is en prise and none can be taken. The final 25...Rh3 leaves White helpless against mate on the long diagonal despite his extra queen.',
		pgn: '1. d4 d5 2. Nf3 e6 3. e3 c5 4. c4 Nc6 5. Nc3 Nf6 6. dxc5 Bxc5 7. a3 a6 8. b4 Bd6 9. Bb2 O-O 10. Qd2 Qe7 11. Bd3 dxc4 12. Bxc4 b5 13. Bd3 Rd8 14. Qe2 Bb7 15. O-O Ne5 16. Nxe5 Bxe5 17. f4 Bc7 18. e4 Rac8 19. e5 Bb6+ 20. Kh1 Ng4 21. Be4 Qh4 22. g3 Rxc3 23. gxh4 Rd2 24. Qxd2 Bxe4+ 25. Qg2 Rh3 0-1',
		finalFen: '6k1/5ppp/pb2p3/1p2P3/1P2bPnP/P6r/1B4QP/R4R1K w - - 2 26',
		source: W + 'Rotlewi_versus_Rubinstein',
		sourceTitle: 'Rotlewi versus Rubinstein — Wikipedia'
	},
	{
		id: 'zugzwang-1923',
		year: 1923,
		title: 'The Immortal Zugzwang Game',
		white: 'Fritz Sämisch',
		black: 'Aron Nimzowitsch',
		event: 'Copenhagen',
		result: '0-1',
		why: 'Hypermodernism’s showpiece by its own prophet. After the quiet 25...h6, White resigned with the material still roughly level and the board still full: every single move he could make would lose on the spot. Zugzwang in the middlegame, which is nearly a contradiction in terms.',
		pgn: '1. d4 Nf6 2. c4 e6 3. Nf3 b6 4. g3 Bb7 5. Bg2 Be7 6. Nc3 O-O 7. O-O d5 8. Ne5 c6 9. cxd5 cxd5 10. Bf4 a6 11. Rc1 b5 12. Qb3 Nc6 13. Nxc6 Bxc6 14. h3 Qd7 15. Kh2 Nh5 16. Bd2 f5 17. Qd1 b4 18. Nb1 Bb5 19. Rg1 Bd6 20. e4 fxe4 21. Qxh5 Rxf2 22. Qg5 Raf8 23. Kh1 R8f5 24. Qe3 Bd3 25. Rce1 h6 0-1',
		finalFen: '6k1/3q2p1/p2bp2p/3p1r2/1p1Pp3/3bQ1PP/PP1B1rB1/1N2R1RK w - - 0 26',
		source: W + 'Immortal_Zugzwang_Game',
		sourceTitle: 'Immortal Zugzwang Game — Wikipedia'
	},
	{
		id: 'century-1956',
		year: 1956,
		title: 'The Game of the Century',
		white: 'Donald Byrne',
		black: 'Bobby Fischer',
		event: 'Rosenwald Memorial, New York',
		result: '0-1',
		why: 'Fischer was thirteen. The stunning 17...Be6, offering the queen, buys a windmill of discovered checks that harvests a rook, two bishops, and a pawn; the boy then walks Byrne’s bare king into a textbook mating net. Hans Kmoch baptised it “The Game of the Century” on the spot.',
		pgn: '1. Nf3 Nf6 2. c4 g6 3. Nc3 Bg7 4. d4 O-O 5. Bf4 d5 6. Qb3 dxc4 7. Qxc4 c6 8. e4 Nbd7 9. Rd1 Nb6 10. Qc5 Bg4 11. Bg5 Na4 12. Qa3 Nxc3 13. bxc3 Nxe4 14. Bxe7 Qb6 15. Bc4 Nxc3 16. Bc5 Rfe8+ 17. Kf1 Be6 18. Bxb6 Bxc4+ 19. Kg1 Ne2+ 20. Kf1 Nxd4+ 21. Kg1 Ne2+ 22. Kf1 Nc3+ 23. Kg1 axb6 24. Qb4 Ra4 25. Qxb6 Nxd1 26. h3 Rxa2 27. Kh2 Nxf2 28. Re1 Rxe1 29. Qd8+ Bf8 30. Nxe1 Bd5 31. Nf3 Ne4 32. Qb8 b5 33. h4 h5 34. Ne5 Kg7 35. Kg1 Bc5+ 36. Kf1 Ng3+ 37. Ke1 Bb4+ 38. Kd1 Bb3+ 39. Kc1 Ne2+ 40. Kb1 Nc3+ 41. Kc1 Rc2# 0-1',
		finalFen: '1Q6/5pk1/2p3p1/1p2N2p/1b5P/1bn5/2r3P1/2K5 w - - 16 42',
		source: W + 'Game_of_the_Century_(chess)',
		sourceTitle: 'Game of the Century — Wikipedia'
	},
	{
		id: 'reykjavik-1972',
		year: 1972,
		title: 'Fischer–Spassky, Game 6',
		white: 'Bobby Fischer',
		black: 'Boris Spassky',
		event: 'World Championship, Reykjavík',
		result: '1-0',
		why: 'The Match of the Century’s most beautiful game. Fischer, a lifelong 1.e4 player, opens 1.c4 and steers into a Queen’s Gambit he had almost never touched as White — and produces a positional masterpiece so clean that Spassky joined the audience’s applause. It gave Fischer the lead he never surrendered.',
		pgn: '1. c4 e6 2. Nf3 d5 3. d4 Nf6 4. Nc3 Be7 5. Bg5 O-O 6. e3 h6 7. Bh4 b6 8. cxd5 Nxd5 9. Bxe7 Qxe7 10. Nxd5 exd5 11. Rc1 Be6 12. Qa4 c5 13. Qa3 Rc8 14. Bb5 a6 15. dxc5 bxc5 16. O-O Ra7 17. Be2 Nd7 18. Nd4 Qf8 19. Nxe6 fxe6 20. e4 d4 21. f4 Qe7 22. e5 Rb8 23. Bc4 Kh8 24. Qh3 Nf8 25. b3 a5 26. f5 exf5 27. Rxf5 Nh7 28. Rcf1 Qd8 29. Qg3 Re7 30. h4 Rbb7 31. e6 Rbc7 32. Qe5 Qe8 33. a4 Qd8 34. R1f2 Qe8 35. R2f3 Qd8 36. Bd3 Qe8 37. Qe4 Nf6 38. Rxf6 gxf6 39. Rxf6 Kg8 40. Bc4 Kh8 41. Qf4 1-0',
		finalFen: '4q2k/2r1r3/4PR1p/p1p5/P1Bp1Q1P/1P6/6P1/6K1 b - - 4 41',
		source: W + 'World_Chess_Championship_1972',
		sourceTitle: 'World Chess Championship 1972 — Wikipedia'
	},
	{
		id: 'octopus-1985',
		year: 1985,
		title: 'Kasparov’s Octopus',
		white: 'Anatoly Karpov',
		black: 'Garry Kasparov',
		event: 'World Championship, Game 16, Moscow',
		result: '0-1',
		why: 'Kasparov gambits a pawn for nothing but squares — and gets the square: the knight that lands on d3 at move 16 sits in Karpov’s throat for nearly twenty moves, nicknamed “the octopus.” The strategic masterpiece of the match that made Kasparov, at twenty-two, the youngest world champion.',
		pgn: '1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 5. Nb5 d6 6. c4 Nf6 7. N1c3 a6 8. Na3 d5 9. cxd5 exd5 10. exd5 Nb4 11. Be2 Bc5 12. O-O O-O 13. Bf3 Bf5 14. Bg5 Re8 15. Qd2 b5 16. Rad1 Nd3 17. Nab1 h6 18. Bh4 b4 19. Na4 Bd6 20. Bg3 Rc8 21. b3 g5 22. Bxd6 Qxd6 23. g3 Nd7 24. Bg2 Qf6 25. a3 a5 26. axb4 axb4 27. Qa2 Bg6 28. d6 g4 29. Qd2 Kg7 30. f3 Qxd6 31. fxg4 Qd4+ 32. Kh1 Nf6 33. Rf4 Ne4 34. Qxd3 Nf2+ 35. Rxf2 Bxd3 36. Rfd2 Qe3 37. Rxd3 Rc1 38. Nb2 Qf2 39. Nd2 Rxd1+ 40. Nxd1 Re1+ 0-1',
		finalFen: '8/5pk1/7p/8/1p4P1/1P1R2P1/3N1qBP/3Nr2K w - - 1 41',
		source: W + 'World_Chess_Championship_1985',
		sourceTitle: 'World Chess Championship 1985 — Wikipedia'
	},
	{
		id: 'deep-blue-1997',
		year: 1997,
		title: 'Deep Blue–Kasparov, Game 6',
		white: 'Deep Blue',
		black: 'Garry Kasparov',
		event: 'Match, Game 6, New York',
		result: '1-0',
		why: 'The nineteen moves that ended human supremacy. In a Caro-Kann, IBM’s machine plays the long-known piece sacrifice 8.Nxe6; Kasparov, shaken by the match, collapses in under an hour. The first defeat of a reigning world champion by a computer in match play — a hinge of chess history.',
		pgn: '1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Nd7 5. Ng5 Ngf6 6. Bd3 e6 7. N1f3 h6 8. Nxe6 Qe7 9. O-O fxe6 10. Bg6+ Kd8 11. Bf4 b5 12. a4 Bb7 13. Re1 Nd5 14. Bg3 Kc8 15. axb5 cxb5 16. Qd3 Bc6 17. Bf5 exf5 18. Rxe7 Bxe7 19. c4 1-0',
		finalFen: 'r1k4r/p2nb1p1/2b4p/1p1n1p2/2PP4/3Q1NB1/1P3PPP/R5K1 b - - 0 19',
		source: W + 'Deep_Blue_versus_Kasparov,_1997,_Game_6',
		sourceTitle: 'Deep Blue versus Kasparov, 1997, Game 6 — Wikipedia'
	},
	{
		id: 'kasparov-immortal-1999',
		year: 1999,
		title: 'Kasparov’s Immortal',
		white: 'Garry Kasparov',
		black: 'Veselin Topalov',
		event: 'Hoogovens, Wijk aan Zee',
		result: '1-0',
		why: 'The modern brilliancy against which others are measured. The rook sacrifice 24.Rxd4 launches a combination Kasparov had to see some fifteen moves deep, dragging Topalov’s king from b8 across the entire board to its doom. Frequently ranked the finest game ever played.',
		pgn: '1. e4 d6 2. d4 Nf6 3. Nc3 g6 4. Be3 Bg7 5. Qd2 c6 6. f3 b5 7. Nge2 Nbd7 8. Bh6 Bxh6 9. Qxh6 Bb7 10. a3 e5 11. O-O-O Qe7 12. Kb1 a6 13. Nc1 O-O-O 14. Nb3 exd4 15. Rxd4 c5 16. Rd1 Nb6 17. g3 Kb8 18. Na5 Ba8 19. Bh3 d5 20. Qf4+ Ka7 21. Rhe1 d4 22. Nd5 Nbxd5 23. exd5 Qd6 24. Rxd4 cxd4 25. Re7+ Kb6 26. Qxd4+ Kxa5 27. b4+ Ka4 28. Qc3 Qxd5 29. Ra7 Bb7 30. Rxb7 Qc4 31. Qxf6 Kxa3 32. Qxa6+ Kxb4 33. c3+ Kxc3 34. Qa1+ Kd2 35. Qb2+ Kd1 36. Bf1 Rd2 37. Rd7 Rxd7 38. Bxc4 bxc4 39. Qxh8 Rd3 40. Qa8 c3 41. Qa4+ Ke1 42. f4 f5 43. Kc1 Rd2 44. Qa7 1-0',
		finalFen: '8/Q6p/6p1/5p2/5P2/2p3P1/3r3P/2K1k3 b - - 3 44',
		source: W + "Kasparov's_Immortal",
		sourceTitle: 'Kasparov’s Immortal — Wikipedia'
	},
	{
		id: 'kasparov-world-1999',
		year: 1999,
		title: 'Kasparov versus the World',
		white: 'Garry Kasparov',
		black: 'The World',
		event: 'Internet consultation game',
		result: '1-0',
		why: 'Over fifty thousand people from more than seventy-five countries voted on every move, coached by a panel of young masters, and pushed the champion for four months. Kasparov called it “the greatest game in the history of chess” for the analysis it generated — and won only in a 62-move queen ending on a knife’s edge.',
		pgn: '1. e4 c5 2. Nf3 d6 3. Bb5+ Bd7 4. Bxd7+ Qxd7 5. c4 Nc6 6. Nc3 Nf6 7. O-O g6 8. d4 cxd4 9. Nxd4 Bg7 10. Nde2 Qe6 11. Nd5 Qxe4 12. Nc7+ Kd7 13. Nxa8 Qxc4 14. Nb6+ axb6 15. Nc3 Ra8 16. a4 Ne4 17. Nxe4 Qxe4 18. Qb3 f5 19. Bg5 Qb4 20. Qf7 Be5 21. h3 Rxa4 22. Rxa4 Qxa4 23. Qxh7 Bxb2 24. Qxg6 Qe4 25. Qf7 Bd4 26. Qb3 f4 27. Qf7 Be5 28. h4 b5 29. h5 Qc4 30. Qf5+ Qe6 31. Qxe6+ Kxe6 32. g3 fxg3 33. fxg3 b4 34. Bf4 Bd4+ 35. Kh1 b3 36. g4 Kd5 37. g5 e6 38. h6 Ne7 39. Rd1 e5 40. Be3 Kc4 41. Bxd4 exd4 42. Kg2 b2 43. Kf3 Kc3 44. h7 Ng6 45. Ke4 Kc2 46. Rh1 d3 47. Kf5 b1=Q 48. Rxb1 Kxb1 49. Kxg6 d2 50. h8=Q d1=Q 51. Qh7 b5 52. Kf6+ Kb2 53. Qh2+ Ka1 54. Qf4 b4 55. Qxb4 Qf3+ 56. Kg7 d5 57. Qd4+ Kb1 58. g6 Qe4 59. Qg1+ Kb2 60. Qf2+ Kc1 61. Kf6 d4 62. g7 1-0',
		finalFen: '8/6P1/5K2/8/3pq3/8/5Q2/2k5 b - - 0 62',
		source: W + 'Kasparov_versus_the_World',
		sourceTitle: 'Kasparov versus the World — Wikipedia'
	}
];
