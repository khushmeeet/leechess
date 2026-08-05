"""The limits that apply to every request rather than to one route.

The response headers, the ceiling on how much body will be read, and the
removal of the one endpoint that let an anonymous caller spawn a chess engine.
"""

import pytest

from app.limits import MAX_BODY_BYTES
from app.main import CONTENT_SECURITY_POLICY

pytestmark = pytest.mark.unit


def test_the_security_headers_are_on_every_response(anon_client):
    response = anon_client.get("/healthz")

    assert response.headers["Content-Security-Policy"] == CONTENT_SECURITY_POLICY
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["X-Frame-Options"] == "DENY"
    # Still the ones stockfish.wasm needs — the whole point of the middleware
    # before anything else was added to it.
    assert response.headers["Cross-Origin-Opener-Policy"] == "same-origin"
    assert response.headers["Cross-Origin-Embedder-Policy"] == "require-corp"


def test_the_policy_refuses_framing_and_foreign_connections(anon_client):
    """The two directives doing real work despite `script-src` having to allow
    inline: nothing may frame this app, and script that does get in has nowhere
    to send what it finds."""
    assert "frame-ancestors 'none'" in CONTENT_SECURITY_POLICY
    assert "connect-src 'self'" in CONTENT_SECURITY_POLICY
    assert "base-uri 'none'" in CONTENT_SECURITY_POLICY


def test_hsts_follows_the_cookie_switch(anon_client, monkeypatch):
    """conftest turns the Secure cookie off for plain-http localhost, and a
    localhost dev server must not be told to pin itself to https for two
    years."""
    assert "Strict-Transport-Security" not in anon_client.get("/healthz").headers

    monkeypatch.setenv("LEECHESS_AUTH_COOKIE_SECURE", "on")
    assert "Strict-Transport-Security" in anon_client.get("/healthz").headers


def test_an_over_long_body_is_refused_before_it_is_read(anon_client):
    """An anonymous POST /live carrying eight megabytes of display name used to
    be buffered in full and validated before the field was cut to 24
    characters. Memory a stranger controls is the whole problem on a 512mb
    machine."""
    response = anon_client.post(
        "/live", json={"color": "white", "name": "A" * (MAX_BODY_BYTES + 1024)}
    )

    assert response.status_code == 413
    assert response.json()["detail"] == "REQUEST_TOO_LARGE"


def test_an_ordinary_body_is_untouched(anon_client):
    assert anon_client.post("/live", json={"color": "white"}).status_code == 201


def test_the_debug_engine_endpoint_is_gone(anon_client):
    """No account, a caller-chosen FEN and search depth, a native engine
    process per call, and none of the concurrency ceiling app/analysis.py puts
    around exactly that work."""
    assert anon_client.get("/debug/engine").status_code == 404
