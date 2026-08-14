"""What a friend game does about the people it lets in.

Everything here is reachable with nothing but a link: no account, no seat, no
prior relationship. That is the feature, so these are the limits that make it
survivable — and the injection the untrusted half of a friend game could
otherwise write into the other half's saved history.
"""

import threading

import chess.pgn
import pytest
from fastapi.testclient import TestClient

from app import live as livemod
from app.main import app
from app.pgn import header_value
from app.routers import live as live_router

pytestmark = pytest.mark.unit


def _open_game(client, **body):
    response = client.post("/live", json={"color": "white", **body})
    assert response.status_code == 201, response.text
    return response.json()


# --- names that end up inside a PGN ----------------------------------------


def test_a_join_name_cannot_carry_pgn_structure(anon_client):
    """python-chess writes header values through unescaped, so `x"]` and a
    newline used to close the tag and open another. The name belongs to the
    anonymous half of a friend game and the PGN belongs to the signed-in
    half — one player editing the other's records."""
    created = _open_game(anon_client)

    refused = anon_client.post(
        f"/live/{created['token']}/join", json={"name": 'x"]\n[Result "1-0'}
    )

    assert refused.status_code == 422


@pytest.mark.parametrize(
    "name",
    ['quote"inside', "bracket]inside", "back\\slash", "new\nline", "tab\tstop"],
)
def test_structural_characters_are_refused(anon_client, name):
    created = _open_game(anon_client)

    assert (
        anon_client.post(f"/live/{created['token']}/join", json={"name": name}).status_code
        == 422
    )


@pytest.mark.parametrize("name", ["Ada", "Ada Lovelace", "José", "anna-lee", "x_1"])
def test_ordinary_names_still_work(anon_client, name):
    created = _open_game(anon_client)

    joined = anon_client.post(f"/live/{created['token']}/join", json={"name": name})

    assert joined.status_code == 200
    assert joined.json()["state"]["black"]["name"] == name


def test_header_value_escapes_rather_than_trusting(client):
    """The schema rejects these before they arrive, but the writer is the
    thing that has to hold: it is what every path into a PGN goes through, and
    a second way in should not be a second vulnerability."""
    assert header_value('x"]') == 'x\\"]'
    assert header_value("back\\slash") == "back\\\\slash"
    assert header_value("two\nlines") == "two lines"
    assert header_value("") == "?"
    assert header_value(None) == "?"


def test_a_truncated_name_never_ends_in_a_dangling_escape():
    """Escaping before truncating can leave a trailing lone backslash, which
    escapes the closing quote and reopens the exact hole this closes."""
    written = header_value("\\" * 200)

    assert not written.endswith("\\") or written.count("\\") % 2 == 0
    pgn = chess.pgn.Game()
    pgn.headers["White"] = written
    assert len(str(pgn).splitlines()[4].split('"')) == 3


# --- one seat, two claimants -----------------------------------------------


def test_two_simultaneous_joins_cannot_both_take_the_seat(anon_client, lifespan_sessions):
    """A read-modify-write with no lock: both callers saw the seat open, both
    were handed a credential, and only the second was written — so the first
    stored a seat token the server had already forgotten and had every move
    refused as a spectator's."""
    live_router.reset_rate_limit()
    token = _open_game(anon_client)["token"]

    results = []
    barrier = threading.Barrier(2)

    def join():
        joiner = TestClient(app)
        barrier.wait()
        results.append(joiner.post(f"/live/{token}/join", json={}))

    threads = [threading.Thread(target=join) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    codes = sorted(response.status_code for response in results)
    assert codes == [200, 409]

    handed_out = [r.json()["seat"] for r in results if r.status_code == 200]
    with lifespan_sessions() as db:
        game = livemod.get_by_token(db, token)
        stored = {game.white_seat, game.black_seat}
    # Whoever was told they had a seat actually has one.
    assert all(seat in stored for seat in handed_out)


# --- sockets ---------------------------------------------------------------


def test_a_game_will_not_hold_unlimited_sockets(anon_client, monkeypatch):
    monkeypatch.setattr(live_router, "MAX_SOCKETS_PER_GAME", 2)
    token = _open_game(anon_client)["token"]

    with anon_client.websocket_connect(f"/live/{token}/ws") as first:
        first.receive_json()
        with anon_client.websocket_connect(f"/live/{token}/ws") as second:
            second.receive_json()
            with anon_client.websocket_connect(f"/live/{token}/ws") as third:
                refused = third.receive_json()

    assert refused["type"] == "error"
    assert "Too many" in refused["message"]


def test_a_socket_flooding_messages_is_cut_off(anon_client, monkeypatch):
    """Every message here is a database read dispatched into the threadpool
    that also serves every HTTP route, so an anonymous spectator looping on
    `sync` is not only their own problem."""
    monkeypatch.setattr(live_router, "MAX_SOCKET_MESSAGES_PER_WINDOW", 5)
    token = _open_game(anon_client)["token"]

    with anon_client.websocket_connect(f"/live/{token}/ws") as socket:
        socket.receive_json()  # the handshake state
        last = None
        for _ in range(6):
            socket.send_json({"type": "ping"})
            last = socket.receive_json()

    assert last["type"] == "error"
    assert "slow down" in last["message"]


def test_a_non_string_move_is_an_error_not_a_dropped_socket(anon_client):
    """chess.Move.from_uci raises TypeError rather than ValueError on a
    non-string, which sailed past the handler in _apply and killed the socket
    through the catch-all."""
    created = _open_game(anon_client)
    joined = anon_client.post(f"/live/{created['token']}/join", json={})
    seat = joined.json()["seat"]
    token = created["token"]

    with anon_client.websocket_connect(
        f"/live/{token}/ws", subprotocols=["leechess.seat", created["seat"]]
    ) as socket:
        socket.receive_json()
        socket.send_json({"type": "move", "uci": {"not": "a string"}})
        refused = socket.receive_json()

        # Still alive and still usable, which is the actual assertion.
        socket.send_json({"type": "ping"})
        assert socket.receive_json()["type"] == "pong"

    assert refused["type"] == "error"
    assert seat  # the join is what made the game playable


def test_a_message_that_is_not_an_object_is_refused(anon_client):
    token = _open_game(anon_client)["token"]

    with anon_client.websocket_connect(f"/live/{token}/ws") as socket:
        socket.receive_json()
        socket.send_json(["not", "an", "object"])
        refused = socket.receive_json()

    assert refused["type"] == "error"


# --- the seat credential ---------------------------------------------------


def test_the_seat_travels_as_a_subprotocol(anon_client):
    """A credential in a URL is a credential in every access log, proxy log
    and Referer that touches it. A browser cannot set headers on a WebSocket,
    so the subprotocol is the channel."""
    created = _open_game(anon_client)
    anon_client.post(f"/live/{created['token']}/join", json={})

    with anon_client.websocket_connect(
        f"/live/{created['token']}/ws",
        subprotocols=["leechess.seat", created["seat"]],
    ) as socket:
        handshake = socket.receive_json()

    assert handshake["you"] == "white"


def test_a_comma_joined_subprotocol_header_is_understood(anon_client):
    """The form a real browser actually sends.

    A browser puts every offered protocol in one `Sec-WebSocket-Protocol`
    header, and uvicorn fills scope["subprotocols"] straight from
    `headers.get_all(...)` — so two protocols arrive as one comma-separated
    string. Starlette's TestClient hands them over already split, which is how
    a version of this that only worked under test once shipped.
    """
    created = _open_game(anon_client)
    anon_client.post(f"/live/{created['token']}/join", json={})

    socket = type("W", (), {"scope": {"subprotocols": [f"leechess.seat, {created['seat']}"]}})()
    seat, echo = live_router._seat_from_handshake(socket, None)

    assert seat == created["seat"]
    assert echo == "leechess.seat"


def test_a_bad_seat_subprotocol_is_a_spectator(anon_client):
    created = _open_game(anon_client)

    with anon_client.websocket_connect(
        f"/live/{created['token']}/ws", subprotocols=["leechess.seat", "not-a-seat"]
    ) as socket:
        handshake = socket.receive_json()

    assert handshake["you"] is None


def test_the_rest_state_takes_the_seat_from_a_header(anon_client):
    created = _open_game(anon_client)
    token = created["token"]
    anon_client.post(f"/live/{token}/join", json={})
    # A draw offer is between the two players; a spectator is not shown one.
    livemod._draw_offers[token] = "black"

    with_header = anon_client.get(
        f"/live/{token}", headers={"X-Live-Seat": created["seat"]}
    )
    without = anon_client.get(f"/live/{token}")

    assert with_header.json()["draw_offer_from"] == "black"
    assert without.json()["draw_offer_from"] is None


def test_the_query_parameter_still_works_for_a_client_mid_deploy(anon_client):
    """Kept deliberately: a browser holding the previous bundle should not lose
    its seat the moment this ships. The client stopped sending it."""
    created = _open_game(anon_client)
    token = created["token"]
    anon_client.post(f"/live/{token}/join", json={})
    livemod._draw_offers[token] = "black"

    response = anon_client.get(f"/live/{token}?seat={created['seat']}")

    assert response.json()["draw_offer_from"] == "black"


# --- in-memory bookkeeping -------------------------------------------------


def test_a_finished_game_leaves_nothing_behind_in_memory(anon_client, lifespan_sessions):
    """`_away_since` was only ever cleared by the absent player coming back, so
    a game that ended — or one the sweep deleted — left its countdown behind
    for the life of the process."""
    created = _open_game(anon_client)
    token = created["token"]
    anon_client.post(f"/live/{token}/join", json={})

    livemod.mark_away(token, "black", deliberate=False)
    livemod._draw_offers[token] = "white"
    assert token in livemod._away_since

    with lifespan_sessions() as db:
        livemod.finish(db, livemod.get_by_token(db, token), "1-0", "resignation")

    assert token not in livemod._away_since
    assert token not in livemod._draw_offers
