import os

COOKIE_NAME = "leechess_auth"
# Long-lived on purpose: the alternative to a remembered session is a password
# prompt, and there is no reset if that password has been forgotten.
SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 30
# Lax rather than Strict so following a link into leechess from elsewhere does
# not land on the welcome screen. Nothing here is cross-site, so this is also
# what keeps state-changing requests from being forgeable from another origin.
COOKIE_SAMESITE = "lax"

DEV_SECRET = "leechess-dev-secret-not-for-deployment"


def auth_secret() -> str:
    return os.environ.get("LEECHESS_AUTH_SECRET", DEV_SECRET)


def cookie_secure() -> bool:
    """Read per call rather than at import, so `make dev` and the browser suite
    can turn it off for plain-http localhost without the variable having to be
    set before this module is first imported."""
    return os.environ.get("LEECHESS_AUTH_COOKIE_SECURE", "on").lower() != "off"


def refuse_default_secret_in_a_deploy() -> None:
    """LEECHESS_STATIC_DIR is set only by the Dockerfile, so its presence is
    the one reliable "this is the deployed image" signal available here. A
    published default secret would let anyone mint a session cookie for any
    account, which is worth failing the boot over rather than warning about.
    """
    if os.environ.get("LEECHESS_STATIC_DIR") and auth_secret() == DEV_SECRET:
        raise RuntimeError(
            "LEECHESS_AUTH_SECRET is unset — set it (fly secrets set "
            "LEECHESS_AUTH_SECRET=...) before serving the built SPA"
        )
