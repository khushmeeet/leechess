from datetime import datetime

from fastapi_users_db_sqlalchemy import SQLAlchemyBaseUserTableUUID
from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, validates

from app.db import Base
from app.models import utcnow

# Login identifiers, so the shape is deliberately narrow: no case games, no
# lookalike whitespace, nothing that reads differently in a URL than in a nav
# bar. Enforced in app/auth/manager.py, which owns the 400 vs 409 split.
# Registered accounts only — a guest's name is not a credential, and is put
# through sanitize_guest_username() instead of this.
USERNAME_PATTERN = r"^[A-Za-z0-9_-]{3,24}$"
USERNAME_MAX_LENGTH = 24

# What a guest ends up called when nothing they typed survives sanitizing.
GUEST_FALLBACK_NAME = "guest"


def canonical(username: str) -> str:
    """The comparison form of a username. Registered names are ASCII by
    construction (USERNAME_PATTERN) and guest names are sanitized before they
    are stored, so plain lower() is what the unique index compares on."""
    return username.lower()


def sanitize_guest_username(raw: object) -> str:
    """A guest's typed-in name, made storable — and never refused.

    A guest cannot sign in with their name (there is no password to sign in
    with), so it is a label rather than an identifier: turning somebody away
    at the door over its shape, or over somebody else having taken it, costs
    them the game they came to play and buys nothing. So this cleans instead
    of validating — whitespace runs collapse to a single space, characters
    that would not render as themselves in the nav bar are dropped, and the
    result is cut to the column's width. A name that survives none of that
    becomes GUEST_FALLBACK_NAME rather than an error.

    Taking `object` for the same reason validate_username does: PATCH
    /users/me can deliver an explicit null here.

    Uniqueness is still the database's to enforce — see
    UserManager._free_guest_name, which numbers a collision rather than
    rejecting it.
    """
    text = raw if isinstance(raw, str) else ""
    # str.split() splits on every kind of whitespace, so this also flattens
    # the tabs and newlines that would otherwise reach a template.
    collapsed = " ".join(text.split())
    printable = "".join(char for char in collapsed if char.isprintable())
    return printable[:USERNAME_MAX_LENGTH].strip() or GUEST_FALLBACK_NAME


def numbered(username: str, n: int) -> str:
    """`drifter` -> `drifter-2`, still inside the column's width: a long name
    loses its tail rather than the number that makes it free."""
    suffix = f"-{n}"
    return username[: USERNAME_MAX_LENGTH - len(suffix)].rstrip() + suffix


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


__all__ = [
    "GUEST_FALLBACK_NAME",
    "USERNAME_MAX_LENGTH",
    "USERNAME_PATTERN",
    "User",
    "canonical",
    "numbered",
    "sanitize_guest_username",
]
