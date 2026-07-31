import uuid

from fastapi_users import schemas
from pydantic import BaseModel, Field

from app.auth.models import USERNAME_PATTERN


class UserRead(schemas.BaseUser[uuid.UUID]):
    # Always null here — see models.User.email. Kept on the schema only
    # because fastapi-users' BaseUser declares it as a required EmailStr and
    # get_users_router validates responses against this model.
    email: str | None = None
    username: str
    is_guest: bool


class UserUpdate(schemas.BaseUserUpdate):
    # No pattern: this is the one rename route, and a guest's name is not held
    # to the registered shape (app/auth/manager.py::UserManager._update, which
    # is where the two paths part). A registered user with a badly shaped name
    # gets USERNAME_INVALID from there instead of a 422 from here.
    username: str | None = None
    # This app has no mail sender and no email column worth setting, so the
    # only accepted value is null. Sending an address is a 422 rather than a
    # silently ignored field.
    email: None = None


class UserCreate(BaseModel):
    """Registration input. Not fastapi-users' BaseUserCreate, which requires an
    email — see app/auth/manager.py::UserManager.create_user for why the
    library's create() path is bypassed entirely."""

    username: str = Field(pattern=USERNAME_PATTERN)
    password: str


class GuestCreate(BaseModel):
    """Body of /auth/guest. Unconstrained on purpose: a guest's name is a
    label, not a login identifier, so whatever they typed is cleaned and kept
    rather than checked and refused — see
    app/auth/models.py::sanitize_guest_username."""

    username: str


class AccountUpgrade(BaseModel):
    """Body of /auth/upgrade — what a guest picks to keep their progress
    reachable from another browser.

    The username is here because a guest's was never checked for anything:
    this is where it turns into a login identifier, so this is where it has to
    be shaped like one and has to be free. No pattern on it for that reason —
    the manager answers with USERNAME_INVALID or USERNAME_TAKEN, which the
    client has wording for and a 422 would bypass.
    """

    username: str
    password: str


class PasswordVerify(BaseModel):
    """Body of /auth/login. Deliberately unconstrained: rejecting a badly
    shaped username with a 422 before checking it would tell a caller which
    names could exist."""

    username: str
    password: str


class SessionOut(BaseModel):
    """Answer to "who am I?", called once on SPA boot. Always 200, including
    when signed out: GET /users/me answers that question with a 401, which
    would make an expected state look like an error on every page load."""

    authenticated: bool
    user: UserRead | None = None
