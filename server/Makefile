.PHONY: dev test test-fast

# The session cookie is Secure by default, which a browser will not send back
# over plain-http localhost — every request would look signed out.
dev:
	LEECHESS_AUTH_COOKIE_SECURE=off uv run uvicorn app.main:app --reload --port 8000

test:
	uv run pytest

test-fast:
	uv run pytest -m "not engine"
