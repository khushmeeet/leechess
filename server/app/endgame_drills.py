"""The curated endgame-drill catalog.

Unlike puzzles, a drill is played out to the end against full-strength
Stockfish and graded on the *result* — "you converted the win" / "you held the
draw" — not on matching a stored line. Rook endings have too many winning move
orders for move matching to say anything useful, and the interesting failure is
throwing the win away ten moves in.

Every position here was verified against Stockfish (see the engine-marked test
in tests/test_endgame_drills.py): a `win` drill must be winning for
`player_color`, a `draw` drill must evaluate near zero. A mistyped FEN that
quietly makes a drill unwinnable is the failure mode that test exists to catch.

Seeding is insert-if-missing on `key`, so editing a blurb here and restarting
updates nothing — but adding a drill picks it up, and no restart ever resets
the Leitner state of drills already in the table.
"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import EndgameDrill

# Patchable in tests so the startup seed writes to the test database.
session_factory = SessionLocal

# Family slugs — also the ?family= filter values and the grouping used by the
# weakest-family selection order.
KP_KEY_SQUARES = "kp-key-squares"
LUCENA = "lucena"
PHILIDOR = "philidor"
ROOK_PAWN = "rook-pawn-conversion"

FAMILY_NAMES: dict[str, str] = {
    KP_KEY_SQUARES: "King and pawn — key squares",
    LUCENA: "Lucena — building the bridge",
    PHILIDOR: "Philidor — third-rank defense",
    ROOK_PAWN: "Rook and pawn — conversion",
}


@dataclass(frozen=True)
class DrillDefinition:
    key: str
    family: str
    name: str
    fen: str
    player_color: str  # the side the user plays
    goal: str  # "win" (convert) or "draw" (hold)
    technique: str  # one-line prompt shown beside the board


CATALOG: list[DrillDefinition] = [
    # --- King and pawn ---------------------------------------------------
    DrillDefinition(
        key="kp-key-squares-convert",
        family=KP_KEY_SQUARES,
        name="King in front of the pawn",
        fen="2k5/8/2K5/2P5/8/8/8/8 w - - 0 1",
        player_color="white",
        goal="win",
        technique=(
            "Your king already stands on a key square. Take the opposition "
            "before pushing — the pawn advances last, never first."
        ),
    ),
    DrillDefinition(
        key="kp-key-squares-outflank",
        family=KP_KEY_SQUARES,
        name="Walk the king to the key squares",
        fen="8/8/8/3k4/8/3K4/3P4/8 b - - 0 1",
        player_color="white",
        goal="win",
        technique=(
            "The pawn is far from home and the king must lead it. Win the "
            "opposition first, then outflank — the key squares are d6, e6, f6 "
            "once the pawn reaches d5."
        ),
    ),
    DrillDefinition(
        key="kp-opposition-hold",
        family=KP_KEY_SQUARES,
        name="Hold with the opposition",
        fen="3k4/8/8/3K4/3P4/8/8/8 b - - 0 1",
        player_color="black",
        goal="draw",
        technique=(
            "Step straight in front of the pawn and take the opposition. Any "
            "other square loses — this is one move wide."
        ),
    ),
    DrillDefinition(
        key="kp-rook-pawn-hold",
        family=KP_KEY_SQUARES,
        name="The rook pawn's drawn corner",
        fen="k7/8/1K6/P7/8/8/8/8 b - - 0 1",
        player_color="black",
        goal="draw",
        technique=(
            "A rook pawn draws if you reach the corner. Stay on a8/b8 and "
            "shuffle — the attacking king can never both guard the queening "
            "square and evict you."
        ),
    ),
    # --- Lucena ----------------------------------------------------------
    DrillDefinition(
        key="lucena-bridge",
        family=LUCENA,
        name="Lucena — the classic bridge",
        fen="2K5/k1P5/8/8/8/8/3R4/7r w - - 0 1",
        player_color="white",
        goal="win",
        technique=(
            "Your king is stuck in front of its own pawn. Play Rd4 first — the "
            "rook on the fourth rank becomes the shield that blocks the checks "
            "once your king steps out toward it."
        ),
    ),
    DrillDefinition(
        key="lucena-e-pawn",
        family=LUCENA,
        name="Lucena — e-pawn, king cut off",
        fen="4K3/2k1P3/8/8/8/8/5R2/r7 w - - 0 1",
        player_color="white",
        goal="win",
        technique=(
            "Same bridge, mirrored, and the enemy king is cut off on the short "
            "side. Get your king out from in front of the pawn without letting "
            "the checks become perpetual."
        ),
    ),
    # --- Philidor --------------------------------------------------------
    DrillDefinition(
        key="philidor-third-rank",
        family=PHILIDOR,
        name="Philidor — third-rank defense",
        fen="8/4k3/r7/3KP3/8/8/8/7R b - - 0 1",
        player_color="black",
        goal="draw",
        technique=(
            "Hold your rook on the sixth rank so the white king can never "
            "cross it. The moment the pawn advances to e6, drop the rook to "
            "the first rank and check from behind."
        ),
    ),
    DrillDefinition(
        key="philidor-king-behind",
        family=PHILIDOR,
        name="Philidor — pawn ahead of the king",
        fen="8/4k3/r7/4P3/4K3/8/8/7R b - - 0 1",
        player_color="black",
        goal="draw",
        technique=(
            "The pawn is already on e5 with its king behind it. Same recipe: "
            "sixth rank until the pawn commits, then checks from long range."
        ),
    ),
    # --- Rook and pawn conversion ----------------------------------------
    DrillDefinition(
        key="rook-pawn-cut-off",
        family=ROOK_PAWN,
        name="Cut the king off and escort",
        fen="r7/4k3/2K5/2P5/8/8/8/1R6 w - - 0 1",
        player_color="white",
        goal="win",
        technique=(
            "Your rook cuts the black king off from the pawn. Keep it cut off "
            "— walk the king and pawn up together and don't trade the cut for "
            "a tempo."
        ),
    ),
    DrillDefinition(
        key="rook-two-pawns",
        family=ROOK_PAWN,
        name="Convert two connected pawns",
        fen="r5k1/8/8/8/6PP/8/6K1/3R4 w - - 0 1",
        player_color="white",
        goal="win",
        technique=(
            "Two healthy passers against none. Activity first: put the rook "
            "behind the pawns and bring the king up before pushing."
        ),
    ),
    DrillDefinition(
        key="rook-pawn-vancura",
        family=ROOK_PAWN,
        name="Vancura — hold against the a-pawn",
        fen="8/5k2/5r2/8/8/P7/K7/1R6 b - - 0 1",
        player_color="black",
        goal="draw",
        technique=(
            "Don't sit passively in front of the pawn. Attack it from the side "
            "along the sixth rank, keeping your rook free to check — that is "
            "the Vancura draw."
        ),
    ),
]


def seed_drills(db: Session) -> int:
    """Insert catalog entries the table doesn't have yet, keyed on `key`.

    Existing rows are left alone so a restart never resets the box or due date
    of a drill the user has been practising. Returns how many were added.
    """
    known = set(db.scalars(select(EndgameDrill.key)))
    added = 0
    for definition in CATALOG:
        if definition.key in known:
            continue
        db.add(
            EndgameDrill(
                key=definition.key,
                family=definition.family,
                name=definition.name,
                fen=definition.fen,
                player_color=definition.player_color,
                goal=definition.goal,
                technique=definition.technique,
            )
        )
        added += 1
    if added:
        db.commit()
    return added


def seed_catalog() -> int:
    """Startup hook: the catalog is a dozen rows, so this runs inline rather
    than on a background thread like the Lichess puzzle-pool seed."""
    db = session_factory()
    try:
        return seed_drills(db)
    finally:
        db.close()
