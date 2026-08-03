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
from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.websockets import WebSocketDisconnect

from app import live
from app.auth.backend import current_active_user_optional
from app.auth.models import User
from app.db import SessionLocal, get_db
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
_creates: dict[str, list[float]] = {}


def _rate_limit_create(request: Request) -> None:
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    recent = [at for at in _creates.get(key, []) if now - at < CREATE_WINDOW_SECONDS]
    if len(recent) >= MAX_CREATES_PER_WINDOW:
        raise HTTPException(
            status_code=429, detail="Too many games started — wait a minute."
        )
    recent.append(now)
    _creates[key] = recent


def reset_rate_limit() -> None:
    """Test support — module state outlives the app instance."""
    _creates.clear()


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
    db: Session = Depends(get_db),
) -> LiveStateOut:
    """The game as it stands. Open to anyone with the link — that is what
    makes it watchable — but a seat token is what adds the private parts."""
    game = _load(db, token)
    return LiveStateOut(**live.state_of(game, seat_color_=live.seat_color(game, seat)))


@router.post("/{token}/join", response_model=LiveSeated)
def join_live_game(
    token: str,
    payload: LiveJoin,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_active_user_optional),
) -> LiveSeated:
    """Take the open seat. 409 once both are taken — the caller watches
    instead, which the client handles without asking anything of them."""
    game = _load(db, token)
    try:
        seat, color = live.join_game(
            db, game, name=_display_name(user, payload.name), user_id=user.id if user else None
        )
    except live.LiveError as error:
        raise HTTPException(status_code=409, detail=str(error))
    return LiveSeated(
        token=game.token,
        seat=seat,
        color=color,
        state=LiveStateOut(**live.state_of(game, seat_color_=color)),
    )


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


def _apply(token: str, color: str, action: str, uci: str | None) -> tuple[dict, dict]:
    """Apply one action and return (event, state) for broadcast.

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
            else:
                raise live.LiveError(f"Unknown action {action!r}.")
            return event, live.state_of(game, seat_color_=color)
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
    await websocket.accept()
    resolved = await run_in_threadpool(_seat_of, token, seat)
    if resolved is MISSING:
        await websocket.send_json(
            {"type": "error", "message": "No game with that link."}
        )
        await websocket.close()
        return

    color = resolved
    # Joined before the state is read, so the handshake already carries this
    # socket's own presence — otherwise the first thing it received would be a
    # correction to the second thing it received.
    live.join_room(token, websocket, color)
    try:
        state = await run_in_threadpool(_state_only, token, seat)
        await websocket.send_json({"type": "state", "you": color, "state": state})
        if state["status"] == "finished":
            await _announce_saved(token)
        # Presence changed for everyone else the moment this socket opened.
        await _broadcast_state(token, exclude=websocket)

        while True:
            message = await websocket.receive_json()
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

            try:
                event, state = await run_in_threadpool(
                    _apply, token, color, action, message.get("uci")
                )
            except live.LiveError as error:
                # The mover's problem alone, and the state goes with it so a
                # client that had drifted is put back in step.
                fresh = await run_in_threadpool(_state_only, token, seat)
                await websocket.send_json(
                    {"type": "error", "message": str(error), "state": fresh}
                )
                continue

            await live.broadcast(token, {**event, "state": state})
            if state["status"] == "finished":
                await _announce_saved(token)
    except WebSocketDisconnect:
        pass
    except Exception:
        # A broken socket must not take the app down — but it must not vanish
        # either. Swallowed silently, a bug in here looks exactly like a
        # player whose opponent went quiet: the other side sits waiting for a
        # message that was never going to come.
        logger.exception("live socket for %s failed", token)
    finally:
        live.leave_room(token, websocket)
        # Whoever is left should see the seat go quiet rather than wait for a
        # move that is not coming.
        await _broadcast_state(token)


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
    }


async def _broadcast_state(token: str, *, exclude: WebSocket | None = None) -> None:
    fresh = await run_in_threadpool(_state_only, token, None)
    await live.broadcast(token, {"type": "presence", "state": fresh}, exclude=exclude)


async def _announce_saved(token: str) -> None:
    """Tell each player where their own review is. Sent per seat, never
    broadcast: it is one account's game number, and the other player has no
    business with it."""
    saved = await run_in_threadpool(_saved_games, token)
    for color, where in saved.items():
        await live.send_to_seat(token, color, {"type": "saved", **where})
