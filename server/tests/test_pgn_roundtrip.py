import io

import chess
import chess.pgn
import pytest

pytestmark = pytest.mark.unit


def test_chessjs_pgn_roundtrips_through_python_chess(clientside_game):
    """The client (chess.js) and server (python-chess) must agree on the same
    PGN: identical SAN and identical FEN at every ply."""
    game = chess.pgn.read_game(io.StringIO(clientside_game["pgn"]))
    assert game is not None
    assert not game.errors

    board = game.board()
    plies = 0
    for move, expected_san, expected_fen in zip(
        game.mainline_moves(),
        clientside_game["sans"],
        clientside_game["fens"],
        strict=True,
    ):
        assert board.san(move) == expected_san
        board.push(move)
        assert board.fen() == expected_fen
        plies += 1

    assert plies == len(clientside_game["sans"])


def test_python_chess_pgn_reimports_cleanly():
    """Server-side export → import round-trip: FEN matches at every ply."""
    board = chess.Board()
    for san in ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "cxd5", "exd5", "Bg5"]:
        board.push_san(san)

    game = chess.pgn.Game.from_board(board)
    exported = str(game)

    reimported = chess.pgn.read_game(io.StringIO(exported))
    assert reimported is not None

    replay = reimported.board()
    original = chess.Board()
    for move in reimported.mainline_moves():
        replay.push(move)
        original.push(move)
        assert replay.fen() == original.fen()
    assert replay.fen() == board.fen()
