"""Opening names, where a game left the book, and the repertoire Progress
builds from them (app/openings.py)."""

from types import SimpleNamespace

import chess
import pytest

from app.openings import book_moves, left_book, opening_of

pytestmark = pytest.mark.unit


def played(*sans: str, start: str = chess.STARTING_FEN):
    board = chess.Board(start)
    moves = []
    for ply, san in enumerate(sans, start=1):
        fen_before = board.fen()
        board.push_san(san)
        moves.append(
            SimpleNamespace(
                ply=ply, san=san, fen_before=fen_before, fen_after=board.fen()
            )
        )
    return moves


ITALIAN = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d4", "exd4"]


def test_the_deepest_named_line_names_the_opening():
    opening = opening_of(played(*ITALIAN))
    assert (opening.eco, opening.family) == ("C54", "Italian Game")
    assert opening.variation == "Classical Variation, Center Attack"


def test_a_family_only_entry_keeps_the_variation_named_before_it():
    """The client's openingForFens rule: 1.e4 c5 2.Nf3 d6 names the Modern
    Variations; 3.d4 is just "Sicilian Defense", which must not erase it."""
    opening = opening_of(played("e4", "c5", "Nf3", "d6", "d4"))
    assert opening.family == "Sicilian Defense"
    assert opening.variation == "Modern Variations"


def test_no_named_position_is_no_opening():
    assert opening_of(played("Kd2", start="4k3/8/8/8/8/8/4P3/4K3 w - - 0 1")) is None


def test_the_first_move_off_the_book_is_found_with_the_book_moves_there():
    left = left_book(played(*ITALIAN, "Ke2"))
    assert (left.ply, left.san) == (11, "Ke2")
    assert left.book_moves == ["O-O", "b4", "cxd4", "e5"]


def test_a_game_still_in_the_book_has_not_left_it():
    assert left_book(played(*ITALIAN)) is None


def test_a_position_set_up_off_the_book_never_left_it():
    endgame = played("Kd2", start="4k3/8/8/8/8/8/4P3/4K3 w - - 0 1")
    assert left_book(endgame) is None


def test_book_moves_lists_the_known_continuations():
    assert "e4" in book_moves(chess.STARTING_FEN)
    assert "Kf2" not in book_moves(chess.STARTING_FEN)


# --- the review endpoint and the repertoire on Progress ---


def _game(db_session, owner, sans, *, color="white", result="1-0", mode="engine"):
    from app.models import Game, Move

    game = Game(
        pgn="", mode=mode, user_color=color, result=result,
        analysis_status="complete", user_id=owner,
    )  # fmt: skip
    for move in played(*sans):
        game.moves.append(
            Move(
                ply=move.ply,
                san=move.san,
                fen_before=move.fen_before,
                fen_after=move.fen_after,
            )
        )
    db_session.add(game)
    db_session.commit()
    return game


def test_review_names_the_opening_and_where_the_game_left_the_book(
    client, db_session, signed_in_user
):
    game = _game(db_session, signed_in_user.id, [*ITALIAN, "Ke2"])
    review = client.get(f"/games/{game.id}/review").json()
    assert review["opening"] == {
        "eco": "C54",
        "family": "Italian Game",
        "variation": "Classical Variation, Center Attack",
    }
    assert review["left_book"] == {
        "ply": 11,
        "san": "Ke2",
        "book_moves": ["O-O", "b4", "cxd4", "e5"],
    }


def test_progress_lists_your_openings_by_side_with_where_you_leave_the_book(
    client, db_session, signed_in_user
):
    owner = signed_in_user.id
    # twice the Italian as White, leaving the book with 6.Ke2 both times
    _game(db_session, owner, [*ITALIAN, "Ke2"], result="1-0")
    _game(db_session, owner, [*ITALIAN, "Ke2"], result="0-1")
    # once as Black, where the engine (White) left the book first
    _game(db_session, owner, [*ITALIAN, "Kf1"], color="black", result="1/2-1/2")
    # pass-and-play has no side of your own: not part of a repertoire
    _game(db_session, owner, ITALIAN, mode="local")

    lines = client.get("/progress").json()["repertoire"]
    assert [(line["color"], line["family"], line["games"]) for line in lines] == [
        ("white", "Italian Game", 2),
        ("black", "Italian Game", 1),
    ]
    white, black = lines
    assert (white["wins"], white["draws"], white["losses"]) == (1, 0, 1)
    assert white["you_left"] == 2
    assert white["exit"] == {
        "ply": 11,
        "san": "Ke2",
        "book_moves": ["O-O", "b4", "cxd4", "e5"],
        "times": 2,
    }
    assert black["draws"] == 1
    assert (black["you_left"], black["exit"]) == (0, None)  # White left first
