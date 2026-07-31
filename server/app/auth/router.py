from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from fastapi_users.authentication import Strategy
from fastapi_users.exceptions import InvalidPasswordException

from app.auth import throttle
from app.auth.backend import (
    attach_session_cookie,
    auth_backend,
    clear_session_cookie,
    current_active_user,
    current_active_user_optional,
)
from app.auth.manager import (
    InvalidUsername,
    NotAGuest,
    UsernameTaken,
    UserManager,
    get_user_manager,
)
from app.auth.models import User, canonical
from app.auth.schemas import (
    GuestCreate,
    PasswordSet,
    PasswordVerify,
    SessionOut,
    UserCreate,
    UserRead,
)

router = APIRouter(prefix="/auth", tags=["auth"])


async def _signed_in(user: User, strategy: Strategy) -> JSONResponse:
    """A session cookie plus the user body in one response, so the SPA does not
    have to follow every sign-in with a second call to find out who it is."""
    token = await strategy.write_token(user)
    response = JSONResponse(content=jsonable_encoder(UserRead.model_validate(user)))
    attach_session_cookie(response, token)
    return response


@router.post("/register", response_model=UserRead)
async def register(
    payload: UserCreate,
    request: Request,
    user_manager: UserManager = Depends(get_user_manager),
    strategy: Strategy = Depends(auth_backend.get_strategy),
):
    user = await user_manager.create_user(
        payload.username, payload.password, request=request
    )
    return await _signed_in(user, strategy)


@router.post("/guest", response_model=UserRead)
async def start_as_guest(
    payload: GuestCreate,
    request: Request,
    user_manager: UserManager = Depends(get_user_manager),
    strategy: Strategy = Depends(auth_backend.get_strategy),
):
    """A guest is a real account without a password. It owns rows and survives
    a reload like any other, so nothing about playing has to know the
    difference — and POST /auth/upgrade later turns this same row into a
    registered account without moving any data."""
    user = await user_manager.create_user(
        payload.username, None, is_guest=True, request=request
    )
    return await _signed_in(user, strategy)


@router.post("/login", response_model=UserRead)
async def login(
    payload: PasswordVerify,
    request: Request,
    user_manager: UserManager = Depends(get_user_manager),
    strategy: Strategy = Depends(auth_backend.get_strategy),
):
    key = canonical(payload.username)
    throttle.check(key)
    user = await user_manager.authenticate_username(payload.username, payload.password)
    if user is None or not user.is_active:
        throttle.record_failure(key)
        # One message for "no such user" and "wrong password" alike: telling
        # them apart is a username oracle and buys the caller nothing.
        raise HTTPException(status_code=400, detail="LOGIN_BAD_CREDENTIALS")
    throttle.clear(key)
    await user_manager.on_after_login(user, request)
    return await _signed_in(user, strategy)


@router.post("/upgrade", response_model=UserRead)
async def upgrade(
    payload: PasswordSet,
    request: Request,
    user: User = Depends(current_active_user),
    user_manager: UserManager = Depends(get_user_manager),
):
    """Guest chooses a password. The existing session cookie names this same
    user id and stays valid, so no new token is issued."""
    return await user_manager.set_password(user, payload.password, request=request)


@router.post("/logout", status_code=204)
async def logout(_: User = Depends(current_active_user)) -> Response:
    """Sessions are stateless JWTs, so signing out is dropping the cookie —
    there is no server-side record to destroy. Requiring a current user keeps
    this from being a way to clear a cookie you never had."""
    response = Response(status_code=204)
    clear_session_cookie(response)
    return response


@router.get("/session", response_model=SessionOut)
async def read_session(user: User | None = Depends(current_active_user_optional)):
    """Always 200. The SPA calls this on boot, and being signed out is an
    ordinary answer rather than an error — which is what GET /users/me would
    make it."""
    return SessionOut(
        authenticated=user is not None,
        user=UserRead.model_validate(user) if user is not None else None,
    )


def register_error_handlers(app: FastAPI) -> None:
    """The username rules live in the manager because PATCH /users/me reaches
    them through a fastapi-users router this app does not own, and that router
    only translates the library's own exceptions. Mapping them here keeps
    manager.py free of HTTP concerns while still producing the right status on
    every path that can raise them."""

    @app.exception_handler(InvalidPasswordException)
    async def _invalid_password(_request: Request, exc: InvalidPasswordException):
        # fastapi-users' own users router catches this one; the routes in this
        # module raise it from create_user and set_password, so it needs a
        # handler here too or a short password reads as a server error.
        return JSONResponse(
            status_code=400,
            content={"detail": "PASSWORD_INVALID", "reason": exc.reason},
        )

    @app.exception_handler(InvalidUsername)
    async def _invalid_username(_request: Request, _exc: InvalidUsername):
        return JSONResponse(status_code=400, content={"detail": "USERNAME_INVALID"})

    @app.exception_handler(UsernameTaken)
    async def _username_taken(_request: Request, _exc: UsernameTaken):
        return JSONResponse(status_code=409, content={"detail": "USERNAME_TAKEN"})

    @app.exception_handler(NotAGuest)
    async def _not_a_guest(_request: Request, _exc: NotAGuest):
        return JSONResponse(status_code=409, content={"detail": "ALREADY_REGISTERED"})

    @app.exception_handler(throttle.TooManyAttempts)
    async def _too_many(_request: Request, exc: throttle.TooManyAttempts):
        return JSONResponse(
            status_code=429,
            content={"detail": "TOO_MANY_ATTEMPTS"},
            headers={"Retry-After": str(exc.retry_after)},
        )
