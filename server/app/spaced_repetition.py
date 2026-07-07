"""Leitner-box spaced repetition (Phase 3 — deliberately not SM-2).

Boxes run 1..5. A correct answer advances one box and pushes the due date
out by the new box's interval; a wrong answer resets to box 1 (due again
soon). One extra rule: a "correct" answer given after the ladder revealed
the move (hint level >= 4) keeps its box — recognizing the answer isn't
retrieving it, but it shouldn't punish using the ladder either.
"""

from datetime import datetime, timedelta

MIN_BOX = 1
MAX_BOX = 5

# How far out a puzzle is scheduled once it lands in a box.
BOX_INTERVALS: dict[int, timedelta] = {
    1: timedelta(minutes=10),
    2: timedelta(days=1),
    3: timedelta(days=3),
    4: timedelta(days=7),
    5: timedelta(days=21),
}

# Ladder level at which the move itself is shown (Level 4: move + reason).
REVEALING_HINT_LEVEL = 4


def next_box(box: int, correct: bool, hint_level_used: int = 0) -> int:
    if not correct:
        return MIN_BOX
    if hint_level_used >= REVEALING_HINT_LEVEL:
        return max(MIN_BOX, min(box, MAX_BOX))
    return max(MIN_BOX, min(box + 1, MAX_BOX))


def schedule_attempt(
    box: int, correct: bool, hint_level_used: int, now: datetime
) -> tuple[int, datetime]:
    """The (new_box, due_at) a puzzle moves to after one attempt."""
    new_box = next_box(box, correct, hint_level_used)
    return new_box, now + BOX_INTERVALS[new_box]
