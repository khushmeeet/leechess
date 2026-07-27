"""Cross-language conformance for the rule-based motif detectors.

server/app/motifs.py (python-chess) and client/src/lib/liveMotifs.ts
(chess.js) are two implementations of one specification. The taxonomy AND the
case table live in shared/motifs.json; this module runs every case through the
Python detector and client/src/lib/motifParity.test.ts runs the same cases
through the TypeScript one. A detector that changes behaviour on either side
without the other fails here or there — comparing taxonomies alone cannot
catch semantic drift.
"""

import json
from pathlib import Path

import chess
import pytest

from app import motifs as motifs_module
from app.motifs import detect_motifs

pytestmark = pytest.mark.unit

SHARED = Path(__file__).resolve().parents[2] / "shared" / "motifs.json"
FIXTURES = json.loads(SHARED.read_text())
CASES = FIXTURES["cases"]

# Motif name constants the detector module actually exports — the taxonomy as
# the implementation defines it, not a hand-copied list.
DETECTOR_CONSTANTS = {
    motifs_module.BACK_RANK_MATE,
    motifs_module.DEFLECTION,
    motifs_module.DISCOVERED_ATTACK,
    motifs_module.DISCOVERED_CHECK,
    motifs_module.DOUBLE_CHECK,
    motifs_module.FORK,
    motifs_module.HANGING_PIECE,
    motifs_module.OVERLOADING,
    motifs_module.PIN,
    motifs_module.SKEWER,
    motifs_module.TRAPPED_PIECE,
    motifs_module.ZWISCHENZUG,
}


def test_taxonomy_matches_the_detectors_this_module_defines():
    assert DETECTOR_CONSTANTS == set(FIXTURES["taxonomy"])


def test_every_taxonomy_entry_is_exercised_by_a_positive_case():
    """A shared table nobody adds to is a table that stops proving anything:
    a new detector must arrive with a case, or this fails."""
    covered = {motif for case in CASES for motif in case["motifs"]}
    assert covered == set(FIXTURES["taxonomy"])


def test_every_taxonomy_entry_has_a_near_miss_case():
    """Positives alone validate an over-tagger. Every motif needs at least one
    position that looks like it and must NOT be tagged, so near-miss coverage
    is asserted here rather than trusted to review."""
    covered = {motif for case in CASES for motif in case.get("nearMissFor", [])}
    assert covered == set(FIXTURES["taxonomy"])


@pytest.mark.parametrize(
    "case", [c for c in CASES if c.get("nearMissFor")], ids=lambda c: c["id"]
)
def test_near_miss_declarations_agree_with_the_expected_motifs(case):
    """A case cannot claim to be a near miss for a motif it is expected to
    produce — that would let a mislabelled fixture satisfy the coverage check
    above without exercising anything."""
    assert not set(case["nearMissFor"]) & set(case["motifs"])


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["id"])
def test_case_move_is_legal(case):
    """detect_motifs documents legal-move input, and chess.Board.push does not
    validate — an illegal fixture move would push a nonsense position and
    "prove" whatever fell out of it. Both implementations must be fed the same
    reachable positions, so legality is asserted, not assumed."""
    board = chess.Board(case["fen"])
    assert board.status() == chess.STATUS_VALID
    assert chess.Move.from_uci(case["uci"]) in board.legal_moves


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["id"])
def test_detect_motifs_matches_the_shared_expectation(case):
    board = chess.Board(case["fen"])
    move = chess.Move.from_uci(case["uci"])
    assert detect_motifs(board, move) == set(case["motifs"])
