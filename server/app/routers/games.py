import io

import chess.pgn
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Game, Move
from app.schemas import GameCreate, GameDetail, GameOut

router = APIRouter(prefix="/games", tags=["games"])


@router.post("", response_model=GameOut, status_code=201)
def create_game(payload: GameCreate, db: Session = Depends(get_db)) -> Game:
    parsed = chess.pgn.read_game(io.StringIO(payload.pgn))
    if parsed is None:
        raise HTTPException(status_code=422, detail="Could not parse PGN")
    if parsed.errors:
        raise HTTPException(
            status_code=422,
            detail=f"PGN contains errors: {'; '.join(str(e) for e in parsed.errors)}",
        )
    if parsed.next() is None:
        raise HTTPException(status_code=422, detail="PGN contains no moves")

    game = Game(
        pgn=payload.pgn,
        white=parsed.headers.get("White", "?"),
        black=parsed.headers.get("Black", "?"),
        result=parsed.headers.get("Result", "*"),
        mode=payload.mode,
    )

    board = parsed.board()
    for ply, move in enumerate(parsed.mainline_moves(), start=1):
        fen_before = board.fen()
        san = board.san(move)
        board.push(move)
        game.moves.append(
            Move(ply=ply, san=san, fen_before=fen_before, fen_after=board.fen())
        )

    db.add(game)
    db.commit()
    return game


@router.get("/{game_id}", response_model=GameDetail)
def get_game(game_id: int, db: Session = Depends(get_db)) -> Game:
    game = db.get(Game, game_id)
    if game is None:
        raise HTTPException(status_code=404, detail="Game not found")
    return game
