import re
import uuid
from collections.abc import Iterator

from fastapi import Depends, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.security import OAuth2PasswordRequestForm
from fastapi_users import BaseUserManager, UUIDIDMixin
from fastapi_users.exceptions import FastAPIUsersException, InvalidPasswordException
from sqlalchemy.exc import IntegrityError

from app.auth import hashing
from app.auth.config import auth_secret
from app.auth.db import SyncUserDatabase, get_user_db
from app.auth.models import USERNAME_PATTERN, User
from app.legacy_ownership import adopt_orphaned_rows
from app.models import utcnow

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


class CurrentPasswordWrong(FastAPIUsersException):
    """A password change arrived without the password being replaced.

    Its own exception rather than a reuse of the login error: this is not a
    failed sign-in, it must not feed the sign-in limiter, and the SPA wants to
    say something different about it.
    """


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

        hashed = await hashing.hash_password(self.password_helper, password)
        user = await self._insert(username, hashed)

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
            await hashing.hash_password(self.password_helper, password)
            return None

        verified, updated_hash = await hashing.verify_and_update(
            self.password_helper, password, user.hashed_password
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
        # Both are always removed, whether or not they carry anything, so
        # neither can reach setattr() and become a column that does not exist.
        current_password = update_dict.pop("current_password", None)
        password = update_dict.pop("password", None)

        if "username" in update_dict:
            await self.validate_username(update_dict["username"], current_user=user)
        if password is not None:
            await self._authorize_password_change(user, current_password)
            await self.validate_password(password, user)
            # Hashed here rather than in the base class's _update, which does it
            # inline on the event loop and outside the concurrency ceiling that
            # keeps argon2's 64mb-a-time from being an out-of-memory.
            update_dict["hashed_password"] = await hashing.hash_password(
                self.password_helper, password
            )
            # Every session minted before now is finished, including the one
            # making this request. That is the point: a password is changed
            # because the old one is no longer trusted, and leaving a thirty-day
            # cookie alive would leave whoever prompted the change signed in.
            update_dict["sessions_valid_from"] = utcnow()

        try:
            return await super()._update(user, update_dict)
        except IntegrityError as exc:
            raise UsernameTaken(update_dict.get("username")) from exc

    async def _authorize_password_change(
        self, user: User, current_password: str | None
    ) -> None:
        """Proof that whoever is asking knows the password they are replacing.

        Without this, PATCH /users/me was a complete account takeover for
        anyone holding the session cookie for a moment — and because leechess
        has no password reset, a takeover is permanent: the owner has no way
        back in. A borrowed laptop was enough.
        """
        if not current_password:
            raise CurrentPasswordWrong()
        if user.hashed_password is None:
            # A passwordless leftover from the old guest rows. There is nothing
            # to prove knowledge of, so there is no safe way to let this
            # through — those accounts cannot sign in either.
            raise CurrentPasswordWrong()
        verified, _ = await hashing.verify_and_update(
            self.password_helper, current_password, user.hashed_password
        )
        if not verified:
            raise CurrentPasswordWrong()


def get_user_manager(
    user_db: SyncUserDatabase = Depends(get_user_db),
) -> Iterator[UserManager]:
    yield UserManager(user_db)
