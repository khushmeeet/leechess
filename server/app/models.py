from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Game(Base):
    __tablename__ = "games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pgn: Mapped[str] = mapped_column(Text)
    white: Mapped[str] = mapped_column(String, default="?")
    black: Mapped[str] = mapped_column(String, default="?")
    result: Mapped[str] = mapped_column(String, default="*")
    mode: Mapped[str] = mapped_column(String, default="local")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
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
