"""Pin down the eval-delta → classification thresholds.

These values are mirrored client-side (client/src/lib/classification.ts) so
live badges and post-game review agree — if this table changes, change the
client to match.
"""

import pytest

from app.analysis import clamp_eval, classify_move

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    ("eval_before", "eval_after", "mover_is_white", "expected"),
    [
        # White's perspective: loss = eval_before - eval_after.
        (50, 50, True, "best"),  # no loss
        (50, 55, True, "best"),  # gained eval (engine wobble)
        (50, 41, True, "best"),  # loss 9  < 10
        (50, 40, True, "good"),  # loss 10 — boundary is exclusive for "best"
        (50, 26, True, "good"),  # loss 24
        (50, 25, True, "inaccuracy"),  # loss 25
        (50, 1, True, "inaccuracy"),  # loss 49
        (50, 0, True, "mistake"),  # loss 50
        (50, -49, True, "mistake"),  # loss 99
        (50, -50, True, "blunder"),  # loss 100
        (200, -800, True, "blunder"),  # loss 1000
        # Black's perspective: loss = eval_after - eval_before.
        (-50, -41, False, "best"),  # loss 9
        (-50, -25, False, "inaccuracy"),  # loss 25
        (0, 100, False, "blunder"),  # loss 100
        (0, -100, False, "best"),  # black gained
    ],
)
def test_classification_thresholds(eval_before, eval_after, mover_is_white, expected):
    assert classify_move(eval_before, eval_after, mover_is_white) == expected


def test_engine_best_move_always_classifies_best():
    # Even when eval wobbles between searches, playing the engine's own
    # choice must not be labelled a mistake.
    assert classify_move(50, -30, True, played_is_best=True) == "best"


def test_eval_clamp():
    assert clamp_eval(99_994) == 1000  # mate scores hit the clamp
    assert clamp_eval(-99_994) == -1000
    assert clamp_eval(37) == 37
