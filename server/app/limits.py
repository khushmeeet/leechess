"""A ceiling on how much request body the server will read.

Nothing here accepts an upload. The largest honest body is an imported PGN,
and everything else is a few hundred bytes of JSON — but neither uvicorn nor
FastAPI puts a limit on it by default, so an anonymous `POST /live` carrying
eight megabytes of display name was buffered in full and validated before the
field was truncated to twenty-four characters. On a 512mb machine, memory a
stranger controls is the whole problem.

An ASGI middleware rather than a dependency, because a dependency runs after
the body has already been read into memory, which is precisely too late.
"""

import os

MAX_BODY_BYTES = int(os.environ.get("LEECHESS_MAX_BODY_BYTES", str(512 * 1024)))


class BodySizeLimit:
    """Refuse an over-long body before it is buffered.

    Two paths, because there are two ways a body arrives. A declared
    Content-Length is answered immediately and never read at all — which is
    every request a browser or an HTTP client actually sends here. A chunked
    body has nothing to check up front, so it is counted as it streams and the
    connection is cut once it runs over, which bounds the memory even though it
    cannot produce as tidy an answer.
    """

    def __init__(self, app, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        declared = _content_length(scope)
        if declared is not None and declared > self.max_bytes:
            return await _refuse(send)

        received = 0
        over = False

        async def counted_receive():
            nonlocal received, over
            message = await receive()
            if message.get("type") == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    # No response to send from in here — the app owns `send` by
                    # now. Reporting a disconnect stops it reading, which is
                    # what keeps the body out of memory; the request then fails
                    # as a truncated one, which is what it is.
                    over = True
                    return {"type": "http.disconnect"}
            return message

        await self.app(scope, counted_receive, send)


def _content_length(scope) -> int | None:
    for name, value in scope.get("headers", ()):
        if name == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None
    return None


async def _refuse(send) -> None:
    body = b'{"detail":"REQUEST_TOO_LARGE"}'
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
