import io
from datetime import datetime, timezone

import chess
import chess.pgn
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analysis import run_game_analysis
from app.db import get_db
from app.models import Game, Move, utcnow
from app.puzzle_generation import create_puzzles_for_game
from app.schemas import (
    GameComplete,
    GameCreate,
    GameCreated,
    GameDetail,
    GameOut,
    MoveAccepted,
    MoveIn,
    PracticeQueued,
)

router = APIRouter(prefix="/games", tags=["games"])


def _get_game_or_404(game_id: int, db: Session) -> Game:
    game = db.get(Game, game_id)
    if game is None:
        raise HTTPException(status_code=404, detail="Game not found")
    return game


def _current_board(game: Game) -> chess.Board:
    """The live position: server-derived FENs are the source of truth."""
    if game.moves:
        return chess.Board(game.moves[-1].fen_after)
    return chess.Board()


def _rebuild_pgn(game: Game) -> str:
    board = chess.Board()
    for move in game.moves:
        board.push_san(move.san)
    pgn = chess.pgn.Game.from_board(board)
    pgn.headers["Event"] = "leechess casual game"
    pgn.headers["White"] = game.white
    pgn.headers["Black"] = game.black
    pgn.headers["Result"] = game.result
    pgn.headers["Date"] = datetime.now(timezone.utc).strftime("%Y.%m.%d")
    return str(pgn)


@router.post("", response_model=GameCreated, status_code=201)
def create_game(payload: GameCreate, db: Session = Depends(get_db)) -> dict:
    if payload.pgn is not None:
        game = _import_pgn(payload)
    else:
        game = Game(pgn="", white=payload.white, black=payload.black, mode=payload.mode)
    db.add(game)
    db.commit()
    fen = _current_board(game).fen()
    return {**GameOut.model_validate(game).model_dump(), "fen": fen}


def _import_pgn(payload: GameCreate) -> Game:
    """Phase-0 path: store an already-played game from a full PGN."""
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
    return game


@router.get("", response_model=list[GameOut])
def list_games(db: Session = Depends(get_db)) -> list[Game]:
    return list(db.scalars(select(Game).order_by(Game.id.desc()).limit(100)))


@router.get("/{game_id}", response_model=GameDetail)
def get_game(game_id: int, db: Session = Depends(get_db)) -> Game:
    return _get_game_or_404(game_id, db)


@router.post("/{game_id}/moves", response_model=MoveAccepted, status_code=201)
def submit_move(
    game_id: int, payload: MoveIn, db: Session = Depends(get_db)
) -> MoveAccepted:
    game = _get_game_or_404(game_id, db)
    if game.analysis_status != "pending":
        raise HTTPException(status_code=409, detail="Game is already completed")

    board = _current_board(game)
    # Server-side legality check — never trust client-only validation.
    try:
        if payload.uci:
            move = chess.Move.from_uci(payload.uci)
            if move not in board.legal_moves:
                raise ValueError(f"illegal move: {payload.uci}")
        else:
            move = board.parse_san(payload.san)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    fen_before = board.fen()
    san = board.san(move)
    board.push(move)
    game.moves.append(
        Move(
            ply=len(game.moves) + 1,
            san=san,
            fen_before=fen_before,
            fen_after=board.fen(),
        )
    )
    db.commit()
    return MoveAccepted(
        ply=len(game.moves),
        san=san,
        uci=move.uci(),
        fen_after=board.fen(),
        turn="white" if board.turn == chess.WHITE else "black",
        game_over=board.is_game_over(),
    )


@router.post("/{game_id}/complete", response_model=GameOut)
def complete_game(
    game_id: int,
    payload: GameComplete,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> Game:
    game = _get_game_or_404(game_id, db)
    if game.analysis_status != "pending":
        raise HTTPException(status_code=409, detail="Game is already completed")
    if not game.moves:
        raise HTTPException(status_code=422, detail="Game has no moves")

    board = _current_board(game)
    if board.is_game_over():
        game.result = board.result()
    elif payload.result is not None:
        game.result = payload.result  # resignation / agreed draw
    else:
        game.result = "*"

    if not game.pgn:  # imported games keep their original PGN
        game.pgn = _rebuild_pgn(game)
    game.analysis_status = "analyzing"
    db.commit()
    background.add_task(run_game_analysis, game.id)
    return game


@router.get("/{game_id}/review", response_model=GameDetail)
def get_review(game_id: int, db: Session = Depends(get_db)) -> Game:
    """Full move list with evals/classifications once analysis is done;
    the client shows an "analyzing…" state while analysis_status says so."""
    return _get_game_or_404(game_id, db)


@router.post("/{game_id}/practice", response_model=PracticeQueued)
def practice_game(game_id: int, db: Session = Depends(get_db)) -> PracticeQueued:
    """Review's "practice these misses": the analysis job already created
    puzzles for this game's flagged moves — this makes them all due right
    now (and fills any gaps, e.g. games analyzed before Phase 3)."""
    game = _get_game_or_404(game_id, db)
    if game.analysis_status != "complete":
        raise HTTPException(status_code=409, detail="Game is not analyzed yet")

    create_puzzles_for_game(game)
    now = utcnow()
    queued = 0
    for move in game.moves:
        for puzzle in move.puzzles:
            puzzle.due_at = now
            queued += 1
    db.commit()
    return PracticeQueued(game_id=game.id, queued=queued)
