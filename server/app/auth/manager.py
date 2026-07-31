import re
import secrets
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
from app.auth.models import USERNAME_PATTERN, User, numbered, sanitize_guest_username
from app.legacy_ownership import adopt_orphaned_rows

# No complexity rules. There is no password reset here — leechess holds no
# email address to send one to — so anything that nudges people toward a
# password they cannot remember costs them their account, which is a worse
# outcome than a simple long one.
MIN_PASSWORD_LENGTH = 8

_USERNAME_RE = re.compile(USERNAME_PATTERN)

# How far a guest's name is numbered upwards before giving up on a readable
# variant: `drifter`, `drifter-2`, … `drifter-20`. Twenty lookups is already
# more than this ever costs in practice, and past that a random number is
# both cheaper and likelier to land.
_NUMBERED_LIMIT = 20

# Attempts at the insert itself. Only a guest gets more than one: the unique
# index is what actually decides who holds a name, so losing that race is
# answered by picking another name rather than by a 409 they cannot act on.
_GUEST_INSERT_ATTEMPTS = 5


class InvalidUsername(FastAPIUsersException):
    """Wrong shape — letters, digits, underscore, hyphen, 3-24 characters."""


class UsernameTaken(FastAPIUsersException):
    """Already in use, case-insensitively."""


class NotAGuest(FastAPIUsersException):
    """Tried to upgrade an account that already has a password."""


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

    async def _free_guest_name(
        self, wanted: str, *, current_user: User | None = None
    ) -> str:
        """`wanted`, or the first numbered variant of it nobody holds.

        The guest counterpart to validate_username's availability half: a
        guest is never told their name is taken, they are quietly moved along
        to `drifter-2`, which the nav bar shows them straight away. Advisory
        only, like the check it replaces — two guests can still race onto the
        same name, which is why _insert retries around the unique index.
        """

        async def free(name: str) -> bool:
            holder = await self.user_db.get_by_username(name)
            if holder is None:
                return True
            # A guest renaming themselves to the name they already have.
            return current_user is not None and holder.id == current_user.id

        if await free(wanted):
            return wanted
        for n in range(2, _NUMBERED_LIMIT + 1):
            candidate = numbered(wanted, n)
            if await free(candidate):
                return candidate
        # Twenty variants deep is not a name anyone chose on purpose. Stop
        # scanning; _insert's retry covers the chance this one is taken too.
        return numbered(wanted, secrets.randbelow(9000) + 1000)

    async def create_user(
        self,
        username: str,
        password: str | None = None,
        *,
        is_guest: bool = False,
        request: Request | None = None,
    ) -> User:
        """The one way accounts come into existence, for guests and registered
        users alike.

        BaseUserManager.create is bypassed rather than extended: it looks the
        new user up by email before writing, which cannot work when every email
        is NULL. Everything it does that matters here — validation, hashing,
        the post-register hook — is done explicitly below.

        The one asymmetry is the name. A registered username is a credential
        and is validated; a guest's is a label, so it is sanitized and, if
        somebody already holds it, numbered — see sanitize_guest_username.
        """
        if is_guest:
            username = sanitize_guest_username(username)
        else:
            await self.validate_username(username)

        hashed_password = None
        if password is not None:
            await self.validate_password(password)
            hashed_password = self.password_helper.hash(password)

        user = await self._insert(username, hashed_password, is_guest=is_guest)

        # Data written before accounts existed has no owner. If this is the
        # only account, it is unambiguously theirs — see app/legacy_ownership.
        # Doing it here as well as at boot is what makes the realistic order
        # work: deploy first, sign up second.
        await run_in_threadpool(adopt_orphaned_rows, self.user_db.session)

        await self.on_after_register(user, request)
        return user

    async def _insert(
        self, username: str, hashed_password: str | None, *, is_guest: bool
    ) -> User:
        """Write the row. Once for a registered user, whose name was already
        checked and who can be told it went; up to _GUEST_INSERT_ATTEMPTS
        times for a guest, who is renumbered around whoever won the race."""
        lost: IntegrityError | None = None
        for _ in range(_GUEST_INSERT_ATTEMPTS if is_guest else 1):
            name = await self._free_guest_name(username) if is_guest else username
            try:
                return await self.user_db.create(
                    {
                        "username": name,
                        "hashed_password": hashed_password,
                        "email": None,
                        "is_active": True,
                        # Nothing to verify without an email address; leaving
                        # this False would make every account look
                        # half-finished to fastapi-users' verified-user
                        # dependencies.
                        "is_verified": True,
                        "is_guest": is_guest,
                    }
                )
            except IntegrityError as exc:
                # Lost the race against a concurrent signup on the same name.
                lost = exc
        raise UsernameTaken(username) from lost

    async def set_password(
        self, user: User, password: str, request: Request | None = None
    ) -> User:
        """Guest -> registered, in place. The row keeps its id, so every game,
        attempt and puzzle it already owns stays owned by it: there is nothing
        to migrate at the moment somebody decides to sign up."""
        if not user.is_guest:
            raise NotAGuest()
        await self.validate_password(password, user)
        return await self.user_db.update(
            user,
            {
                "hashed_password": self.password_helper.hash(password),
                "is_guest": False,
            },
        )

    async def authenticate_username(self, username: str, password: str) -> User | None:
        """Resolve a login by username instead of email.

        Mirrors BaseUserManager.authenticate, including the two behaviours that
        are easy to lose: hashing anyway when there is nothing to compare
        against, so response time does not reveal which usernames exist; and
        rewriting the stored hash when the hasher's parameters have moved on.
        """
        user = await self.user_db.get_by_username(username)
        # A guest has an account but no password, so there is nothing to verify
        # against — same answer as an unknown name, and same cost.
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
        performs it — and that a guest renaming themselves is held to the same
        rules as a guest choosing a name in the first place, which is to say
        none. The schema deliberately carries no pattern for that reason."""
        if "username" in update_dict:
            if user.is_guest:
                update_dict["username"] = await self._free_guest_name(
                    sanitize_guest_username(update_dict["username"]),
                    current_user=user,
                )
            else:
                await self.validate_username(update_dict["username"], current_user=user)
        try:
            return await super()._update(user, update_dict)
        except IntegrityError as exc:
            raise UsernameTaken(update_dict.get("username")) from exc


def get_user_manager(
    user_db: SyncUserDatabase = Depends(get_user_db),
) -> Iterator[UserManager]:
    yield UserManager(user_db)
