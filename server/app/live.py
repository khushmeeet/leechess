"""Play a friend over one shared link.

Three things live here: the rules of a live game (who may move, what ends
it), the in-memory hub that fans a move out to everyone watching, and the
fork that turns a finished live game into ordinary Game rows.

**One process, one hub.** Connections are a module-level dict, which is
correct for exactly the deployment this app has: one Fly machine
(`fly deploy --ha=false`), one uvicorn worker, no Redis — the same reasoning
app/auth/throttle.py spells out for its rate limiter. A second worker or a
second machine would split the two players of a game onto separate hubs and
they would silently stop seeing each other's moves. If this ever scales out,
this module is the thing that has to change.

**The database is the source of truth, not the hub.** Every move is committed
before it is broadcast, and the connect handshake replies with the whole move
list read back from the row. That is what makes a reconnect free: fly.toml
auto-stops the machine and a deploy replaces it, so sockets die between moves
as a matter of course, and the client only has to open a new one.
"""

import asyncio
import contextlib
import logging
import os
import secrets
import threading
from datetime import datetime, timedelta

import chess
import chess.pgn
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.websockets import WebSocket

from app.db import SessionLocal
from app.models import Game, LiveGame, Move, UserId, utcnow
from app.pgn import header_value

logger = logging.getLogger(__name__)

# Patchable in tests, exactly as app/analysis.py does it: the abandoned-game
# sweep runs from the lifespan, outside any request's session.
session_factory = SessionLocal

# How long an untouched live game is kept. A link nobody took up, or a game
# both players walked away from, is litter — and unlike a Game row it was
# never anybody's to look back at.
ABANDONED_AFTER = timedelta(days=2)

COLORS = ("white", "black")


class LiveError(Exception):
    """Something the caller did wrong: no seat, not their turn, illegal move.
    Carries the text the player is shown, so it is written for them."""


def new_token() -> str:
    """The share link's tail. Unguessable — it is the only thing standing
    between a private game and anyone who tries a URL."""
    return secrets.token_urlsafe(9)


def new_seat() -> str:
    return secrets.token_urlsafe(16)


# ── reading a live game ────────────────────────────────────────────────────


def move_list(game: LiveGame) -> list[str]:
    return game.moves_uci.split() if game.moves_uci else []


def board_of(game: LiveGame) -> chess.Board:
    """The live position, replayed from the stored move list.

    Illegal moves cannot be in there — every one of them was checked against
    this same replay before it was stored — so a failure here means the row
    was corrupted, and losing the tail is better than serving a position that
    never happened.
    """
    board = chess.Board()
    for uci in move_list(game):
        try:
            board.push_uci(uci)
        except ValueError:
            logger.error("live game %s has an illegal stored move %s", game.id, uci)
            break
    return board


def seat_color(game: LiveGame, seat: str | None) -> str | None:
    """Which side this credential may move, if any. None is a spectator —
    anyone who opened the link after both seats were taken."""
    if not seat:
        return None
    if game.white_seat and secrets.compare_digest(game.white_seat, seat):
        return "white"
    if game.black_seat and secrets.compare_digest(game.black_seat, seat):
        return "black"
    return None


def get_by_token(db: Session, token: str) -> LiveGame | None:
    return db.scalar(select(LiveGame).where(LiveGame.token == token))


def state_of(game: LiveGame, *, seat_color_: str | None = None) -> dict:
    """The payload every client renders from. `seat_color_` is the viewer's
    own side, and only adds things a spectator may not see."""
    board = board_of(game)
    offer = _draw_offers.get(game.token)
    return {
        "token": game.token,
        "status": game.status,
        "result": game.result,
        "end_reason": game.end_reason,
        "moves": move_list(game),
        "fen": board.fen(),
        "turn": "white" if board.turn == chess.WHITE else "black",
        "white": _seat_state(game, "white"),
        "black": _seat_state(game, "black"),
        "joinable": game.status == "waiting"
        and (game.white_seat is None or game.black_seat is None),
        # A draw offer is between the two players; a spectator has no part in
        # it and is not shown one.
        "draw_offer_from": offer if seat_color_ else None,
        # Seconds until this viewer may claim a game their opponent walked out
        # of; 0 means now, None means there is nothing to claim. Sent as a
        # remaining duration rather than a deadline so the two ends never have
        # to agree about what time it is — the client counts down from it, and
        # the server decides for real when the button is pressed.
        "claim_wait": (
            claim_wait_remaining(game, seat_color_) if seat_color_ else None
        ),
    }


def _seat_state(game: LiveGame, color: str) -> dict:
    return {
        "name": getattr(game, f"{color}_name"),
        "seated": getattr(game, f"{color}_seat") is not None,
        "present": color in present_seats(game.token),
        # Said out loud on the board, because it is the one thing that differs
        # between the two ways of playing and there is no second chance to
        # mention it: no account, no review.
        "saves": getattr(game, f"{color}_user_id") is not None,
    }


# ── starting and joining ───────────────────────────────────────────────────


def create_game(
    db: Session,
    *,
    color: str,
    name: str | None,
    user_id: UserId | None,
) -> tuple[LiveGame, str, str]:
    """Open a game with one seat taken. Returns the row, the creator's seat
    credential and the colour it belongs to."""
    if color == "random":
        color = secrets.choice(COLORS)
    seat = new_seat()
    game = LiveGame(token=new_token(), status="waiting")
    setattr(game, f"{color}_seat", seat)
    setattr(game, f"{color}_user_id", user_id)
    setattr(game, f"{color}_name", name)
    db.add(game)
    db.commit()
    return game, seat, color


def join_game(
    db: Session, game: LiveGame, *, name: str | None, user_id: UserId | None
) -> tuple[str, str]:
    """Take the open seat. Returns the credential and its colour.

    Whoever gets here first gets the seat — that is the whole invitation
    model, and it is why the token has to be unguessable.
    """
    if game.status == "finished":
        raise LiveError("That game is already over.")
    for color in COLORS:
        if getattr(game, f"{color}_seat") is None:
            seat = new_seat()
            setattr(game, f"{color}_seat", seat)
            setattr(game, f"{color}_user_id", user_id)
            setattr(game, f"{color}_name", name)
            game.status = "playing"
            game.last_activity_at = utcnow()
            db.commit()
            return seat, color
    raise LiveError("Both seats are taken — you can watch, but not play.")


# ── playing ────────────────────────────────────────────────────────────────


def apply_move(db: Session, game: LiveGame, color: str, uci: str) -> dict:
    """Validate one move against the server's own board and store it.

    Never trusts the client: the sender's seat has to own the side to move,
    and the move has to be legal in the position the *server* replayed. A
    client that has drifted (a dropped socket, a stale tab) gets an error and
    resynchronizes from the state it is sent back.
    """
    if game.status == "finished":
        raise LiveError("That game is already over.")
    if game.status != "playing":
        raise LiveError("Waiting for your opponent to join.")

    board = board_of(game)
    turn = "white" if board.turn == chess.WHITE else "black"
    if color != turn:
        raise LiveError("Not your turn.")

    try:
        move = chess.Move.from_uci(uci)
    except ValueError:
        raise LiveError(f"{uci} is not a move.")
    if move not in board.legal_moves:
        raise LiveError(f"{uci} is not legal here.")

    san = board.san(move)
    board.push(move)
    game.moves_uci = f"{game.moves_uci} {uci}".strip()
    game.last_activity_at = utcnow()
    # An offer stands only until the next move — playing on is the ordinary
    # way of saying no.
    _draw_offers.pop(game.token, None)

    if board.is_game_over():
        finish(db, game, board.result(), _outcome_reason(board))
    else:
        db.commit()

    return {
        "ply": len(move_list(game)),
        "san": san,
        "uci": uci,
        "fen": board.fen(),
        "turn": "white" if board.turn == chess.WHITE else "black",
    }


def _outcome_reason(board: chess.Board) -> str:
    if board.is_checkmate():
        return "checkmate"
    if board.is_stalemate():
        return "stalemate"
    if board.is_insufficient_material():
        return "insufficient material"
    return "draw"


def resign(db: Session, game: LiveGame, color: str) -> None:
    if game.status == "finished":
        raise LiveError("That game is already over.")
    finish(db, game, "0-1" if color == "white" else "1-0", "resignation")


def finish(db: Session, game: LiveGame, result: str, reason: str) -> None:
    """End the game and hand each signed-in seat its own saved copy."""
    game.status = "finished"
    game.result = result
    game.end_reason = reason
    forget(game.token)
    db.commit()
    fork_into_games(db, game)


def forget(token: str) -> None:
    """Drop the in-memory odds and ends belonging to one game.

    These two dicts are keyed on something an anonymous caller can mint at
    will (a game token), and nothing used to remove an `_away_since` entry
    except the player coming *back* — so a game that ended, or one the sweep
    deleted, left its countdown behind for the life of the process. Small
    individually; unbounded in aggregate, which on a 512mb machine is the
    only size that matters.

    Not `_rooms` or `_locks`: those are cleared by leave_room when the last
    socket goes, and a game that ends still has sockets open on it.
    """
    _draw_offers.pop(token, None)
    _away_since.pop(token, None)


# Draw offers live in memory, not in the row: an offer is a moment in a
# conversation between two open sockets, and one that survived a restart to be
# accepted an hour later would be a bug rather than a feature.
_draw_offers: dict[str, str] = {}


def offer_draw(game: LiveGame, color: str) -> None:
    if game.status != "playing":
        raise LiveError("There is no game to offer a draw in.")
    _draw_offers[game.token] = color


def draw_offer_from(game: LiveGame) -> str | None:
    return _draw_offers.get(game.token)


def accept_draw(db: Session, game: LiveGame, color: str) -> None:
    offer = _draw_offers.get(game.token)
    if offer is None or offer == color:
        raise LiveError("There is no draw offer to accept.")
    finish(db, game, "1/2-1/2", "agreement")


def decline_draw(game: LiveGame, color: str) -> None:
    if _draw_offers.get(game.token) not in (None, color):
        _draw_offers.pop(game.token, None)


# ── the opponent who walked off ────────────────────────────────────────────
#
# Without this there are only two ways out of a game your opponent left:
# resign, which records a loss you did not suffer, or walk away and let the
# sweep take it. So the player still at the board may claim the game once the
# other seat has been empty long enough.
#
# The two waits, and the gap between them, are Lichess's: leaving on purpose
# is answered in seconds, while a connection that dropped is given time to
# come back, because it usually does. Neither is scaled by material and there
# is no penalty for repeat offenders — both of those exist to protect a rating
# ladder, and there isn't one here. The only way to reach an opponent at all
# is a link you sent them yourself.

# Closed the tab, navigated away: they know they left.
DELIBERATE_LEAVE_GRACE = float(os.environ.get("LEECHESS_LEAVE_GRACE", "10"))
# The socket died on its own. Usually a tunnel, a sleeping laptop, or the Fly
# machine being replaced — all of which the client reconnects from by itself.
# Overridable so the browser suite can drive the whole flow in a second
# instead of sitting out a wait whose value is a unit test's business.
DISCONNECT_GRACE = float(os.environ.get("LEECHESS_DISCONNECT_GRACE", "40"))

# token → colour → (when the seat emptied, how long to wait). In memory with
# the rooms, because it describes connections rather than the game: a restart
# drops every socket anyway, and the clock restarts when somebody observes the
# seat is empty (see `note_absence`).
_away_since: dict[str, dict[str, tuple[datetime, float]]] = {}


def mark_away(token: str, color: str, *, deliberate: bool) -> None:
    """Start the clock on an empty seat."""
    grace = DELIBERATE_LEAVE_GRACE if deliberate else DISCONNECT_GRACE
    _away_since.setdefault(token, {})[color] = (utcnow(), grace)


def mark_present(token: str, color: str) -> None:
    """They came back. Someone who returns and leaves again gets the full
    wait over, which is the forgiving reading and the right one — a flapping
    connection is not the same as walking off."""
    seats = _away_since.get(token)
    if seats:
        seats.pop(color, None)
        if not seats:
            _away_since.pop(token, None)


def note_absence(token: str, color: str) -> None:
    """Start the clock on a seat that is already empty and has no record.

    The case this exists for is a restart: the hub is memory, so after one
    nobody is connected and nothing knows when anybody left. The first player
    back finds their opponent missing with no history, and counting from now
    is the honest answer — claiming instantly on the strength of a record that
    does not exist would take the game off somebody who was two seconds behind
    them in reconnecting.
    """
    if color in _away_since.get(token, {}):
        return
    mark_away(token, color, deliberate=False)


def claim_wait_remaining(game: LiveGame, color: str) -> float | None:
    """Seconds until `color` may claim the game, 0 when they already may.

    None when there is nothing to claim: the game is not running, or the
    opponent is at the board.
    """
    if game.status != "playing":
        return None
    # Nothing has been played, so there is no game to take. A seat that was
    # claimed a minute ago and never connected is a friend still reading the
    # link, not an opponent who walked off — and an unplayed game is aborted
    # rather than won, which is what the sweep does with it for free. This is
    # the one place the rule lives, so neither way of starting a clock has to
    # remember it.
    if not move_list(game):
        return None
    opponent = "black" if color == "white" else "white"
    if opponent in present_seats(game.token):
        return None
    away = _away_since.get(game.token, {}).get(opponent)
    if away is None:
        return None
    since, grace = away
    return max(0.0, grace - (utcnow() - since).total_seconds())


def claim_abandoned(db: Session, game: LiveGame, color: str) -> None:
    """Take the game your opponent left. Re-checked here rather than trusted
    from the client: the countdown they watched is a convenience, and this is
    the thing that decides."""
    remaining = claim_wait_remaining(game, color)
    if remaining is None:
        raise LiveError("Your opponent is still at the board.")
    if remaining > 0:
        raise LiveError(f"Wait {int(remaining) + 1}s before claiming.")
    finish(db, game, "1-0" if color == "white" else "0-1", "abandonment")


# ── ending: one saved game per signed-in seat ──────────────────────────────


def fork_into_games(db: Session, live: LiveGame) -> dict[str, Game]:
    """Turn a finished live game into ordinary Game rows — one per seat that
    had an account behind it.

    Two rows rather than one shared row, because everything downstream of a
    Game assumes a single owner: the review list filters on `user_id`, the
    game number counts that account's games, puzzles are generated for the
    person who blundered, and the CPL trend charts one player's mistakes.
    Giving each player their own row with their own `user_color` means none of
    that had to learn what a second player is.

    A seat with no account gets nothing at all, which is the same bargain
    anonymous play has always made: the game happened, and that is all.
    Idempotent — a second call (a reconnect racing the final move) returns the
    rows already made.
    """
    from app.analysis import run_game_analysis
    from app.routers.games import next_game_number

    created: dict[str, Game] = {}
    board = board_of(live)
    white_name = live.white_name or "White"
    black_name = live.black_name or "Black"

    for color in COLORS:
        user_id = getattr(live, f"{color}_user_id")
        if user_id is None:
            continue
        existing_id = getattr(live, f"{color}_game_id")
        if existing_id is not None:
            existing = db.get(Game, existing_id)
            if existing is not None:
                created[color] = existing
                continue
        if not move_list(live):
            continue  # a game with no moves is not one to look back at

        game = Game(
            pgn="",
            white=white_name,
            black=black_name,
            result=live.result,
            mode="online",
            user_color=color,
            user_id=user_id,
            analysis_status="analyzing",
        )
        replay = chess.Board()
        for ply, uci in enumerate(move_list(live), start=1):
            fen_before = replay.fen()
            move = chess.Move.from_uci(uci)
            san = replay.san(move)
            replay.push(move)
            game.moves.append(
                Move(ply=ply, san=san, fen_before=fen_before, fen_after=replay.fen())
            )
        game.pgn = _pgn_of(board, white_name, black_name, live.result)
        game.number = next_game_number(db, user_id)
        db.add(game)
        db.commit()
        setattr(live, f"{color}_game_id", game.id)
        created[color] = game

    if created:
        db.commit()
    # Queued after the commit, so the job cannot start on a row that is not
    # there yet. Each player gets their own analysis: the positions are the
    # same but the moves being judged are not, and the engine cost of a second
    # pass is cheaper than teaching the pipeline to share.
    for game in created.values():
        _queue_analysis(run_game_analysis, game.id)
    return created


def _pgn_of(board: chess.Board, white: str, black: str, result: str) -> str:
    pgn = chess.pgn.Game.from_board(board)
    pgn.headers["Event"] = "leechess friend game"
    # Escaped, because in a friend game one of these names was typed by
    # somebody with no account into a join form, and python-chess writes header
    # values through unaltered — a name carrying `"]` and a newline used to
    # smuggle a forged [Result] into the *other* player's saved game.
    pgn.headers["White"] = header_value(white, fallback="White")
    pgn.headers["Black"] = header_value(black, fallback="Black")
    pgn.headers["Result"] = result
    pgn.headers["Date"] = utcnow().strftime("%Y.%m.%d")
    return str(pgn)


def _queue_analysis(run, game_id: int) -> None:
    """Run the analysis job off the event loop.

    A live game ends inside a WebSocket handler, where BackgroundTasks (how
    the REST completion path queues this) is not available — and the job is a
    blocking, engine-bound function, so it must not run on the loop itself.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        run(game_id)  # no loop (tests, sync callers): just do it
        return
    loop.run_in_executor(None, run, game_id)


# ── the hub ────────────────────────────────────────────────────────────────

# token → open sockets. Spectators are in here too (with no colour), which is
# what makes a shared link watchable. Keyed by the token rather than the row
# id so that a caller holding only the link — which is everything the socket
# layer is given — never has to read the database to reach the room.
_rooms: dict[str, dict[WebSocket, str | None]] = {}
# One lock per game, so two players moving at the same instant are applied in
# some order rather than both reading the same board and both writing to it.
#
# A threading lock, not an asyncio one, for two reasons. It is held around the
# database work, which runs in a worker thread rather than on the event loop.
# And an asyncio.Lock binds itself to whichever loop first awaited it — under
# one uvicorn worker there is only ever one loop, so that flaw is invisible in
# production and a deadlock the moment there is a second (the test client
# gives every socket a loop of its own, which is how this was found).
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def lock_for(token: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(token, threading.Lock())


def room_size(token: str) -> int:
    return len(_rooms.get(token, ()))


def total_sockets() -> int:
    return sum(len(room) for room in _rooms.values())


def present_seats(token: str) -> set[str]:
    """Which sides have a socket open right now. Presence, not membership —
    a seat is held by its token, not by its connection."""
    return {color for color in _rooms.get(token, {}).values() if color}


def join_room(token: str, socket: WebSocket, color: str | None) -> None:
    _rooms.setdefault(token, {})[socket] = color


def leave_room(token: str, socket: WebSocket) -> None:
    room = _rooms.get(token)
    if room is None:
        return
    room.pop(socket, None)
    if not room:
        _rooms.pop(token, None)
        with _locks_guard:
            _locks.pop(token, None)


async def broadcast(
    token: str, message: dict, *, exclude: WebSocket | None = None
) -> None:
    """Send to everyone watching. A socket that fails is dropped rather than
    retried: the client reconnects, and a dead peer must not be able to hold
    up the move for the live one.

    `exclude` is for the connect handshake, which has already told that one
    socket everything this message would — sending it anyway would put a
    message it did not ask for in front of the first one it did.
    """
    for socket in list(_rooms.get(token, {})):
        if socket is exclude:
            continue
        try:
            await socket.send_json(message)
        except Exception:
            # Logged, not silent: to the player on the other end this is
            # indistinguishable from an opponent who stopped moving, and a
            # dropped peer should not be something only they find out about.
            logger.warning("dropping a dead socket on live game %s", token)
            leave_room(token, socket)
            with contextlib.suppress(Exception):
                await socket.close()


async def broadcast_per_seat(
    token: str, message_for: dict[str | None, dict], *, exclude: WebSocket | None = None
) -> None:
    """Send everyone in the room the version of a message meant for them.

    Presence needs this: the same event tells one player their opponent is
    gone and how long until the game is theirs to claim, and tells a spectator
    only that a seat went quiet. Keyed by seat colour, with None for the
    watchers.
    """
    for socket, seat in list(_rooms.get(token, {}).items()):
        if socket is exclude:
            continue
        try:
            await socket.send_json(message_for[seat])
        except Exception:
            logger.warning("dropping a dead socket on live game %s", token)
            leave_room(token, socket)
            with contextlib.suppress(Exception):
                await socket.close()


async def send_to_seat(token: str, color: str, message: dict) -> None:
    """For the things that are one player's business alone — where their
    saved game landed, whose draw offer is waiting."""
    for socket, seat in list(_rooms.get(token, {}).items()):
        if seat != color:
            continue
        try:
            await socket.send_json(message)
        except Exception:
            logger.warning("dropping a dead socket on live game %s", token)
            leave_room(token, socket)


# Detached work, held here only so the loop keeps a strong reference — a task
# nobody holds can be garbage-collected mid-flight.
_detached: set[asyncio.Task] = set()


def spawn(coro) -> None:
    """Run something to completion independently of the caller's task.

    This exists for one job: telling the other player that a socket closed.
    That has to happen while the handler it belongs to is being torn down,
    and a disconnect *cancels* that handler — so an `await` in its `finally`
    (the state read is one) is a cancellation point the teardown never gets
    past. The message would simply never be sent, and the player still at the
    board would sit waiting for a move from someone who had already gone,
    with no countdown and nothing to claim.
    """
    try:
        task = asyncio.get_running_loop().create_task(coro)
    except RuntimeError:  # no loop (sync callers, tests): nothing to detach to
        coro.close()
        return
    _detached.add(task)
    task.add_done_callback(_detached.discard)


def reset_rooms() -> None:
    """Test support: module state outlives the app instance."""
    _rooms.clear()
    with _locks_guard:
        _locks.clear()
    _draw_offers.clear()
    _away_since.clear()


# ── housekeeping ───────────────────────────────────────────────────────────


def sweep_abandoned() -> int:
    """Delete live games nobody has touched in a while.

    A finished one has already been forked into whatever Game rows it earned,
    so the row itself is spent; an unfinished one is a link that went nowhere.
    Neither is anybody's history — that is what the Game rows are for.
    """
    db = session_factory()
    try:
        cutoff = utcnow() - ABANDONED_AFTER
        stale = list(
            db.scalars(select(LiveGame).where(LiveGame.last_activity_at < cutoff))
        )
        for game in stale:
            # A game with moves in it is somebody's, finished or not. Both
            # players walking away is not a reason to destroy what they
            # played, so a signed-in seat gets its copy here before the row
            # goes — the alternative is an account quietly losing a game it
            # played, which is the opposite of what an account is for.
            #
            # The result stays "*". Nobody won an abandoned game, and writing
            # one in would put a result in a review that never happened.
            if game.status != "finished" and move_list(game):
                game.status = "finished"
                game.end_reason = "abandoned"
                db.commit()
                fork_into_games(db, game)
            forget(game.token)
            db.delete(game)
        db.commit()
        if stale:
            logger.info("swept %d abandoned live game(s)", len(stale))
        return len(stale)
    finally:
        db.close()
