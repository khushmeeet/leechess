"""Rule-based motif detector tests — pure logic on hand-constructed FENs.

Every motif gets positive cases AND near-miss negatives (positions that look
like the motif but aren't) — a tagger validated only on positives over-tags.
When manual game validation finds a false positive/negative, add it here as
a regression case BEFORE fixing the rule.
"""

import chess
import pytest
from sqlalchemy import select

from app.models import Game, MotifTag, Move
from app.motifs import apply_rule_based_tags, detect_motifs, tags_for_move

pytestmark = pytest.mark.unit


def motifs_of(fen: str, uci: str) -> set[str]:
    return detect_motifs(chess.Board(fen), chess.Move.from_uci(uci))


# --- detect_motifs: (fen, move, exact expected tag set) ---

DETECTOR_CASES = [
    # fork — positives
    pytest.param(
        "r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1",
        "b5c7",
        {"fork"},
        id="fork-royal-knight-fork-king-and-rook",
    ),
    pytest.param(
        "4k3/8/2n1b3/8/3PP3/8/8/4K3 w - - 0 1",
        "d4d5",
        {"fork"},
        id="fork-defended-pawn-forks-two-minors",
    ),
    # fork — near misses
    pytest.param(
        "4k3/3q4/5pr1/8/8/3N4/8/4K3 w - - 0 1",
        "d3e5",
        set(),
        id="fork-not-when-forking-square-is-attacked-by-a-pawn",
    ),
    pytest.param(
        "4k3/p5p1/1b3b2/8/8/2N5/8/4K3 w - - 0 1",
        "c3d5",
        set(),
        id="fork-not-when-both-targets-are-defended-equals",
    ),
    # pin — positives
    pytest.param(
        "4k3/8/2n5/8/8/8/4B3/4K3 w - - 0 1",
        "e2b5",
        {"pin"},
        id="pin-absolute-knight-pinned-to-king",
    ),
    pytest.param(
        "6k1/4q3/8/8/4n3/8/8/R5K1 w - - 0 1",
        "a1e1",
        {"pin"},
        id="pin-relative-knight-pinned-to-queen",
    ),
    # pin — near miss: Ruy-Lopez lookalike, the d7 pawn sits behind the
    # knight so nothing valuable is actually on the line
    pytest.param(
        "4k3/3p4/2n5/8/8/8/4B3/4K3 w - - 0 1",
        "e2b5",
        set(),
        id="pin-not-when-only-a-pawn-is-behind-the-piece",
    ),
    # skewer — positive: check forces the king off the line, queen falls
    pytest.param(
        "4q3/8/8/4k3/8/8/8/1K5R w - - 0 1",
        "h1e1",
        {"skewer"},
        id="skewer-king-skewered-to-queen",
    ),
    # skewer — near miss: only a pawn behind the checked king
    pytest.param(
        "8/4p3/8/4k3/8/8/8/1K5R w - - 0 1",
        "h1e1",
        set(),
        id="skewer-not-when-only-a-pawn-is-behind",
    ),
    # back-rank mate — positive
    pytest.param(
        "6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1",
        "e1e8",
        {"back_rank_mate"},
        id="back-rank-classic-rook-mate",
    ),
    # back-rank mate — near miss: mate, but delivered on f7 (Scholar's mate)
    pytest.param(
        "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
        "h5f7",
        set(),
        id="back-rank-not-any-checkmate",
    ),
    # hanging piece — positives
    pytest.param(
        "4k3/8/8/3b4/8/8/8/3RK3 w - - 0 1",
        "d1d5",
        {"hanging_piece"},
        id="hanging-undefended-bishop-taken",
    ),
    pytest.param(
        "4k3/8/2p5/3q4/4P3/8/8/4K3 w - - 0 1",
        "e4d5",
        {"hanging_piece"},
        id="hanging-defended-queen-taken-by-pawn",
    ),
    # hanging piece — near misses
    pytest.param(
        "4k3/8/3p4/4n3/8/5N2/8/4K3 w - - 0 1",
        "f3e5",
        set(),
        id="hanging-not-a-defended-equal-trade",
    ),
    pytest.param(
        "4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1",
        "e4d5",
        set(),
        id="hanging-not-a-plain-pawn-grab",
    ),
    # discovered / double check — positives
    pytest.param(
        "4k3/8/8/4N3/8/8/8/4RK2 w - - 0 1",
        "e5c6",
        {"discovered_check"},
        id="discovered-check-knight-unmasks-rook",
    ),
    pytest.param(
        "4k3/8/8/4N3/8/8/8/4RK2 w - - 0 1",
        "e5d6",
        {"discovered_check", "double_check"},
        id="double-check-knight-checks-and-unmasks-rook",
    ),
    # discovered check — near miss: castling rook check is a direct check
    pytest.param(
        "5k2/8/8/8/8/8/8/4K2R w K - 0 1",
        "e1g1",
        set(),
        id="discovered-not-castling-rook-check",
    ),
    # discovered attack — positive: the knight steps off the e-file and the
    # rook behind it hits the queen (a non-king target, so not a disc. check)
    pytest.param(
        "4q1k1/8/8/8/4N3/8/8/4R1K1 w - - 0 1",
        "e4c5",
        {"discovered_attack"},
        id="discovered-attack-knight-unmasks-rook-onto-queen",
    ),
    # discovered attack — near miss: only a pawn sits behind on the opened
    # line, not worth a tactic
    pytest.param(
        "6k1/4p3/8/8/4N3/8/8/4R1K1 w - - 0 1",
        "e4c5",
        set(),
        id="discovered-attack-not-when-only-a-pawn-is-revealed",
    ),
    # deflection — positive: Ne5 hits the queen (attacked by something cheaper,
    # so it must run), and the queen was the knight on d5's only defender
    pytest.param(
        "6k1/3q4/8/3n4/2P1P3/5N2/8/6K1 w - - 0 1",
        "f3e5",
        {"deflection"},
        id="deflection-attacked-queen-is-the-knights-sole-defender",
    ),
    # deflection — near miss: the c6 pawn also defends d5, so pulling the queen
    # off doesn't win it
    pytest.param(
        "6k1/3q4/2p5/3n4/2P1P3/5N2/8/6K1 w - - 0 1",
        "f3e5",
        set(),
        id="deflection-not-when-the-guarded-piece-has-a-second-defender",
    ),
    # overloading — positive: g5 adds a second target; the d7 knight is now the
    # only defender of both the b6 bishop and the f6 knight
    pytest.param(
        "6k1/3n4/1b3n2/P7/6P1/8/8/7K w - - 0 1",
        "g4g5",
        {"overloading"},
        id="overloading-defender-guards-two-attacked-minors",
    ),
    # overloading — near miss: without the a5 pawn only f6 is attacked, so the
    # defender has just one duty
    pytest.param(
        "6k1/3n4/1b3n2/8/6P1/8/8/7K w - - 0 1",
        "g4g5",
        set(),
        id="overloading-not-when-only-one-piece-is-attacked",
    ),
    # trapped piece — positive: f3 seals g4, the bishop's last flight; it's hit
    # by the g2 pawn and every square it can reach is still lost
    pytest.param(
        "4k3/8/8/5p2/8/7b/5PP1/5K2 w - - 0 1",
        "f2f3",
        {"trapped_piece"},
        id="trapped-bishop-no-safe-square-after-flight-is-sealed",
    ),
    # trapped piece — near miss: with the f5 pawn gone the long diagonal is
    # open and the bishop slips out to f5
    pytest.param(
        "4k3/8/8/8/8/7b/5PP1/5K2 w - - 0 1",
        "f2f3",
        set(),
        id="trapped-not-when-the-bishop-has-an-open-diagonal",
    ),
    # zwischenzug — positive: instead of saving the rook that hangs to the g5
    # pawn, White throws in a safe knight check first
    pytest.param(
        "6k1/8/8/6p1/6NR/8/8/6K1 w - - 0 1",
        "g4h6",
        {"zwischenzug"},
        id="zwischenzug-check-first-and-leave-the-rook-hanging",
    ),
    # zwischenzug — near miss: the same check, but nothing of ours is hanging,
    # so it's just a check
    pytest.param(
        "6k1/8/8/8/6NR/8/8/6K1 w - - 0 1",
        "g4h6",
        set(),
        id="zwischenzug-not-a-plain-check-with-nothing-hanging",
    ),
]


@pytest.mark.parametrize(("fen", "uci", "expected"), DETECTOR_CASES)
def test_detect_motifs(fen: str, uci: str, expected: set[str]):
    assert motifs_of(fen, uci) == expected


# --- tags_for_move: which (position, move) pairs get stored tags ---

# 3.Qxe5+?? hangs the queen to 3...Nxe5 — the same scripted game as
# test_analysis_job.py and the Playwright review spec's motif test.
HUNG_QUEEN_SANS = ["e4", "e5", "Qh5", "Nc6", "Qxe5+", "Nxe5"]


def hung_queen_rows() -> list[dict]:
    """(fen_before, san, uci, fen_after) for each ply of the scripted game."""
    board = chess.Board()
    rows = []
    for san in HUNG_QUEEN_SANS:
        move = board.parse_san(san)
        row = {"fen_before": board.fen(), "san": san, "uci": move.uci()}
        board.push(move)
        row["fen_after"] = board.fen()
        rows.append(row)
    return rows


def test_blunder_is_tagged_with_the_tactic_it_allowed():
    qxe5 = hung_queen_rows()[4]
    tags = tags_for_move(
        fen_before=qxe5["fen_before"],
        fen_after=qxe5["fen_after"],
        played_san="Qxe5+",
        best_move_uci="b1c3",  # engine preferred a quiet move
        classification="blunder",
        opponent_best_uci="c6e5",  # ...which now wins the queen
    )
    assert tags == ["hanging_piece"]


def test_unflagged_move_gets_no_allowed_tactic_tags():
    qxe5 = hung_queen_rows()[4]
    tags = tags_for_move(
        fen_before=qxe5["fen_before"],
        fen_after=qxe5["fen_after"],
        played_san="Qxe5+",
        best_move_uci="b1c3",
        classification="good",  # hypothetical: not flagged → nothing stored
        opponent_best_uci="c6e5",
    )
    assert tags == []


def test_playing_the_best_tactical_move_is_tagged_as_executed():
    nxe5 = hung_queen_rows()[5]
    tags = tags_for_move(
        fen_before=nxe5["fen_before"],
        fen_after=nxe5["fen_after"],
        played_san="Nxe5",
        best_move_uci="c6e5",  # played == best, and it wins the hung queen
        classification="best",
        opponent_best_uci="g1f3",
    )
    assert tags == ["hanging_piece"]


def test_unanalyzed_move_gets_no_tags():
    e4 = hung_queen_rows()[0]
    tags = tags_for_move(
        fen_before=e4["fen_before"],
        fen_after=e4["fen_after"],
        played_san="e4",
        best_move_uci=None,
        classification=None,
        opponent_best_uci=None,
    )
    assert tags == []


# --- apply_rule_based_tags: game-level wiring, re-runnable, keeps manual ---

ANALYSIS_BY_PLY = {
    1: ("e2e4", "best"),
    2: ("e7e5", "best"),
    3: ("g1f3", "inaccuracy"),  # Qh5 wasn't best but isn't flagged either
    4: ("b8c6", "best"),
    5: ("b1c3", "blunder"),  # Qxe5+?? — best was a quiet move
    6: ("c6e5", "best"),  # Nxe5 takes the hung queen
}


def analyzed_hung_queen_game() -> Game:
    game = Game(pgn="", white="w", black="b", analysis_status="complete")
    for ply, row in enumerate(hung_queen_rows(), start=1):
        best, classification = ANALYSIS_BY_PLY[ply]
        game.moves.append(
            Move(
                ply=ply,
                san=row["san"],
                fen_before=row["fen_before"],
                fen_after=row["fen_after"],
                best_move=best,
                classification=classification,
            )
        )
    return game


def test_apply_rule_based_tags_tags_blunder_and_punish(db_session):
    game = analyzed_hung_queen_game()
    db_session.add(game)
    apply_rule_based_tags(game)
    db_session.commit()

    by_ply = {move.ply: move.motifs for move in game.moves}
    assert by_ply == {1: [], 2: [], 3: [], 4: [], 5: ["hanging_piece"], 6: ["hanging_piece"]}


def test_apply_rule_based_tags_is_idempotent_and_keeps_manual_tags(db_session):
    game = analyzed_hung_queen_game()
    db_session.add(game)
    apply_rule_based_tags(game)
    game.moves[4].motif_tags.append(MotifTag(motif="pin", source="manual"))
    db_session.commit()

    apply_rule_based_tags(game)  # re-run, as scripts/retag.py would
    db_session.commit()

    blunder = game.moves[4]
    assert blunder.motifs == ["hanging_piece", "pin"]  # no duplicates
    assert {tag.motif: tag.source for tag in blunder.motif_tags} == {
        "hanging_piece": "rule_based",
        "pin": "manual",
    }
    # tags survive in the database, not just on the in-memory objects
    stored = db_session.scalars(
        select(MotifTag).join(Move).where(Move.game_id == game.id)
    ).all()
    assert sorted(tag.motif for tag in stored) == ["hanging_piece", "hanging_piece", "pin"]


def test_review_endpoint_exposes_motifs(client, db_session):
    game_id = client.post("/games", json={}).json()["id"]
    client.post(f"/games/{game_id}/moves", json={"san": "e4"})
    move = db_session.scalars(select(Move).where(Move.game_id == game_id)).one()
    move.motif_tags.append(MotifTag(motif="fork"))
    db_session.commit()

    body = client.get(f"/games/{game_id}/review").json()
    assert body["moves"][0]["motifs"] == ["fork"]
