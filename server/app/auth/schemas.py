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


class UserUpdate(schemas.BaseUserUpdate):
    # No pattern: the shape is checked in app/auth/manager.py::_update, so a
    # rename onto a badly shaped name answers USERNAME_INVALID like every
    # other route rather than a 422 the SPA has to translate separately.
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
