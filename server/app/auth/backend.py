import uuid
from datetime import datetime, timezone

import jwt
from fastapi import Response
from fastapi_users import FastAPIUsers
from fastapi_users.authentication import (
    AuthenticationBackend,
    CookieTransport,
    JWTStrategy,
)
from fastapi_users.jwt import generate_jwt
from fastapi_users.manager import BaseUserManager

from app.auth.config import (
    COOKIE_NAME,
    COOKIE_SAMESITE,
    SESSION_LIFETIME_SECONDS,
    auth_secret,
    cookie_secure,
    refuse_default_secret_in_a_deploy,
)
from app.auth.manager import get_user_manager
from app.auth.models import User

refuse_default_secret_in_a_deploy()

# Used only for *reading* the cookie off an incoming request. Login and logout
# responses are built by hand in app/auth/router.py so they can carry the user
# body alongside the Set-Cookie, which the transport's own 204 cannot.
cookie_transport = CookieTransport(
    cookie_name=COOKIE_NAME,
    cookie_max_age=SESSION_LIFETIME_SECONDS,
    cookie_secure=cookie_secure(),
    cookie_httponly=True,
    cookie_samesite=COOKIE_SAMESITE,
)


class SessionEpochJWTStrategy(JWTStrategy[User, uuid.UUID]):
    """A JWT that can be revoked after all, by one blunt rule.

    The library's strategy says so itself: "A JWT can't be invalidated: it's
    valid until it expires." With a thirty-day session that means a password
    changed today does nothing about a cookie copied yesterday — which is the
    one thing changing a password is for, and worse here than most places
    because leechess has no reset, so an account taken this way is gone.

    So every token carries when it was issued, and every user carries the
    moment their older tokens stopped counting. One comparison, no session
    table, and the stateless-JWT arrangement is otherwise untouched.
    """

    async def write_token(self, user: User) -> str:
        data = {
            "sub": str(user.id),
            "aud": self.token_audience,
            # A float, deliberately. Rounded to whole seconds this comparison
            # has a one-second hole in it at best and rejects a token minted in
            # the same second as the account at worst — which is every
            # registration, since the row is written a few hundred microseconds
            # before the token is signed.
            "iat": _now_in_seconds(),
        }
        return generate_jwt(
            data, self.encode_key, self.lifetime_seconds, algorithm=self.algorithm
        )

    async def read_token(
        self, token: str | None, user_manager: BaseUserManager[User, uuid.UUID]
    ) -> User | None:
        user = await super().read_token(token, user_manager)
        if user is None:
            return None
        cutoff = _cutoff_in_seconds(user)
        if cutoff is None:
            return user  # no cutoff has ever been set for this account
        # Re-decoded rather than threaded out of the base class: it has already
        # verified the signature, the audience and the expiry, so this cannot
        # be tricked into trusting a claim the base class would have rejected.
        # A token carrying no `iat` at all was minted before this existed, and
        # counts as older than any cutoff.
        issued = _issued_at(token, self)
        if issued is None or issued < cutoff:
            return None
        return user


def _now_in_seconds() -> float:
    return datetime.now(timezone.utc).timestamp()


def _cutoff_in_seconds(user: User) -> float | None:
    """The user's session cutoff, or None when the account has never had one.

    Full precision on both sides of the comparison, so "issued before the
    cutoff" means exactly that and there is no window either way — see the note
    on the `iat` claim above.
    """
    stamp = user.sessions_valid_from
    if stamp is None:
        return None  # a row from before this column existed
    if stamp.tzinfo is None:  # SQLite hands back naive datetimes
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp.timestamp()


def _issued_at(token: str, strategy: JWTStrategy) -> float | None:
    try:
        data = jwt.decode(
            token,
            strategy.decode_key,
            audience=strategy.token_audience,
            algorithms=[strategy.algorithm],
        )
    except jwt.PyJWTError:  # pragma: no cover - the base class already refused
        return None
    issued = data.get("iat")
    return float(issued) if isinstance(issued, (int, float)) else None


def get_jwt_strategy() -> SessionEpochJWTStrategy:
    return SessionEpochJWTStrategy(
        secret=auth_secret(), lifetime_seconds=SESSION_LIFETIME_SECONDS
    )


auth_backend = AuthenticationBackend(
    name="cookie", transport=cookie_transport, get_strategy=get_jwt_strategy
)

fastapi_users = FastAPIUsers[User, uuid.UUID](get_user_manager, [auth_backend])

current_active_user = fastapi_users.current_user(active=True)
# For GET /auth/session, which answers "signed out" with a 200 rather than the
# 401 GET /users/me would give — the SPA calls it on every boot, and an
# expected state should not look like an error.
current_active_user_optional = fastapi_users.current_user(active=True, optional=True)


def attach_session_cookie(response: Response, token: str) -> None:
    """httpOnly, so the credential is out of reach of any script on the page —
    Review renders sanitized Wikibooks HTML, which is this app's one real
    injection surface."""
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_LIFETIME_SECONDS,
        path="/",
        secure=cookie_secure(),
        httponly=True,
        samesite=COOKIE_SAMESITE,
    )


def clear_session_cookie(response: Response) -> None:
    response.set_cookie(
        COOKIE_NAME,
        "",
        max_age=0,
        path="/",
        secure=cookie_secure(),
        httponly=True,
        samesite=COOKIE_SAMESITE,
    )
