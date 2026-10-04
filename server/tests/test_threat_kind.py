"""The Python port of classifyThreat (app/threats.py::threat_kind), run on
the same table as the client's (shared/threats.json)."""

import json
from pathlib import Path

import chess
import pytest

from app.threats import best_capture_gain, static_exchange, threat_kind

pytestmark = pytest.mark.unit

SHARED = Path(__file__).resolve().parents[2] / "shared" / "threats.json"
TABLE = json.loads(SHARED.read_text())


@pytest.mark.parametrize("case", TABLE["cases"], ids=lambda c: c["id"])
def test_threat_kind(case):
    current = case["currentScore"] or {}
    assert (
        threat_kind(
            case["fen"],
            case["threatUci"],
            case["threatScore"].get("cp"),
            case["threatScore"].get("mate"),
            current.get("cp"),
            current.get("mate"),
        )
        == case["kind"]
    )


@pytest.mark.parametrize("case", TABLE["exchangeCases"], ids=lambda c: c["id"])
def test_static_exchange(case):
    board = chess.Board(case["fen"])
    assert (
        static_exchange(
            board, chess.parse_square(case["from"]), chess.parse_square(case["to"])
        )
        == case["expected"]
    )


def test_best_capture_gain():
    assert best_capture_gain(chess.Board("6k1/5ppp/8/3n4/4P3/8/5PPP/6K1 w - - 0 1")) == 3
    assert best_capture_gain(chess.Board()) == 0


def test_the_table_covers_every_kind():
    assert {case["kind"] for case in TABLE["cases"]} == {
        "mate",
        "material",
        "motif",
        "attack",
        None,
    }
