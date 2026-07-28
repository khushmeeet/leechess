"""Pin down the eval-delta → classification thresholds.

The case table lives in shared/classification-cases.json and is run through
the client's classifyMove too (client/src/lib/classification.test.ts), so a
threshold change here that isn't mirrored there fails on the other side —
live badges and post-game review can never disagree.
"""

import json
from pathlib import Path

import pytest

from app.analysis import clamp_eval, classify_move

pytestmark = pytest.mark.unit

SHARED = Path(__file__).resolve().parents[2] / "shared" / "classification-cases.json"
CASES = json.loads(SHARED.read_text())


@pytest.mark.parametrize("case", CASES["cases"], ids=lambda c: c["why"])
def test_classification_thresholds(case):
    assert (
        classify_move(
            case["evalBefore"],
            case["evalAfter"],
            case["moverIsWhite"],
            played_is_best=case.get("playedIsBest", False),
        )
        == case["expected"]
    )


@pytest.mark.parametrize("case", CASES["clampCases"], ids=lambda c: c["why"])
def test_eval_clamp(case):
    assert clamp_eval(case["cp"]) == case["expected"]


def test_the_shared_table_covers_every_label_in_both_directions():
    """A conformance table is only as good as its coverage — if a label or a
    perspective silently drops out of the fixture, the parametrized tests above
    keep passing while proving less."""
    assert {case["expected"] for case in CASES["cases"]} == {
        "best",
        "good",
        "inaccuracy",
        "mistake",
        "blunder",
    }
    assert {case["moverIsWhite"] for case in CASES["cases"]} == {True, False}
    assert any(case.get("playedIsBest") for case in CASES["cases"])
