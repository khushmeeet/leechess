.PHONY: dev test test-fast

dev:
	uv run uvicorn app.main:app --reload --port 8000

test:
	uv run pytest

test-fast:
	uv run pytest -m "not engine"
