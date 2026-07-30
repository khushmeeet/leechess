from datetime import datetime

from fastapi_users_db_sqlalchemy import SQLAlchemyBaseUserTableUUID
from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, validates

from app.db import Base
from app.models import utcnow

# Login identifiers, so the shape is deliberately narrow: no case games, no
# lookalike whitespace, nothing that reads differently in a URL than in a nav
# bar. Enforced in app/auth/manager.py, which owns the 400 vs 409 split.
USERNAME_PATTERN = r"^[A-Za-z0-9_-]{3,24}$"
USERNAME_MAX_LENGTH = 24


def canonical(username: str) -> str:
    """The comparison form of a username. Usernames are ASCII by construction
    (USERNAME_PATTERN), so plain lower() is total here — casefold() would only
    matter for characters the pattern already rejects."""
    return username.lower()


class User(SQLAlchemyBaseUserTableUUID, Base):
    __tablename__ = "users"

    # fastapi-users treats email as the login identifier and requires it.
    # leechess signs in by username and has no way to send mail, so nothing
    # ever populates this; redeclared nullable so the column can stay empty.
    # SQLite allows any number of NULLs under a unique index, so the mixin's
    # uniqueness costs nothing.
    email: Mapped[str | None] = mapped_column(
        String(length=320), unique=True, index=True, nullable=True
    )
    # NULL for guests, who have an account but have not chosen a password yet.
    # Redeclared for the same reason as email: the mixin makes it NOT NULL.
    # app/auth/manager.py treats NULL as "cannot log in with a password".
    hashed_password: Mapped[str | None] = mapped_column(
        String(length=1024), nullable=True
    )

    # As the user typed it — this is what the nav bar and PGN headers show.
    username: Mapped[str] = mapped_column(String(USERNAME_MAX_LENGTH))
    # Lowercased. Since the username *is* the login identifier, uniqueness has
    # to be case-insensitive and enforced by the database rather than by a
    # check that a concurrent signup can slip past. Every lookup goes through
    # this column; the validator below keeps it from drifting.
    username_canonical: Mapped[str] = mapped_column(
        String(USERNAME_MAX_LENGTH), unique=True, index=True
    )

    # A guest is a real account with no password: it owns rows and survives a
    # reload like any other. Setting a password later upgrades this same row in
    # place, so nothing has to be migrated when someone decides to sign up.
    is_guest: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    @validates("username")
    def _keep_canonical_in_sync(self, _key: str, value: str) -> str:
        """Derive username_canonical on every assignment, including direct
        User(...) construction in tests — the two must never disagree, and a
        caller that has to remember to set both eventually forgets."""
        self.username_canonical = canonical(value)
        return value

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        kind = "guest" if self.is_guest else "user"
        return f"<User {self.username!r} ({kind}) {self.id}>"


__all__ = ["USERNAME_MAX_LENGTH", "USERNAME_PATTERN", "User", "canonical"]
