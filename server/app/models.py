from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Game(Base):
    __tablename__ = "games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pgn: Mapped[str] = mapped_column(Text)
    white: Mapped[str] = mapped_column(String, default="?")
    black: Mapped[str] = mapped_column(String, default="?")
    result: Mapped[str] = mapped_column(String, default="*")
    mode: Mapped[str] = mapped_column(String, default="local")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    analysis_status: Mapped[str] = mapped_column(String, default="pending")

    moves: Mapped[list["Move"]] = relationship(
        back_populates="game", cascade="all, delete-orphan", order_by="Move.ply"
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


class Puzzle(Base):
    """One drillable position. Personal puzzles point back at the game move
    they came from via source_move_id; generic Lichess imports have NULL
    there (spec §5). Leitner scheduling state (box, due_at) lives on the row
    — new puzzles start in box 1, due immediately."""

    __tablename__ = "puzzles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
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
    box: Mapped[int] = mapped_column(Integer, default=1)
    due_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    source_move: Mapped[Move | None] = relationship(back_populates="puzzles")
    attempts: Mapped[list["PuzzleAttempt"]] = relationship(
        back_populates="puzzle",
        cascade="all, delete-orphan",
        order_by="PuzzleAttempt.id",
    )


class PuzzleAttempt(Base):
    __tablename__ = "puzzle_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    puzzle_id: Mapped[int] = mapped_column(ForeignKey("puzzles.id"), index=True)
    correct: Mapped[bool] = mapped_column(Boolean)
    hint_level_used: Mapped[int] = mapped_column(Integer, default=0)
    attempted_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    puzzle: Mapped[Puzzle] = relationship(back_populates="attempts")
