from datetime import datetime

from pydantic import BaseModel, ConfigDict, model_validator

RESULTS = {"1-0", "0-1", "1/2-1/2", "*"}


class GameCreate(BaseModel):
    """Start a live game (no pgn) or import a finished one (pgn set)."""

    pgn: str | None = None
    mode: str = "local"
    white: str = "player"
    black: str = "player"


class MoveIn(BaseModel):
    """One move played live, as UCI ("e2e4", "e7e8q") or SAN ("Nf3")."""

    uci: str | None = None
    san: str | None = None

    @model_validator(mode="after")
    def require_one_encoding(self) -> "MoveIn":
        if not self.uci and not self.san:
            raise ValueError("provide either uci or san")
        return self


class GameComplete(BaseModel):
    """Result is optional: the server derives checkmate/stalemate itself;
    pass one explicitly for resignations/agreed draws."""

    result: str | None = None

    @model_validator(mode="after")
    def validate_result(self) -> "GameComplete":
        if self.result is not None and self.result not in RESULTS:
            raise ValueError(f"result must be one of {sorted(RESULTS)}")
        return self


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


class GameCreated(GameOut):
    """POST /games response: includes the current position so the client can
    render immediately (starting FEN for a fresh game)."""

    fen: str


class MoveAccepted(BaseModel):
    ply: int
    san: str
    uci: str
    fen_after: str
    turn: str  # "white" | "black" — side to move after this move
    game_over: bool


class GameDetail(GameOut):
    pgn: str
    moves: list[MoveOut]
