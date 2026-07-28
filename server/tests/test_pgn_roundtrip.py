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
    """Server-side export → import round-trip: SAN and FEN match at every ply.

    The per-ply expectations are recorded from the ORIGINAL game before the
    export, then compared against the reimported replay. Pushing the
    reimported moves into a second board and comparing the two proves nothing
    — both boards received the same input, so they cannot disagree.
    """
    sans = ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "cxd5", "exd5", "Bg5"]
    board = chess.Board()
    expected: list[tuple[str, str]] = []
    for san in sans:
        move = board.parse_san(san)
        expected.append((board.san(move), board.fen()))
        board.push(move)
        expected[-1] = (expected[-1][0], board.fen())

    game = chess.pgn.Game.from_board(board)
    exported = str(game)

    reimported = chess.pgn.read_game(io.StringIO(exported))
    assert reimported is not None
    assert not reimported.errors

    replay = reimported.board()
    plies = 0
    for move, (expected_san, expected_fen) in zip(
        reimported.mainline_moves(), expected, strict=True
    ):
        assert replay.san(move) == expected_san
        replay.push(move)
        assert replay.fen() == expected_fen
        plies += 1

    assert plies == len(sans)
    assert replay.fen() == board.fen()
