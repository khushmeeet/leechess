"""Leitner-box transition function — pure logic, no engine, no DB."""

from datetime import datetime, timezone

import pytest

from app.spaced_repetition import (
    BOX_INTERVALS,
    MAX_BOX,
    MIN_BOX,
    next_box,
    schedule_attempt,
)

pytestmark = pytest.mark.unit

NOW = datetime(2026, 7, 6, 12, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    ("box", "correct", "hint_level", "expected"),
    [
        # first-ever attempt: new puzzles start in box 1
        (1, True, 0, 2),
        (1, False, 0, 1),
        # correct advances one box at a time
        (2, True, 0, 3),
        (4, True, 0, 5),
        # box already at max: correct keeps it there
        (MAX_BOX, True, 0, MAX_BOX),
        # wrong answer resets to box 1 from anywhere
        (2, False, 0, 1),
        (MAX_BOX, False, 0, 1),
        # hint levels below the move-reveal threshold still count as solved
        (2, True, 3, 3),
        # solved with the move revealed (level >= 4): no advance, no reset
        (2, True, 4, 2),
        (3, True, 5, 3),
        # ...and a wrong answer resets regardless of hints used
        (3, False, 5, 1),
    ],
)
def test_next_box(box: int, correct: bool, hint_level: int, expected: int):
    assert next_box(box, correct, hint_level) == expected


def test_schedule_pushes_due_date_by_the_new_box_interval():
    new_box, due_at = schedule_attempt(1, correct=True, hint_level_used=0, now=NOW)
    assert new_box == 2
    assert due_at == NOW + BOX_INTERVALS[2]


def test_wrong_answer_is_due_again_soon():
    new_box, due_at = schedule_attempt(4, correct=False, hint_level_used=0, now=NOW)
    assert new_box == MIN_BOX
    assert due_at == NOW + BOX_INTERVALS[MIN_BOX]
    # "soon" means within the hour, not tomorrow
    assert (due_at - NOW).total_seconds() < 3600


def test_intervals_grow_with_the_box():
    intervals = [BOX_INTERVALS[box] for box in range(MIN_BOX, MAX_BOX + 1)]
    assert intervals == sorted(intervals)
    assert len(set(intervals)) == len(intervals)
