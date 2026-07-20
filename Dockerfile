# ---- client build ----
FROM oven/bun:1 AS client
# Mirror the repo layout (client/ + shared/ as siblings) so the client's
# relative import of shared/classification.json resolves like it does locally.
WORKDIR /build/client
COPY client/package.json client/bun.lock ./
RUN bun install --frozen-lockfile
COPY client/ ./
COPY shared/ /build/shared/
# empty VITE_API_URL = same-origin requests; FastAPI serves the SPA below
ENV VITE_API_URL=""
RUN bun scripts/copy-stockfish.js && bunx vite build

# ---- server ----
FROM python:3.14-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/
RUN apt-get update \
    && apt-get install -y --no-install-recommends stockfish \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen --no-dev
COPY server/app ./app
COPY shared ./shared
COPY --from=client /build/client/build ./static

# /usr/games: where Debian's stockfish package installs the binary
ENV PATH="/app/.venv/bin:/usr/games:$PATH" \
    LEECHESS_STATIC_DIR=/app/static \
    LEECHESS_DB_URL="sqlite:////data/leechess.db"

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
