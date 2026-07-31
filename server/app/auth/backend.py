import uuid

from fastapi import Response
from fastapi_users import FastAPIUsers
from fastapi_users.authentication import (
    AuthenticationBackend,
    CookieTransport,
    JWTStrategy,
)

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


def get_jwt_strategy() -> JWTStrategy[User, uuid.UUID]:
    return JWTStrategy(secret=auth_secret(), lifetime_seconds=SESSION_LIFETIME_SECONDS)


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
