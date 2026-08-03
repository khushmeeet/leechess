"""Play a friend over a shared link.

Two things are being held down here. The first is that the server, not the
browser, decides what happened: who may move, whether the move is legal,
whose turn it is, and when the game is over. The second is the bargain about
what is kept — a seat with an account gets a saved, analyzed game at the end;
a seat without one gets nothing at all, and neither does the other player's
account get half of it.
"""

import chess
import pytest
from sqlalchemy import select

from app import live
from app.models import Game, LiveGame, Puzzle
from app.routers import live as live_router

pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def _clean_module_state():
    """Rooms, draw offers and the create limiter are module state, so they
    outlive any one app instance — without this a test leaks into the next."""
    live.reset_rooms()
    live_router.reset_rate_limit()
    yield
    live.reset_rooms()
    live_router.reset_rate_limit()


@pytest.fixture(autouse=True)
def _no_real_analysis(monkeypatch):
    """Finishing a live game forks it into Game rows and queues the analysis
    job, which shells out to Stockfish. These tests are about the forking, so
    the job is recorded rather than run — a unit test must not start an
    engine."""
    queued: list[int] = []
    monkeypatch.setattr("app.analysis.run_game_analysis", queued.append)
    return queued


@pytest.fixture()
def analysis_queue(_no_real_analysis):
    return _no_real_analysis


@pytest.fixture()
def guest_client(client):
    """A friend with no account, on the same database.

    Its own TestClient, because a cookie jar lives on the client — the
    `client` fixture registered an account on `anon_client` and handed the
    same object back, so reusing it here would quietly make both sides of the
    board the same signed-in person. (`client` has already installed the
    get_db override and run the lifespan, so this needs neither.)

    Use it for the REST half only. See `sockets_via` for why.
    """
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


# Every WebSocket in a test has to be opened from the *same* TestClient, and
# it has to be one that was entered as a context manager (the `client`
# fixture is). That client owns a single event loop for all of its sockets; a
# bare TestClient spins up a new one per connection, and a broadcast from one
# loop into a socket living on another silently fails — the app drops the peer
# and the other player waits forever for a move that was delivered nowhere.
#
# This costs the tests nothing, because it is not what identifies a player: a
# live socket authenticates with its seat token, never with a cookie. Who owns
# a seat is settled over REST at create/join time, which is where the separate
# clients belong. Under uvicorn there is one loop and none of this applies.


def open_game(client, **body) -> dict:
    response = client.post("/live", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def join(client, token: str, **body) -> dict:
    response = client.post(f"/live/{token}/join", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def drain_to(socket, *wanted: str) -> dict:
    """The next message of one of these types, skipping presence chatter — a
    socket opening or closing anywhere in the room broadcasts one, and which
    of them arrive first is not something a test should depend on."""
    for _ in range(8):
        message = socket.receive_json()
        if message["type"] in wanted:
            return message
    raise AssertionError(f"no {wanted} message arrived")


def play(socket, uci: str) -> dict:
    """Play a move and wait for the server's verdict on *this* move.

    Matching on the uci is not fussiness. Every socket in the room receives
    every move, so a player's queue already holds their opponent's last move —
    a helper that returned the next message of type "move" would hand back
    that one and let the test run on before the server had applied anything.
    """
    socket.send_json({"type": "move", "uci": uci})
    for _ in range(8):
        message = socket.receive_json()
        if message["type"] == "error":
            return message
        if message["type"] == "move" and message["uci"] == uci:
            return message
    raise AssertionError(f"no verdict on {uci}")


# --- the link ---


def test_creating_a_game_takes_a_seat_and_leaves_one_open(anon_client):
    created = open_game(anon_client, color="white")

    assert created["color"] == "white"
    assert created["seat"]
    state = created["state"]
    assert state["status"] == "waiting"
    assert state["joinable"] is True
    assert state["white"]["seated"] is True
    assert state["black"]["seated"] is False
    assert state["fen"] == chess.STARTING_FEN


def test_the_link_needs_no_account_at_either_end(anon_client):
    """The whole feature: two people who have never signed up, one URL."""
    created = open_game(anon_client, color="white", name="Ada")
    joined = join(anon_client, created["token"], name="Bo")

    assert joined["color"] == "black"
    assert joined["state"]["status"] == "playing"
    assert joined["state"]["white"]["name"] == "Ada"
    assert joined["state"]["black"]["name"] == "Bo"
    # Said on the board, because it is the difference between the two ways of
    # playing and there is no second chance to mention it.
    assert joined["state"]["white"]["saves"] is False
    assert joined["state"]["black"]["saves"] is False


def test_a_signed_in_creator_plays_under_their_username(client):
    created = open_game(client, color="white")

    assert created["state"]["white"]["name"] == "tester"
    assert created["state"]["white"]["saves"] is True


def test_a_signed_in_player_cannot_rename_themselves_in_the_body(client):
    """The name beside the board has to mean something for an account."""
    created = open_game(client, color="white", name="not-my-username")

    assert created["state"]["white"]["name"] == "tester"


def test_seat_tokens_are_never_in_the_public_state(anon_client):
    created = open_game(anon_client, color="white")
    body = anon_client.get(f"/live/{created['token']}").text

    assert created["seat"] not in body


def test_a_third_visitor_gets_no_seat(anon_client):
    created = open_game(anon_client, color="white")
    join(anon_client, created["token"])

    refused = anon_client.post(f"/live/{created['token']}/join", json={})
    assert refused.status_code == 409
    assert "watch" in refused.json()["detail"]


def test_an_unknown_link_is_a_404(anon_client):
    assert anon_client.get("/live/nope").status_code == 404
    assert anon_client.post("/live/nope/join", json={}).status_code == 404


def test_random_is_the_default_colour(anon_client):
    """Both sides have to be reachable, or "random" is a lie. Twenty draws
    with a fair coin miss a side once in half a million runs."""
    colors = {open_game(anon_client)["color"] for _ in range(20)}
    assert colors == {"white", "black"}


def test_creating_games_is_rate_limited(anon_client):
    """The one write in this app with no account in front of it."""
    for _ in range(live_router.MAX_CREATES_PER_WINDOW):
        assert anon_client.post("/live", json={}).status_code == 201

    refused = anon_client.post("/live", json={})
    assert refused.status_code == 429


# --- playing ---


def test_a_move_reaches_the_other_player(anon_client):
    created = open_game(anon_client, color="white")
    joined = join(anon_client, created["token"])
    token = created["token"]

    with anon_client.websocket_connect(f"/live/{token}/ws?seat={created['seat']}") as white:
        assert white.receive_json()["type"] == "state"
        with anon_client.websocket_connect(
            f"/live/{token}/ws?seat={joined['seat']}"
        ) as black:
            assert black.receive_json()["type"] == "state"

            play(white, "e2e4")
            arrived = drain_to(black, "move")

    assert arrived["san"] == "e4"
    assert arrived["uci"] == "e2e4"
    assert arrived["state"]["turn"] == "black"
    assert arrived["state"]["moves"] == ["e2e4"]


def test_a_spectator_sees_the_game_but_cannot_move(anon_client):
    created = open_game(anon_client, color="white")
    joined = join(anon_client, created["token"])
    token = created["token"]

    with anon_client.websocket_connect(f"/live/{token}/ws?seat={created['seat']}") as white:
        white.receive_json()
        with anon_client.websocket_connect(f"/live/{token}/ws") as watcher:
            assert watcher.receive_json()["you"] is None

            play(white, "e2e4")
            assert drain_to(watcher, "move")["san"] == "e4"

            watcher.send_json({"type": "move", "uci": "e7e5"})
            refused = drain_to(watcher, "error")

    assert "watching" in refused["message"]
    assert joined["color"] == "black"


def test_moving_out_of_turn_is_refused(anon_client):
    created = open_game(anon_client, color="white")
    joined = join(anon_client, created["token"])
    token = created["token"]

    with anon_client.websocket_connect(
        f"/live/{token}/ws?seat={joined['seat']}"
    ) as black:
        black.receive_json()
        refused = play(black, "e7e5")

    assert refused["type"] == "error"
    assert refused["message"] == "Not your turn."
    # The state rides along, so a client that had drifted is put back in step
    # rather than left guessing.
    assert refused["state"]["moves"] == []


def test_an_illegal_move_is_refused_by_the_server(anon_client):
    """Never trust the board on the other end — a patched client, or one that
    has drifted after a dropped socket, must not be able to write nonsense
    into the game."""
    created = open_game(anon_client, color="white")
    join(anon_client, created["token"])

    with anon_client.websocket_connect(
        f"/live/{created['token']}/ws?seat={created['seat']}"
    ) as white:
        white.receive_json()
        refused = play(white, "e2e5")

    assert refused["type"] == "error"
    assert "not legal" in refused["message"]


def test_no_moves_before_the_second_player_arrives(anon_client):
    created = open_game(anon_client, color="white")

    with anon_client.websocket_connect(
        f"/live/{created['token']}/ws?seat={created['seat']}"
    ) as white:
        white.receive_json()
        refused = play(white, "e2e4")

    assert refused["type"] == "error"
    assert "opponent" in refused["message"]


def test_reconnecting_replays_the_whole_game(anon_client):
    """fly.toml auto-stops the machine and a deploy replaces it, so a socket
    dying between moves is ordinary. The handshake is the resync."""
    created = open_game(anon_client, color="white")
    joined = join(anon_client, created["token"])
    token = created["token"]

    with anon_client.websocket_connect(f"/live/{token}/ws?seat={created['seat']}") as white:
        white.receive_json()
        play(white, "e2e4")
    with anon_client.websocket_connect(f"/live/{token}/ws?seat={joined['seat']}") as black:
        black.receive_json()
        play(black, "e7e5")

    live.reset_rooms()  # every socket lost, as a restart would leave it

    with anon_client.websocket_connect(f"/live/{token}/ws?seat={created['seat']}") as back:
        opened = back.receive_json()

    assert opened["type"] == "state"
    assert opened["you"] == "white"
    assert opened["state"]["moves"] == ["e2e4", "e7e5"]
    assert opened["state"]["turn"] == "white"


def test_a_seat_survives_the_socket(anon_client):
    """Closing the tab is not leaving the game — the seat is the credential,
    and it is in the player's browser, not in the connection."""
    created = open_game(anon_client, color="white")
    join(anon_client, created["token"])

    with anon_client.websocket_connect(
        f"/live/{created['token']}/ws?seat={created['seat']}"
    ) as white:
        white.receive_json()

    state = anon_client.get(f"/live/{created['token']}").json()
    assert state["white"]["seated"] is True
    assert state["white"]["present"] is False
    assert state["joinable"] is False


# --- endings ---


def test_checkmate_ends_the_game(anon_client):
    created = open_game(anon_client, color="white")
    joined = join(anon_client, created["token"])
    token = created["token"]
    fools_mate = ["f2f3", "e7e5", "g2g4", "d8h4"]

    with anon_client.websocket_connect(f"/live/{token}/ws?seat={created['seat']}") as white:
        white.receive_json()
        with anon_client.websocket_connect(
            f"/live/{token}/ws?seat={joined['seat']}"
        ) as black:
            black.receive_json()
            for index, uci in enumerate(fools_mate):
                play(white if index % 2 == 0 else black, uci)
            final = anon_client.get(f"/live/{token}").json()

    assert final["status"] == "finished"
    assert final["result"] == "0-1"
    assert final["end_reason"] == "checkmate"


def test_resigning_ends_the_game(anon_client):
    created = open_game(anon_client, color="white")
    joined = join(anon_client, created["token"])
    token = created["token"]

    with anon_client.websocket_connect(f"/live/{token}/ws?seat={created['seat']}") as white:
        white.receive_json()
        play(white, "e2e4")
        with anon_client.websocket_connect(
            f"/live/{token}/ws?seat={joined['seat']}"
        ) as black:
            black.receive_json()
            black.send_json({"type": "resign"})
            ended = drain_to(white, "end")

    assert ended["reason"] == "resignation"
    assert ended["state"]["result"] == "1-0"


def test_a_draw_needs_both_players(anon_client):
    created = open_game(anon_client, color="white")
    joined = join(anon_client, created["token"])
    token = created["token"]

    with anon_client.websocket_connect(f"/live/{token}/ws?seat={created['seat']}") as white:
        white.receive_json()
        with anon_client.websocket_connect(
            f"/live/{token}/ws?seat={joined['seat']}"
        ) as black:
            black.receive_json()

            # Offering to yourself is not an agreement.
            white.send_json({"type": "draw-offer"})
            drain_to(black, "draw-offer")
            white.send_json({"type": "draw-accept"})
            refused = drain_to(white, "error")
            assert "no draw offer" in refused["message"]

            black.send_json({"type": "draw-accept"})
            ended = drain_to(white, "end")

    assert ended["reason"] == "agreement"
    assert ended["state"]["result"] == "1/2-1/2"


def test_a_move_withdraws_a_draw_offer(anon_client):
    """Playing on is the ordinary way of saying no."""
    created = open_game(anon_client, color="white")
    joined = join(anon_client, created["token"])
    token = created["token"]

    with anon_client.websocket_connect(f"/live/{token}/ws?seat={created['seat']}") as white:
        white.receive_json()
        with anon_client.websocket_connect(
            f"/live/{token}/ws?seat={joined['seat']}"
        ) as black:
            black.receive_json()
            white.send_json({"type": "draw-offer"})
            drain_to(black, "draw-offer")
            play(white, "e2e4")
            black.send_json({"type": "draw-accept"})
            refused = drain_to(black, "error")

    assert "no draw offer" in refused["message"]


def test_a_finished_game_takes_no_more_moves(anon_client):
    created = open_game(anon_client, color="white")
    joined = join(anon_client, created["token"])
    token = created["token"]

    with anon_client.websocket_connect(f"/live/{token}/ws?seat={created['seat']}") as white:
        white.receive_json()
        white.send_json({"type": "resign"})
        drain_to(white, "end")
        refused = play(white, "e2e4")

    assert refused["type"] == "error"
    assert "already over" in refused["message"]
    assert joined["color"] == "black"


# --- what is kept ---


def test_an_anonymous_game_is_kept_nowhere(anon_client, db_session, analysis_queue):
    """No account on either side: the game happened, and that is all. Same
    bargain anonymous play has always made."""
    created = open_game(anon_client, color="white")
    joined = join(anon_client, created["token"])
    token = created["token"]

    with anon_client.websocket_connect(f"/live/{token}/ws?seat={created['seat']}") as white:
        white.receive_json()
        with anon_client.websocket_connect(
            f"/live/{token}/ws?seat={joined['seat']}"
        ) as black:
            black.receive_json()
            play(white, "e2e4")
            play(black, "e7e5")
            white.send_json({"type": "resign"})
            drain_to(white, "end")

    assert db_session.scalars(select(Game)).all() == []
    assert db_session.scalars(select(LiveGame)).one().status == "finished"
    assert analysis_queue == []


def test_a_signed_in_seat_gets_its_own_saved_game(
    client, guest_client, db_session, analysis_queue
):
    """One side has an account, the other does not. The account gets a game
    numbered, stored and queued for analysis; the friend gets nothing."""
    created = open_game(client, color="white")
    joined = join(guest_client, created["token"], name="Bo")
    token = created["token"]

    with client.websocket_connect(f"/live/{token}/ws?seat={created['seat']}") as white:
        white.receive_json()
        with client.websocket_connect(f"/live/{token}/ws?seat={joined['seat']}") as black:
            black.receive_json()
            play(white, "e2e4")
            play(black, "e7e5")
            black.send_json({"type": "resign"})
            saved = drain_to(white, "saved")

    games = db_session.scalars(select(Game)).all()
    assert len(games) == 1
    game = games[0]
    assert game.mode == "online"
    assert game.user_color == "white"
    assert game.white == "tester"
    assert game.black == "Bo"
    assert game.result == "1-0"
    assert game.number == 1
    assert [move.san for move in game.moves] == ["e4", "e5"]
    assert game.pgn.startswith("[Event ")
    # The player is told where their review is, on their own socket.
    assert saved["game_id"] == game.id
    assert saved["number"] == 1
    assert analysis_queue == [game.id]


def test_two_accounts_each_get_their_own_copy(
    client, second_client, db_session, analysis_queue
):
    """Everything downstream of a Game assumes one owner — the review list,
    the game number, the CPL trend. So each player gets their own row, from
    their own side, rather than one row they would have to share."""
    created = open_game(client, color="white")
    joined = join(second_client, created["token"])
    token = created["token"]

    with client.websocket_connect(f"/live/{token}/ws?seat={created['seat']}") as white:
        white.receive_json()
        with client.websocket_connect(f"/live/{token}/ws?seat={joined['seat']}") as black:
            black.receive_json()
            play(white, "e2e4")
            play(black, "e7e5")
            white.send_json({"type": "resign"})
            drain_to(black, "end")

    games = db_session.scalars(select(Game).order_by(Game.user_color)).all()
    assert len(games) == 2
    black_row, white_row = games
    assert black_row.user_color == "black"
    assert white_row.user_color == "white"
    assert black_row.user_id != white_row.user_id
    # Same game, told from two sides: both are #1 to their own account.
    assert black_row.number == white_row.number == 1
    assert black_row.result == white_row.result == "0-1"
    assert sorted(analysis_queue) == sorted(game.id for game in games)

    # And each account sees only its own.
    assert [row["id"] for row in client.get("/games").json()] == [white_row.id]
    assert [row["id"] for row in second_client.get("/games").json()] == [black_row.id]


def test_a_game_with_no_moves_is_not_saved(client, db_session):
    """Nothing to look back at, so nothing is written — the same rule the
    completion route applies to an empty engine game."""
    created = open_game(client, color="white")
    join(client, created["token"])

    with client.websocket_connect(
        f"/live/{created['token']}/ws?seat={created['seat']}"
    ) as white:
        white.receive_json()
        white.send_json({"type": "resign"})
        drain_to(white, "end")

    assert db_session.scalars(select(Game)).all() == []


def test_forking_twice_does_not_duplicate(client, guest_client, db_session, analysis_queue):
    """A reconnect racing the final move must not mint a second copy."""
    created = open_game(client, color="white")
    join(guest_client, created["token"])
    token = created["token"]

    with client.websocket_connect(f"/live/{token}/ws?seat={created['seat']}") as white:
        white.receive_json()
        play(white, "e2e4")
        white.send_json({"type": "resign"})
        drain_to(white, "end")

    game = db_session.scalars(select(LiveGame)).one()
    assert game.white_game_id is not None
    before = db_session.scalars(select(Game)).all()
    assert len(before) == 1

    live.fork_into_games(db_session, game)

    assert [row.id for row in db_session.scalars(select(Game))] == [before[0].id]


def test_only_your_own_blunders_become_puzzles(client, db_session, analysis_queue):
    """The queue is your own missed tactics. Half the mistakes in a friend
    game are the friend's, and drilling those would teach you nothing."""
    created = open_game(client, color="white")
    join(client, created["token"])
    game = db_session.scalars(select(LiveGame)).one()
    game.white_user_id = None  # keep the fork to the black seat alone
    game.moves_uci = "f2f3 e7e5 g2g4 d8h4"
    db_session.commit()

    live.fork_into_games(db_session, game)
    saved = db_session.scalars(select(Game)).one()
    assert saved.user_color == "black"

    # Flag both sides' moves, then let the generator decide whose are drilled.
    for move in saved.moves:
        move.classification = "blunder"
        move.best_move = "e2e4"
    db_session.commit()

    from app.puzzle_generation import create_puzzles_for_game

    create_puzzles_for_game(saved)
    db_session.commit()

    drilled = db_session.scalars(select(Puzzle)).all()
    # Black played plies 2 and 4; nothing from White's may appear.
    assert {puzzle.source_move.ply for puzzle in drilled} <= {2, 4}


def test_abandoned_games_are_swept(anon_client, db_session, lifespan_sessions):
    """A link nobody took up is litter — and unlike a Game row it was never
    anybody's to look back at."""
    from datetime import timedelta

    from app.models import utcnow

    fresh = open_game(anon_client, color="white")["token"]
    stale = open_game(anon_client, color="white")["token"]
    row = db_session.scalars(select(LiveGame).where(LiveGame.token == stale)).one()
    row.last_activity_at = utcnow() - live.ABANDONED_AFTER - timedelta(minutes=1)
    db_session.commit()

    assert live.sweep_abandoned() == 1

    remaining = {game.token for game in db_session.scalars(select(LiveGame))}
    assert remaining == {fresh}
