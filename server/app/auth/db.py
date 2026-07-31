import uuid
from collections.abc import Iterator
from typing import Any

from fastapi import Depends
from fastapi.concurrency import run_in_threadpool
from fastapi_users.db import BaseUserDatabase
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.models import User, canonical
from app.db import get_db


class SyncUserDatabase(BaseUserDatabase[User, uuid.UUID]):
    """fastapi-users' bundled SQLAlchemy adapter requires an AsyncSession, and
    this backend is sync end to end (app/db.py, every router). Rather than
    convert the data layer or run a second async engine against the same SQLite
    file, this implements the same protocol on top of the request's ordinary
    get_db Session, doing the blocking work off the event loop.

    The payoff is test isolation: tests/conftest.py redirects the database by
    overriding get_db, and /testing/reset truncates through the same session,
    so auth inherits both with no new plumbing. A second engine would read
    LEECHESS_DB_URL once at import and quietly write auth rows to a different
    file than game rows.

    Only the methods leechess uses are implemented. The OAuth ones stay at the
    base class's NotImplementedError; there is no OAuth provider here.
    """

    def __init__(self, session: Session):
        self.session = session

    async def get(self, id: uuid.UUID) -> User | None:
        return await run_in_threadpool(self.session.get, User, id)

    async def get_by_email(self, email: str) -> User | None:
        statement = select(User).where(User.email == email)
        return await run_in_threadpool(
            lambda: self.session.scalars(statement).one_or_none()
        )

    async def get_by_username(self, username: str) -> User | None:
        """The lookup that actually matters here — usernames are the login
        identifier, so this is what UserManager.authenticate resolves through.
        Matching on the canonical column makes it case-insensitive using the
        same unique index that enforces it."""
        statement = select(User).where(User.username_canonical == canonical(username))
        return await run_in_threadpool(
            lambda: self.session.scalars(statement).one_or_none()
        )

    async def create(self, create_dict: dict[str, Any]) -> User:
        def _create() -> User:
            user = User(**create_dict)
            self.session.add(user)
            self._commit()
            self.session.refresh(user)
            return user

        return await run_in_threadpool(_create)

    async def update(self, user: User, update_dict: dict[str, Any]) -> User:
        def _update() -> User:
            for key, value in update_dict.items():
                setattr(user, key, value)
            self.session.add(user)
            self._commit()
            self.session.refresh(user)
            return user

        return await run_in_threadpool(_update)

    async def delete(self, user: User) -> None:
        def _delete() -> None:
            self.session.delete(user)
            self._commit()

        await run_in_threadpool(_delete)

    def _commit(self) -> None:
        """Roll back before letting an IntegrityError out. A sync Session left
        mid-failed-flush poisons every later query in the same request, and the
        username_canonical unique index makes that reachable whenever two
        signups race on the same name."""
        try:
            self.session.commit()
        except IntegrityError:
            self.session.rollback()
            raise


def get_user_db(db: Session = Depends(get_db)) -> Iterator[SyncUserDatabase]:
    yield SyncUserDatabase(db)
