"""Play a friend: create a link, join it, then move over a WebSocket.

The REST half is the handshake (make a game, take a seat); the socket is the
game itself. Both halves accept a caller with no account — that is the whole
point of the feature — so `current_active_user_optional` is used everywhere
and a missing user is an ordinary state rather than a 401.

Everything here is async, unlike the rest of this backend: a WebSocket
endpoint has to be. The database is not — it is a sync SQLAlchemy Session on
SQLite — so every query goes through `run_in_threadpool`. Calling it directly
would block the event loop, which on a single-worker machine means blocking
every other request and every other game.
"""

import logging
import time

import chess
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, WebSocket
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.websockets import WebSocketDisconnect

from app import live
from app.auth.backend import current_active_user_optional
from app.auth.models import User
from app.db import SessionLocal, get_db
from app.rate_limit import SlidingWindow, client_key
from app.schemas import LiveCreate, LiveJoin, LiveSeated, LiveStateOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/live", tags=["live"])


class _Missing:
    """Distinguishes "no game with that link" from "no seat in it" — both of
    which are a bare None if you let them be, and only one of which should
    close the socket. A spectator is not an error."""


MISSING = _Missing()

# A WebSocket outlives any request scope, so the `get_db` dependency cannot
# supply its sessions — the socket handlers open their own. Module-level and
# patchable for the same reason app/analysis.py's is: without it the browser
# and pytest suites would talk to the configured database while every REST
# route in the same test talked to the throwaway one.
session_factory = SessionLocal

# Creating a game needs no account, so it is the one write in this app any
# passer-by can reach. In-process and deliberately crude, for the same reason
# app/auth/throttle.py is: the job is to make scripted spam pointless, not to
# survive a restart.
CREATE_WINDOW_SECONDS = 60
MAX_CREATES_PER_WINDOW = 20
_creates = SlidingWindow(
    window_seconds=CREATE_WINDOW_SECONDS, max_events=MAX_CREATES_PER_WINDOW
)

# A game is two players and whoever they showed the link to. Well past that,
# and far short of the number that makes one token's broadcast a fan-out worth
# scripting.
MAX_SOCKETS_PER_GAME = 16
# Everything the machine will hold at once, across every game. uvicorn will
# accept far more connections than this app has any use for, and each one is a
# room entry, a task, and a share of the broadcast loop.
MAX_LIVE_SOCKETS = 400
# One socket's budget. A playing client sends a move every several seconds and
# a heartbeat every twenty-five; a client resyncing hard after a wake-up sends
# a short burst. This is generous for both and useless for a flood.
SOCKET_MESSAGE_WINDOW_SECONDS = 10.0
MAX_SOCKET_MESSAGES_PER_WINDOW = 60


def _rate_limit_create(request: Request) -> None:
    key = client_key(request)
    if _creates.exceeded(key):
        raise HTTPException(
            status_code=429, detail="Too many games started — wait a minute."
        )
    _creates.record(key)


def reset_rate_limit() -> None:
    """Test support — module state outlives the app instance."""
    _creates.reset()


def _display_name(user: User | None, offered: str | None) -> str | None:
    """A signed-in player is their username; anyone else may offer a name, or
    go without one and be shown as their colour."""
    if user is not None:
        return user.username
    name = (offered or "").strip()
    return name[:24] or None


def _load(db: Session, token: str) -> live.LiveGame:
    game = live.get_by_token(db, token)
    if game is None:
        raise HTTPException(status_code=404, detail="No game with that link.")
    return game


@router.post("", response_model=LiveSeated, status_code=201)
def create_live_game(
    payload: LiveCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_active_user_optional),
) -> LiveSeated:
    """Open a game and take a seat. The response's `token` is the link to
    send; whoever opens it first takes the other side."""
    _rate_limit_create(request)
    game, seat, color = live.create_game(
        db,
        color=payload.color,
        name=_display_name(user, payload.name),
        user_id=user.id if user else None,
    )
    return LiveSeated(
        token=game.token,
        seat=seat,
        color=color,
        state=LiveStateOut(**live.state_of(game, seat_color_=color)),
    )


@router.get("/{token}", response_model=LiveStateOut)
def get_live_game(
    token: str,
    seat: str | None = Query(default=None),
    x_live_seat: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> LiveStateOut:
    """The game as it stands. Open to anyone with the link — that is what
    makes it watchable — but a seat token is what adds the private parts.

    The credential comes in a header. It used to come in the query string,
    where it was written into every access log, proxy log and Referer that
    touched the request — a credential in a URL is a credential in a logfile.
    The query parameter is still read so that a browser holding the previous
    bundle keeps its seat across the deploy that ships this; the client stopped
    sending it (client/src/lib/api/live.ts).
    """
    game = _load(db, token)
    credential = x_live_seat or seat
    return LiveStateOut(
        **live.state_of(game, seat_color_=live.seat_color(game, credential))
    )


@router.post("/{token}/join", response_model=LiveSeated)
def join_live_game(
    token: str,
    payload: LiveJoin,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_active_user_optional),
) -> LiveSeated:
    """Take the open seat. 409 once both are taken — the caller watches
    instead, which the client handles without asking anything of them.

    Under the game's lock, and the row is re-read inside it. Without that this
    was a read-modify-write two callers could interleave: both saw the seat
    open, both were handed a credential, and only the second was written — so
    the first was told it had a seat, stored one, and then had every move
    refused as a spectator's. The move path has taken this lock all along; the
    one place a seat is *decided* was the place that did not.
    """
    with live.lock_for(token):
        game = _load(db, token)
        try:
            seat, color = live.join_game(
                db,
                game,
                name=_display_name(user, payload.name),
                user_id=user.id if user else None,
            )
        except live.LiveError as error:
            raise HTTPException(status_code=409, detail=str(error))
        state = live.state_of(game, seat_color_=color)
    return LiveSeated(token=game.token, seat=seat, color=color, state=LiveStateOut(**state))


# ── the socket ─────────────────────────────────────────────────────────────


def _seat_of(token: str, seat: str | None) -> str | None | _Missing:
    """Which side this credential may move — `MISSING` when there is no game
    with that link at all, which is the one case the socket refuses outright.

    Its own session, like everything else down here: a WebSocket outlives the
    request scope `get_db` belongs to.
    """
    db = session_factory()
    try:
        game = live.get_by_token(db, token)
        if game is None:
            return MISSING
        return live.seat_color(game, seat)
    finally:
        db.close()


def _state_only(token: str, seat: str | None) -> dict:
    """The current state, as this seat may see it. A game that vanished
    underneath an open socket returns the empty state rather than raising —
    every caller here is mid-conversation with a client that still needs an
    answer shaped like one."""
    db = session_factory()
    try:
        game = live.get_by_token(db, token)
        if game is None:
            return state_unavailable()
        return live.state_of(game, seat_color_=live.seat_color(game, seat))
    finally:
        db.close()


def _apply(token: str, color: str, action: str, uci: str | None) -> dict:
    """Apply one action and return the event to broadcast.

    The state that goes out with it is read separately and per seat, because
    a state says different things to different people — so this returns only
    what happened, not anyone's view of it.

    Runs in a worker thread, and holds the game's lock across the whole
    read-modify-write — the row is read *inside* the lock, so two players
    moving at the same instant are applied one after the other rather than
    both against the position they each last saw. Taken here, in the thread
    that does the work, rather than around the `await` in the handler: it is
    the database read and write that have to be atomic, not the scheduling.
    """
    with live.lock_for(token):
        db = session_factory()
        try:
            game = live.get_by_token(db, token)
            if game is None:
                raise live.LiveError("That game is gone.")
            if action == "move":
                event = {"type": "move", **live.apply_move(db, game, color, uci or "")}
            elif action == "resign":
                live.resign(db, game, color)
                event = {"type": "end", "reason": "resignation"}
            elif action == "draw-offer":
                live.offer_draw(game, color)
                event = {"type": "draw-offer", "from": color}
            elif action == "draw-accept":
                live.accept_draw(db, game, color)
                event = {"type": "end", "reason": "agreement"}
            elif action == "draw-decline":
                live.decline_draw(game, color)
                event = {"type": "draw-decline", "from": color}
            elif action == "claim":
                live.claim_abandoned(db, game, color)
                event = {"type": "end", "reason": "abandonment"}
            elif action == "rematch":
                # Whether this was the asking or the agreeing is the server's
                # to work out — see live.offer_rematch — so the two outcomes
                # are two events rather than two actions.
                if live.offer_rematch(db, game, color):
                    event = {"type": "restart"}
                else:
                    event = {"type": "rematch-offer", "from": color}
            elif action == "rematch-decline":
                live.decline_rematch(game, color)
                event = {"type": "rematch-decline", "from": color}
            else:
                raise live.LiveError(f"Unknown action {action!r}.")
            return event
        finally:
            db.close()


def _saved_games(token: str) -> dict[str, dict]:
    """Where each player's finished game landed, if it landed anywhere. Only
    a seat with an account has one — the other side played and that was it."""
    db = session_factory()
    try:
        game = live.get_by_token(db, token)
        if game is None or game.status != "finished":
            return {}
        saved = {}
        for color in live.COLORS:
            game_id = getattr(game, f"{color}_game_id")
            if game_id is None:
                continue
            row = db.get(live.Game, game_id)
            if row is not None:
                saved[color] = {"game_id": row.id, "number": row.number}
        return saved
    finally:
        db.close()


# What the client names when it offers the seat credential as a WebSocket
# subprotocol: ["leechess.seat", "<the seat token>"]. A subprotocol travels in
# a handshake header, so unlike a query parameter it stays out of access logs
# and Referers — and it is the only channel available, since a browser's
# WebSocket constructor cannot set headers.
SEAT_SUBPROTOCOL = "leechess.seat"


class _MessageBudget:
    """One socket's allowance, in messages per window.

    Per connection rather than per address or per game, and a plain list rather
    than the shared limiter, because it lives and dies with the socket — there
    is no key to leak and nothing to sweep. Every message here costs a database
    read dispatched into the threadpool that also serves every HTTP route, so
    an anonymous spectator sending `sync` in a loop is not a self-inflicted
    problem; it is everyone's.
    """

    def __init__(self) -> None:
        self._at: list[float] = []

    def allow(self) -> bool:
        now = time.monotonic()
        self._at = [at for at in self._at if now - at < SOCKET_MESSAGE_WINDOW_SECONDS]
        if len(self._at) >= MAX_SOCKET_MESSAGES_PER_WINDOW:
            return False
        self._at.append(now)
        return True


def _offered_subprotocols(websocket: WebSocket) -> list[str]:
    """The subprotocols the client actually named, however it spelled them.

    `scope["subprotocols"]` is not reliably one entry per protocol: uvicorn
    fills it from `headers.get_all("Sec-WebSocket-Protocol")`, and a browser
    sends the whole list as a single comma-separated header — so two offered
    protocols arrive as one string. Starlette's TestClient passes them through
    already split, which is exactly the sort of difference that makes a unit
    test pass against a transport the deployed app does not use.
    """
    offered: list[str] = []
    for value in websocket.scope.get("subprotocols") or ():
        offered.extend(part.strip() for part in str(value).split(",") if part.strip())
    return offered


def _seat_from_handshake(
    websocket: WebSocket, query_seat: str | None
) -> tuple[str | None, str | None]:
    """(the credential, the subprotocol to echo back).

    A browser closes the connection if it offered subprotocols and the server
    accepted without choosing one, so an offer has to be answered.
    """
    offered = _offered_subprotocols(websocket)
    if len(offered) >= 2 and offered[0] == SEAT_SUBPROTOCOL:
        return offered[1], SEAT_SUBPROTOCOL
    # No offer: a spectator, or a browser still running the bundle from before
    # the credential moved out of the URL. See get_live_game.
    return query_seat, None


@router.websocket("/{token}/ws")
async def live_socket(
    websocket: WebSocket, token: str, seat: str | None = Query(default=None)
) -> None:
    """One player's (or spectator's) connection to a game.

    The handshake replies with the full state read from the database rather
    than anything held in memory, so reconnecting after a dropped socket — or
    after the machine was replaced mid-game, which fly.toml allows — needs no
    special path on either side. It is the ordinary one.
    """
    seat, subprotocol = _seat_from_handshake(websocket, seat)
    await websocket.accept(subprotocol=subprotocol)

    # Checked after accepting rather than by refusing the handshake, so the
    # client is told why instead of seeing a bare connection failure. Anyone
    # may open one of these — no account, no seat, just the link — so "as many
    # as you like" was a standing invitation.
    if (
        live.total_sockets() >= MAX_LIVE_SOCKETS
        or live.room_size(token) >= MAX_SOCKETS_PER_GAME
    ):
        await websocket.send_json(
            {"type": "error", "message": "Too many people are watching this game."}
        )
        await websocket.close()
        return

    resolved = await run_in_threadpool(_seat_of, token, seat)
    if resolved is MISSING:
        # `reason` so the client can tell this from a refused move and stop
        # trying: everything else it is told over this socket is worth
        # reconnecting for, and a link that was swept is not.
        await websocket.send_json(
            {"type": "error", "reason": "gone", "message": "No game with that link."}
        )
        await websocket.close()
        return

    color = resolved
    # Joined before the state is read, so the handshake already carries this
    # socket's own presence — otherwise the first thing it received would be a
    # correction to the second thing it received.
    live.join_room(token, websocket, color)
    if color is not None:
        live.mark_present(token, color)
        # A player arriving to an empty seat opposite starts its clock, which
        # is what makes the claim survive a restart: the hub is memory, so
        # after one nobody is here and nothing remembers when anybody left.
        # Only a player does this — a passing spectator should not put
        # anyone's game on a countdown.
        opponent = "black" if color == "white" else "white"
        if opponent not in live.present_seats(token):
            live.note_absence(token, opponent)
    # A clean close frame means they meant to go — a closed tab, a navigation.
    # Anything else is the connection failing under them, which is usually a
    # tunnel or a sleeping laptop and usually comes back.
    deliberate = False
    try:
        state = await run_in_threadpool(_state_only, token, seat)
        await websocket.send_json({"type": "state", "you": color, "state": state})
        if state["status"] == "finished":
            await _announce_saved(token)
        # Presence changed for everyone else the moment this socket opened.
        await _broadcast_state(token, exclude=websocket)

        budget = _MessageBudget()
        while True:
            message = await websocket.receive_json()
            # A rematch swaps the seats underneath every socket in the game
            # while they all stay open, so the side this connection speaks for
            # is read back from the room rather than trusted from the
            # handshake — otherwise this player's next move would be applied
            # for the colour they used to have. A watcher stays a watcher, and
            # so does a socket the broadcast loop has already given up on.
            seated = live.room_color(token, websocket)
            if seated is not None:
                color = seated
            if not budget.allow():
                # Closed rather than throttled in place: nothing legitimate
                # sends at this rate, and a client held open at the limit would
                # go on costing a database read per message. The reconnect the
                # client already does for a dropped socket is the way back.
                await websocket.send_json(
                    {"type": "error", "message": "Too many messages — slow down."}
                )
                await websocket.close()
                return
            if not isinstance(message, dict):
                # receive_json will hand back whatever JSON arrived, list or
                # string included, and `.get` on those is an AttributeError
                # that reads as a server bug in the log.
                await websocket.send_json(
                    {"type": "error", "message": "That is not a message."}
                )
                continue
            action = message.get("type")
            if action == "ping":
                await websocket.send_json({"type": "pong"})
                continue
            if action == "sync":
                fresh = await run_in_threadpool(_state_only, token, seat)
                await websocket.send_json(
                    {"type": "state", "you": color, "state": fresh}
                )
                continue
            if color is None:
                await websocket.send_json(
                    {"type": "error", "message": "You are watching this game."}
                )
                continue

            uci = message.get("uci")
            if uci is not None and not isinstance(uci, str):
                # chess.Move.from_uci raises TypeError rather than ValueError
                # on a non-string, which sails past _apply's handler and kills
                # the socket through the catch-all below.
                await websocket.send_json(
                    {"type": "error", "message": "That is not a move."}
                )
                continue

            try:
                event = await run_in_threadpool(_apply, token, color, action, uci)
            except live.LiveError as error:
                # The mover's problem alone, and the state goes with it so a
                # client that had drifted is put back in step.
                fresh = await run_in_threadpool(_state_only, token, seat)
                await websocket.send_json(
                    {"type": "error", "message": str(error), "state": fresh}
                )
                continue

            # Per seat, not one payload for the room: a state carries things
            # that belong to one player — the standing draw offer, the
            # countdown on an opponent who left — and broadcasting the actor's
            # view would hand both to everyone watching.
            states = await run_in_threadpool(_states_by_seat, token)
            await live.broadcast_per_seat(
                token,
                {
                    side: {**event, "you": side, "state": s}
                    for side, s in states.items()
                },
            )
            if states[None]["status"] == "finished":
                await _announce_saved(token)
    except WebSocketDisconnect as closed:
        # 1000 normal, 1001 going away — both are a browser saying so on the
        # way out rather than a socket that fell over.
        deliberate = closed.code in (1000, 1001)
    except Exception:
        # A broken socket must not take the app down — but it must not vanish
        # either. Swallowed silently, a bug in here looks exactly like a
        # player whose opponent went quiet: the other side sits waiting for a
        # message that was never going to come.
        logger.exception("live socket for %s failed", token)
    finally:
        live.leave_room(token, websocket)
        # Only once the seat has no socket left at all: a second tab closing
        # is not the player leaving.
        if color is not None and color not in live.present_seats(token):
            live.mark_away(token, color, deliberate=deliberate)
        # Whoever is left should see the seat go quiet rather than wait for a
        # move that is not coming — and start their countdown. Detached,
        # because this handler is being cancelled: awaiting it here would stop
        # at the first suspension point and the message would never go out.
        live.spawn(_broadcast_state(token))


def state_unavailable() -> dict:
    """The game was deleted between resolving it and reading it back — vanishingly
    unlikely, but the handshake still has to send something shaped like a state."""
    return {
        "token": "",
        "status": "finished",
        "result": "*",
        "end_reason": None,
        "moves": [],
        "fen": chess.STARTING_FEN,
        "turn": "white",
        "white": {"name": None, "seated": False, "present": False, "saves": False},
        "black": {"name": None, "seated": False, "present": False, "saves": False},
        "joinable": False,
        "draw_offer_from": None,
        "rematch_offer_from": None,
        "claim_wait": None,
    }


def _states_by_seat(token: str) -> dict[str | None, dict]:
    """One read, three views: the game as White sees it, as Black sees it, and
    as a spectator does. Presence carries the abandonment countdown, which is
    only ever one player's — so it cannot be one payload sent to everybody."""
    db = session_factory()
    try:
        game = live.get_by_token(db, token)
        if game is None:
            empty = state_unavailable()
            return {None: empty, "white": empty, "black": empty}
        return {
            seat: live.state_of(game, seat_color_=seat)
            for seat in (None, "white", "black")
        }
    finally:
        db.close()


async def _broadcast_state(token: str, *, exclude: WebSocket | None = None) -> None:
    states = await run_in_threadpool(_states_by_seat, token)
    await live.broadcast_per_seat(
        token,
        # `you` rides along with every state a client is sent, so that the one
        # thing it cannot re-derive — which of these two seats is its own —
        # never has to be remembered across a rematch's swap.
        {
            seat: {"type": "presence", "you": seat, "state": state}
            for seat, state in states.items()
        },
        exclude=exclude,
    )


async def _announce_saved(token: str) -> None:
    """Tell each player where their own review is. Sent per seat, never
    broadcast: it is one account's game number, and the other player has no
    business with it."""
    saved = await run_in_threadpool(_saved_games, token)
    for color, where in saved.items():
        await live.send_to_seat(token, color, {"type": "saved", **where})
