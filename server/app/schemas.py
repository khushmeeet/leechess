from datetime import datetime

from pydantic import BaseModel, ConfigDict


class GameCreate(BaseModel):
    pgn: str
    mode: str = "local"


class MoveOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ply: int
    san: str
    fen_before: str
    fen_after: str
    eval_before: float | None
    eval_after: float | None
    classification: str | None
    best_move: str | None


class GameOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    white: str
    black: str
    result: str
    mode: str
    created_at: datetime
    analysis_status: str


class GameDetail(GameOut):
    pgn: str
    moves: list[MoveOut]
