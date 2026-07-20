from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

RESULTS = {"1-0", "0-1", "1/2-1/2", "*"}


class GameCreate(BaseModel):
    """Start a live game (no pgn) or import a finished one (pgn set)."""

    pgn: str | None = None
    mode: str = "local"
    white: str = "player"
    black: str = "player"
    # Side the human plays (engine games) — drives progress/summary stats.
    user_color: str = "white"

    @field_validator("user_color")
    @classmethod
    def validate_user_color(cls, value: str) -> str:
        if value not in {"white", "black"}:
            raise ValueError("user_color must be 'white' or 'black'")
        return value


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
    motifs: list[str]
    explanation: str | None

    @field_validator("explanation", mode="before")
    @classmethod
    def explanation_text(cls, value: object) -> object:
        """The ORM hands over the Explanation row; the API serves its text."""
        return getattr(value, "text", value)


class GameOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    white: str
    black: str
    result: str
    mode: str
    user_color: str
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
    # Cached LLM coach takeaways — None until the analysis job writes them.
    summary: str | None

    @field_validator("summary", mode="before")
    @classmethod
    def summary_text(cls, value: object) -> object:
        """The ORM hands over the CoachSummary row; the API serves its text."""
        return getattr(value, "text", value)


class PuzzleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    fen: str
    # Stored as one space-separated UCI string; served as a list, solver's
    # move first, opponent replies interleaved.
    solution: list[str]
    motif: str
    difficulty: int | None
    source_move_id: int | None  # None = generic Lichess import
    box: int
    due_at: datetime

    @field_validator("solution", mode="before")
    @classmethod
    def split_solution(cls, value: object) -> object:
        return value.split() if isinstance(value, str) else value


class AttemptIn(BaseModel):
    correct: bool
    # Highest ladder level revealed while solving (0-5); >= 4 means the move
    # itself was shown, which gates Leitner advancement.
    hint_level_used: int = Field(default=0, ge=0, le=5)


class AttemptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    puzzle_id: int
    correct: bool
    hint_level_used: int
    attempted_at: datetime


class AttemptRecorded(AttemptOut):
    """POST /puzzles/{id}/attempt response: the attempt plus the puzzle's
    updated Leitner state, so the client can show what happens next."""

    box: int
    due_at: datetime


class PuzzleDetail(PuzzleOut):
    attempts: list[AttemptOut]


class SeedStatusOut(BaseModel):
    """GET/POST /puzzles/seed response: the in-memory state of the generic
    pool's background seeding run plus what's actually in the pool."""

    state: str  # idle | running | complete | failed
    scanned: int  # dump rows read so far this run
    imported: int  # puzzles added this run
    error: str | None
    pool: dict[str, int]  # generic puzzles per motif, from the database


class PracticeQueued(BaseModel):
    """POST /games/{id}/practice response."""

    game_id: int
    queued: int  # puzzles from this game now due for drilling


class MotifProgress(BaseModel):
    motif: str
    attempts: int
    correct: int
    success_rate: float  # correct / attempts, 0..1


class GameCplPoint(BaseModel):
    """One analyzed game's average centipawn loss, from the player's side
    (engine games count only the side you played, per the game's user_color;
    local pass-and-play counts both sides). Phase splits use the same rough
    ply boundaries the Review CPL graph draws; None = no moves in that phase.
    """

    game_id: int
    created_at: datetime
    mode: str
    avg_cpl: float
    opening_cpl: float | None
    middlegame_cpl: float | None
    endgame_cpl: float | None


class ProgressOut(BaseModel):
    """GET /progress response — everything computed on read (spec §4.5)."""

    days: int | None  # echo of the window filter; None = all-time
    motifs: list[MotifProgress]  # weakest first
    weakest_motifs: list[MotifProgress]  # ≤3, enough attempts, <100% success
    cpl_trend: list[GameCplPoint]  # oldest → newest
    streak_days: int
    puzzles_solved: int  # correct attempts within the window


class WikibookPageOut(BaseModel):
    """One Wikibooks opening-theory page along a game's move sequence."""

    ply: int  # the page describes the position after this many plies
    title: str  # resolved page title (redirects followed)
    url: str  # canonical page URL — shown for CC BY-SA attribution
    html: str  # sanitized page body, safe to inject into the panel


class WikibookLineOut(BaseModel):
    """GET /wikibook/line response: pages for each ply from move 1 until the
    first line Wikibooks has no page for. pages[i] covers ply i+1."""

    pages: list[WikibookPageOut]
