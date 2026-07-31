import re
import uuid
from collections.abc import Iterator

from fastapi import Depends, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.security import OAuth2PasswordRequestForm
from fastapi_users import BaseUserManager, UUIDIDMixin
from fastapi_users.exceptions import FastAPIUsersException, InvalidPasswordException
from sqlalchemy.exc import IntegrityError

from app.auth.config import auth_secret
from app.auth.db import SyncUserDatabase, get_user_db
from app.auth.models import USERNAME_PATTERN, User
from app.legacy_ownership import adopt_orphaned_rows

# No complexity rules. There is no password reset here — leechess holds no
# email address to send one to — so anything that nudges people toward a
# password they cannot remember costs them their account, which is a worse
# outcome than a simple long one.
MIN_PASSWORD_LENGTH = 8

_USERNAME_RE = re.compile(USERNAME_PATTERN)


class InvalidUsername(FastAPIUsersException):
    """Wrong shape — letters, digits, underscore, hyphen, 3-24 characters."""


class UsernameTaken(FastAPIUsersException):
    """Already in use, case-insensitively."""


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    # Declared by the base class. The reset and verification routers are not
    # mounted (both need a mail sender this app does not have), so nothing
    # reads these — they are set so an accidental future use fails on a
    # missing router rather than a missing attribute.
    reset_password_token_secret = auth_secret()
    verification_token_secret = auth_secret()

    async def validate_password(self, password: str, user=None) -> None:
        if len(password) < MIN_PASSWORD_LENGTH:
            raise InvalidPasswordException(
                f"password must be at least {MIN_PASSWORD_LENGTH} characters"
            )

    async def validate_username(
        self, username: object, *, current_user: User | None = None
    ) -> None:
        """Shape first, then availability. Both are re-checked by the database
        at write time — the unique index on username_canonical is what actually
        holds when two signups race — so this exists to give a useful error,
        not to be the guarantee.

        Takes `object` rather than `str` because it genuinely receives one:
        PATCH /users/me goes through create_update_dict, which keeps a field
        the caller set explicitly to null, so `{"username": null}` arrives here
        as None. That used to reach the regex and 500.
        """
        if not isinstance(username, str) or not _USERNAME_RE.fullmatch(username):
            raise InvalidUsername(username)
        existing = await self.user_db.get_by_username(username)
        if existing is not None and (
            current_user is None or existing.id != current_user.id
        ):
            raise UsernameTaken(username)

    async def create_user(
        self,
        username: str,
        password: str,
        *,
        request: Request | None = None,
    ) -> User:
        """The one way accounts come into existence.

        BaseUserManager.create is bypassed rather than extended: it looks the
        new user up by email before writing, which cannot work when every email
        is NULL. Everything it does that matters here — validation, hashing,
        the post-register hook — is done explicitly below.
        """
        await self.validate_username(username)
        await self.validate_password(password)

        user = await self._insert(username, self.password_helper.hash(password))

        # Data written before accounts existed has no owner. If this is the
        # only account, it is unambiguously theirs — see app/legacy_ownership.
        # Doing it here as well as at boot is what makes the realistic order
        # work: deploy first, sign up second.
        await run_in_threadpool(adopt_orphaned_rows, self.user_db.session)

        await self.on_after_register(user, request)
        return user

    async def _insert(self, username: str, hashed_password: str) -> User:
        """Write the row. The name was checked above, but that check is
        advisory — the unique index is what actually decides who holds a name,
        and losing that race is the same answer as losing the check."""
        try:
            return await self.user_db.create(
                {
                    "username": username,
                    "hashed_password": hashed_password,
                    "email": None,
                    "is_active": True,
                    # Nothing to verify without an email address; leaving this
                    # False would make every account look half-finished to
                    # fastapi-users' verified-user dependencies.
                    "is_verified": True,
                }
            )
        except IntegrityError as exc:
            # Lost the race against a concurrent signup on the same name.
            raise UsernameTaken(username) from exc

    async def authenticate_username(self, username: str, password: str) -> User | None:
        """Resolve a login by username instead of email.

        Mirrors BaseUserManager.authenticate, including the two behaviours that
        are easy to lose: hashing anyway when there is nothing to compare
        against, so response time does not reveal which usernames exist; and
        rewriting the stored hash when the hasher's parameters have moved on.
        """
        user = await self.user_db.get_by_username(username)
        # Accounts left over from when guests were rows in this table have no
        # password to verify against — same answer as an unknown name, and
        # same cost.
        if user is None or user.hashed_password is None:
            self.password_helper.hash(password)
            return None

        verified, updated_hash = self.password_helper.verify_and_update(
            password, user.hashed_password
        )
        if not verified:
            return None
        if updated_hash is not None:
            await self.user_db.update(user, {"hashed_password": updated_hash})
        return user

    async def authenticate(self, credentials: OAuth2PasswordRequestForm) -> User | None:
        """Kept signature-compatible with the base class so any fastapi-users
        code path still works; OAuth2PasswordRequestForm's field really is
        called `username`. leechess' own login route calls the method above
        directly, with a JSON body."""
        return await self.authenticate_username(
            credentials.username, credentials.password
        )

    async def _update(self, user: User, update_dict: dict) -> User:
        """Reached through the library's PATCH /users/me. Validating here
        rather than in a route means a rename is checked the same way whoever
        performs it, and that the name an account is renamed to is held to the
        same rules as the name it was created with."""
        if "username" in update_dict:
            await self.validate_username(update_dict["username"], current_user=user)
        try:
            return await super()._update(user, update_dict)
        except IntegrityError as exc:
            raise UsernameTaken(update_dict.get("username")) from exc


def get_user_manager(
    user_db: SyncUserDatabase = Depends(get_user_db),
) -> Iterator[UserManager]:
    yield UserManager(user_db)
