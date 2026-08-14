import io
from datetime import datetime, timezone

import chess
import chess.pgn
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.analysis import run_game_analysis
from app.auth.backend import current_active_user
from app.auth.models import User
from app.db import get_db
from app.models import Game, Move, UserId, utcnow
from app.puzzle_generation import create_puzzles_for_game
from app.pgn import MAX_HEADER_VALUE, header_value
from app.schemas import (
    MAX_IMPORTED_PLIES,
    RESULTS,
    GameComplete,
    GameCreate,
    GameCreated,
    GameDetail,
    GameOut,
    MoveAccepted,
    MoveIn,
    PracticeQueued,
    TakebackIn,
    TakebackResult,
)
from app.scheduling import puzzle_state

router = APIRouter(prefix="/games", tags=["games"])


def _get_game_or_404(game_id: int, db: Session, user: User) -> Game:
    """404 rather than 403 for someone else's game: whether a given id exists
    is not information this app owes a caller."""
    game = db.get(Game, game_id)
    if game is None or game.user_id != user.id:
        raise HTTPException(status_code=404, detail="Game not found")
    return game


def next_game_number(db: Session, user_id: UserId) -> int:
    """The number the account's next saved game takes.

    Counted at completion rather than at creation, so the sequence has no
    holes: a game started and abandoned (New game, a closed tab) is deleted
    rather than kept, and burning a number on it would leave the review list
    reading #1, #3, #7.
    """
    highest = db.scalar(select(func.max(Game.number)).where(Game.user_id == user_id))
    return (highest or 0) + 1


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
    # Own-account data, so this is not the injection surface app/live.py's
    # writer is — but it is the same writer with the same lack of escaping in
    # python-chess underneath, and a name is a name.
    pgn.headers["White"] = header_value(game.white)
    pgn.headers["Black"] = header_value(game.black)
    pgn.headers["Result"] = game.result
    pgn.headers["Date"] = datetime.now(timezone.utc).strftime("%Y.%m.%d")
    return str(pgn)


@router.post("", response_model=GameCreated, status_code=201)
def create_game(
    payload: GameCreate,
    db: Session = Depends(get_db),
    user: User = Depends(current_active_user),
) -> dict:
    if payload.pgn is not None:
        game = _import_pgn(payload)
    else:
        game = Game(
            pgn="",
            white=payload.white,
            black=payload.black,
            mode=payload.mode,
            user_color=payload.user_color,
        )
    game.user_id = user.id
    db.add(game)
    db.commit()
    fen = _current_board(game).fen()
    return {**GameOut.model_validate(game).model_dump(), "fen": fen}


def _imported_name(value: str | None) -> str:
    """A player name lifted out of somebody's PGN file, trimmed to something a
    column and a nav bar can hold. "?" is PGN's own word for unknown."""
    cleaned = " ".join((value or "").split())[:MAX_HEADER_VALUE]
    return cleaned or "?"


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
        # Straight off an uploaded file and into a column with no length of its
        # own, so bounded here. `result` is checked against the known set rather
        # than trusted: it is what the review list and the win/loss counts read.
        white=_imported_name(parsed.headers.get("White")),
        black=_imported_name(parsed.headers.get("Black")),
        result=(
            parsed.headers.get("Result", "*")
            if parsed.headers.get("Result") in RESULTS
            else "*"
        ),
        mode=payload.mode,
    )
    board = parsed.board()
    for ply, move in enumerate(parsed.mainline_moves(), start=1):
        if ply > MAX_IMPORTED_PLIES:
            raise HTTPException(
                status_code=422,
                detail=f"PGN has more than {MAX_IMPORTED_PLIES} plies",
            )
        fen_before = board.fen()
        san = board.san(move)
        board.push(move)
        game.moves.append(
            Move(ply=ply, san=san, fen_before=fen_before, fen_after=board.fen())
        )
    return game


@router.get("", response_model=list[GameOut])
def list_games(
    db: Session = Depends(get_db),
    user: User = Depends(current_active_user),
) -> list[Game]:
    """Finished games only — in-progress and abandoned games ("pending")
    never appear in the review list."""
    return list(
        db.scalars(
            select(Game)
            .where(Game.user_id == user.id, Game.analysis_status != "pending")
            # Newest first, by the number the list actually shows — ordering by
            # row id instead would read out of sequence for anyone whose games
            # were not completed in the order they were started.
            .order_by(Game.number.desc(), Game.id.desc())
            .limit(100)
        )
    )


@router.get("/{game_id}", response_model=GameDetail)
def get_game(
    game_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_active_user),
) -> Game:
    return _get_game_or_404(game_id, db, user)


@router.post("/{game_id}/moves", response_model=MoveAccepted, status_code=201)
def submit_move(
    game_id: int,
    payload: MoveIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_active_user),
) -> MoveAccepted:
    game = _get_game_or_404(game_id, db, user)
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


@router.post("/{game_id}/takeback", response_model=TakebackResult)
def take_back(
    game_id: int,
    payload: TakebackIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_active_user),
) -> TakebackResult:
    """Play's "take back and think again": drop the trailing plies so the
    record matches the board the player is now looking at. Pending games only
    — a completed game's moves own analysis rows (and the puzzles generated
    from them), and its PGN is already written."""
    game = _get_game_or_404(game_id, db, user)
    if game.analysis_status != "pending":
        raise HTTPException(status_code=409, detail="Game is already completed")
    if payload.to_ply > len(game.moves):
        raise HTTPException(status_code=409, detail="to_ply is beyond the last move")

    # delete-orphan on Game.moves turns the detach into a row delete; the
    # relationship is ply-ordered, so the slice is the tail.
    for move in list(game.moves[payload.to_ply :]):
        game.moves.remove(move)
    db.commit()
    return TakebackResult(ply=len(game.moves), fen=_current_board(game).fen())


@router.post("/{game_id}/complete", response_model=GameOut)
def complete_game(
    game_id: int,
    payload: GameComplete,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(current_active_user),
) -> Game:
    game = _get_game_or_404(game_id, db, user)
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
    # This is where a game becomes one of the account's — number it now, so
    # the number counts saved games rather than attempts at one.
    if game.number is None:
        game.number = next_game_number(db, user.id)
    db.commit()
    background.add_task(run_game_analysis, game.id)
    return game


@router.delete("/{game_id}", status_code=204)
def discard_game(
    game_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_active_user),
) -> None:
    """Abandoned mid-game (new game started, page closed): the unfinished
    game is discarded, not kept for review. Completed games are permanent."""
    game = _get_game_or_404(game_id, db, user)
    if game.analysis_status != "pending":
        raise HTTPException(status_code=409, detail="Game is already completed")
    db.delete(game)
    db.commit()


@router.get("/{game_id}/review", response_model=GameDetail)
def get_review(
    game_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_active_user),
) -> Game:
    """Full move list with evals/classifications once analysis is done;
    the client shows an "analyzing…" state while analysis_status says so."""
    return _get_game_or_404(game_id, db, user)


@router.post("/{game_id}/practice", response_model=PracticeQueued)
def practice_game(
    game_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_active_user),
) -> PracticeQueued:
    """Review's "practice these misses": the analysis job already created
    puzzles for this game's flagged moves — this makes them all due right
    now (and fills any gaps, e.g. games analyzed before Phase 3)."""
    game = _get_game_or_404(game_id, db, user)
    if game.analysis_status != "complete":
        raise HTTPException(status_code=409, detail="Game is not analyzed yet")

    create_puzzles_for_game(game)
    now = utcnow()
    queued = 0
    for move in game.moves:
        for puzzle in move.puzzles:
            # Bring the due date forward without touching the box: this is
            # "drill these again now", not "forget what I knew about them".
            # A puzzle with no state row has never been answered and is
            # already due, so there is nothing to bring forward.
            state = puzzle_state(db, user.id, puzzle.id)
            if state is not None:
                state.due_at = now
            queued += 1
    db.commit()
    return PracticeQueued(game_id=game.id, queued=queued)
