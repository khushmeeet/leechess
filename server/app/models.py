import uuid
from datetime import datetime, timezone

from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

# Nullable everywhere it appears, and deliberately so: rows written before
# accounts existed have no owner, and SQLite can only ADD COLUMN with a NULL
# default anyway. The migration in app/main.py adopts them when there is
# exactly one account to adopt them into; the routers treat NULL as "not
# yours" either way, so an unowned row is invisible rather than public.
UserId = uuid.UUID


def _owner_column() -> Mapped[UserId | None]:
    return mapped_column(GUID, ForeignKey("users.id"), nullable=True, index=True)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Game(Base):
    __tablename__ = "games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[UserId | None] = _owner_column()
    # What the app calls this game — "game #3" — counted per account, in the
    # order games were saved. The primary key can't do this job: it is one
    # global sequence over everybody's rows, so a new account's first game
    # came out as #189. Assigned on completion (see routers/games.py), which
    # is when a game becomes something to look back at; NULL until then, and
    # on games abandoned before they got there.
    number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pgn: Mapped[str] = mapped_column(Text)
    white: Mapped[str] = mapped_column(String, default="?")
    black: Mapped[str] = mapped_column(String, default="?")
    result: Mapped[str] = mapped_column(String, default="*")
    mode: Mapped[str] = mapped_column(String, default="local")
    # Which side the human played in an engine game ("white"/"black") —
    # progress stats and coach summaries attribute moves by it. Local
    # pass-and-play games keep the default; every move counts as the user's.
    user_color: Mapped[str] = mapped_column(
        String, default="white", server_default="white"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    analysis_status: Mapped[str] = mapped_column(String, default="pending")

    moves: Mapped[list["Move"]] = relationship(
        back_populates="game", cascade="all, delete-orphan", order_by="Move.ply"
    )
    summary: Mapped["CoachSummary | None"] = relationship(
        back_populates="game", cascade="all, delete-orphan"
    )


class Move(Base):
    __tablename__ = "moves"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id"), index=True)
    ply: Mapped[int] = mapped_column(Integer)
    san: Mapped[str] = mapped_column(String)
    fen_before: Mapped[str] = mapped_column(String)
    fen_after: Mapped[str] = mapped_column(String)
    # Populated by the Phase 1 analysis job; nullable until then.
    eval_before: Mapped[float | None] = mapped_column(Float, nullable=True)
    eval_after: Mapped[float | None] = mapped_column(Float, nullable=True)
    classification: Mapped[str | None] = mapped_column(String, nullable=True)
    best_move: Mapped[str | None] = mapped_column(String, nullable=True)

    game: Mapped[Game] = relationship(back_populates="moves")
    motif_tags: Mapped[list["MotifTag"]] = relationship(
        back_populates="move", cascade="all, delete-orphan", order_by="MotifTag.motif"
    )
    puzzles: Mapped[list["Puzzle"]] = relationship(
        back_populates="source_move", cascade="all, delete-orphan"
    )
    explanation: Mapped["Explanation | None"] = relationship(
        back_populates="move", cascade="all, delete-orphan"
    )

    @property
    def motifs(self) -> list[str]:
        """Tag names as the API exposes them (rule-based and manual alike).
        Sorted here, not via relationship order_by, so freshly-appended
        in-session tags read the same as reloaded ones."""
        return sorted(tag.motif for tag in self.motif_tags)


class MotifTag(Base):
    __tablename__ = "motif_tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    move_id: Mapped[int] = mapped_column(ForeignKey("moves.id"), index=True)
    motif: Mapped[str] = mapped_column(String)
    source: Mapped[str] = mapped_column(String, default="rule_based")

    move: Mapped[Move] = relationship(back_populates="motif_tags")


class Explanation(Base):
    """Cached LLM "why" text for one flagged move (spec §5) — generated once
    per move by the Phase 5 pass, never regenerated. One row per move."""

    __tablename__ = "explanations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    move_id: Mapped[int] = mapped_column(
        ForeignKey("moves.id"), index=True, unique=True
    )
    text: Mapped[str] = mapped_column(Text)
    model: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    move: Mapped[Move] = relationship(back_populates="explanation")


class CoachSummary(Base):
    """Cached LLM coach takeaways for one analyzed game — the game-level
    companion to Explanation, same cost-control pattern: generated once by
    the analysis job, never regenerated. One row per game."""

    __tablename__ = "coach_summaries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    game_id: Mapped[int] = mapped_column(
        ForeignKey("games.id"), index=True, unique=True
    )
    text: Mapped[str] = mapped_column(Text)
    model: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    game: Mapped[Game] = relationship(back_populates="summary")


class PuzzleSeedRun(Base):
    """One completed generic-pool seeding run (app/seeding.py). Presence of
    any row is what stops startup from re-streaming the Lichess dump on
    every boot — a run that dies mid-way leaves no row, so the next restart
    resumes it. Delete the row(s) to force a re-seed."""

    __tablename__ = "puzzle_seed_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    imported: Mapped[int] = mapped_column(Integer, default=0)


class Puzzle(Base):
    """One drillable position. Personal puzzles point back at the game move
    they came from via source_move_id and are owned by whoever played that
    game; generic Lichess imports have NULL for both (spec §5) and are one
    shared pool every account drills from.

    Scheduling state is NOT here — it is per account, in PuzzleState, because
    the generic pool is shared and two people cannot share a due date."""

    __tablename__ = "puzzles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # NULL for the shared generic pool; set for personal puzzles, denormalized
    # from the game the source move belongs to so the queue can filter without
    # joining three tables.
    user_id: Mapped[UserId | None] = _owner_column()
    source_move_id: Mapped[int | None] = mapped_column(
        ForeignKey("moves.id"), nullable=True, index=True
    )
    fen: Mapped[str] = mapped_column(String)
    # Space-separated UCI moves, solver to move first; opponent replies
    # interleaved for multi-move solutions.
    solution: Mapped[str] = mapped_column(String)
    motif: Mapped[str] = mapped_column(String, index=True)
    # Lichess rating for imported puzzles; personal ones have no difficulty.
    difficulty: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    source_move: Mapped[Move | None] = relationship(back_populates="puzzles")
    attempts: Mapped[list["PuzzleAttempt"]] = relationship(
        back_populates="puzzle",
        cascade="all, delete-orphan",
        order_by="PuzzleAttempt.id",
    )
    states: Mapped[list["PuzzleState"]] = relationship(
        back_populates="puzzle", cascade="all, delete-orphan"
    )


class PuzzleState(Base):
    """One account's Leitner position on one puzzle.

    Split out from Puzzle because the generic Lichess pool is a single shared
    set of rows: two accounts drilling the same imported puzzle need their own
    box and due date. Rows are created lazily on the first attempt, so a new
    account has the whole catalog due immediately without anything being
    written for it — see app/scheduling.py, and the "no row means due now"
    join in the puzzle queue."""

    __tablename__ = "puzzle_states"
    __table_args__ = (UniqueConstraint("user_id", "puzzle_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Nullable for one reason only: the pre-accounts schedule. The migration
    # lifts box/due_at off the puzzle rows before dropping those columns, and
    # there may be no account yet to attribute them to — so they land here
    # unowned and adopt_orphaned_rows claims them alongside everything else.
    # Nothing writes NULL after that, and the queues join on user_id, so an
    # unadopted row is invisible rather than shared.
    user_id: Mapped[UserId | None] = _owner_column()
    puzzle_id: Mapped[int] = mapped_column(ForeignKey("puzzles.id"), index=True)
    box: Mapped[int] = mapped_column(Integer, default=1)
    due_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    puzzle: Mapped[Puzzle] = relationship(back_populates="states")


class PuzzleAttempt(Base):
    __tablename__ = "puzzle_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # On the attempt, not only on the puzzle: an attempt at a shared generic
    # puzzle belongs to whoever made it, and motif success rates would
    # otherwise pool everyone's answers together.
    user_id: Mapped[UserId | None] = _owner_column()
    puzzle_id: Mapped[int] = mapped_column(ForeignKey("puzzles.id"), index=True)
    correct: Mapped[bool] = mapped_column(Boolean)
    hint_level_used: Mapped[int] = mapped_column(Integer, default=0)
    attempted_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    puzzle: Mapped[Puzzle] = relationship(back_populates="attempts")


class EndgameDrill(Base):
    """One curated endgame position, played out against the engine rather than
    solved (app/endgame_drills.py holds the catalog these rows are seeded
    from). `goal` is "win" or "draw" — the whole grading rule, since a drill
    is scored on the result it reaches, not on a stored move sequence.

    This catalog is shared by every account — twelve rows, seeded once — so
    Leitner state lives per account in EndgameDrillState, exactly as it does
    for puzzles."""

    __tablename__ = "endgame_drills"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Stable catalog slug — seeding is insert-if-missing on this, so it is
    # what keeps a restart from duplicating or resetting drills.
    key: Mapped[str] = mapped_column(String, unique=True, index=True)
    family: Mapped[str] = mapped_column(String, index=True)
    name: Mapped[str] = mapped_column(String)
    fen: Mapped[str] = mapped_column(String)
    # The side the user plays; the engine takes the other one. When it isn't
    # this side's turn in `fen`, the engine opens the drill.
    player_color: Mapped[str] = mapped_column(String)
    goal: Mapped[str] = mapped_column(String)
    technique: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    attempts: Mapped[list["EndgameDrillAttempt"]] = relationship(
        back_populates="drill",
        cascade="all, delete-orphan",
        order_by="EndgameDrillAttempt.id",
    )
    states: Mapped[list["EndgameDrillState"]] = relationship(
        back_populates="drill", cascade="all, delete-orphan"
    )


class EndgameDrillState(Base):
    """One account's Leitner position on one catalog drill — the drill-side
    twin of PuzzleState, and lazily created the same way."""

    __tablename__ = "endgame_drill_states"
    __table_args__ = (UniqueConstraint("user_id", "drill_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Nullable for the same reason as PuzzleState.user_id — the carried-over
    # pre-accounts schedule, waiting to be adopted.
    user_id: Mapped[UserId | None] = _owner_column()
    drill_id: Mapped[int] = mapped_column(ForeignKey("endgame_drills.id"), index=True)
    box: Mapped[int] = mapped_column(Integer, default=1)
    due_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    drill: Mapped[EndgameDrill] = relationship(back_populates="states")


class EndgameDrillAttempt(Base):
    __tablename__ = "endgame_drill_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[UserId | None] = _owner_column()
    drill_id: Mapped[int] = mapped_column(ForeignKey("endgame_drills.id"), index=True)
    # Did the play-out reach the drill's goal (converted the win / held the draw)?
    success: Mapped[bool] = mapped_column(Boolean)
    # The user's own moves, not plies — how long the technique took.
    moves_played: Mapped[int] = mapped_column(Integer, default=0)
    # Why the drill ended, e.g. "promoted", "mate", "stalemate", "pawn-lost".
    outcome: Mapped[str] = mapped_column(String)
    attempted_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    drill: Mapped[EndgameDrill] = relationship(back_populates="attempts")


class WikibookCache(Base):
    """One fetched Wikibooks opening-theory page, keyed by our computed page
    title. html is NULL when Wikibooks has no page for the line ("out of
    book") — cached too, and rechecked after a week (see app/wikibook.py)."""

    __tablename__ = "wikibook_cache"

    path: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    html: Mapped[str | None] = mapped_column(Text, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    # app.wikibook.SANITIZER_VERSION at fetch time; older rows are refetched.
    sanitizer_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
