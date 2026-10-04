"""Pin down the move-grading rule.

The case table lives in shared/classification-cases.json and is run through
the client's classifyMove too (client/src/lib/classification.test.ts), so a
threshold change here that isn't mirrored there fails on the other side —
live badges and post-game review can never disagree.
"""

import json
from pathlib import Path

import pytest

from app.analysis import clamp_eval, classify_move, win_percent

pytestmark = pytest.mark.unit

SHARED = Path(__file__).resolve().parents[2] / "shared" / "classification-cases.json"
CASES = json.loads(SHARED.read_text())


@pytest.mark.parametrize("case", CASES["cases"], ids=lambda c: c["why"])
def test_classification(case):
    assert (
        classify_move(
            case["before"]["cp"],
            case["after"]["cp"],
            case["moverIsWhite"],
            played_is_best=case.get("playedIsBest", False),
            mate_before=case["before"].get("mate"),
            mate_after=case["after"].get("mate"),
            in_book=case.get("inBook", False),
        )
        == case["expected"]
    )


@pytest.mark.parametrize("case", CASES["clampCases"], ids=lambda c: c["why"])
def test_eval_clamp(case):
    assert clamp_eval(case["cp"]) == case["expected"]


@pytest.mark.parametrize("case", CASES["winPercentCases"], ids=lambda c: c["why"])
def test_win_percent(case):
    assert win_percent(case["cp"]) == pytest.approx(case["expected"], abs=1e-3)


def test_the_shared_table_covers_every_label_and_rule():
    """A conformance table is only as good as its coverage — if a label, a
    perspective or a rule silently drops out of the fixture, the parametrized
    tests above keep passing while proving less."""
    assert {case["expected"] for case in CASES["cases"]} == {
        "book",
        "best",
        "good",
        "inaccuracy",
        "mistake",
        "blunder",
    }
    assert {case["moverIsWhite"] for case in CASES["cases"]} == {True, False}
    assert any(case.get("playedIsBest") for case in CASES["cases"])
    assert any(case.get("inBook") for case in CASES["cases"])
    assert any("mate" in case["before"] for case in CASES["cases"])
    assert any("mate" in case["after"] for case in CASES["cases"])
