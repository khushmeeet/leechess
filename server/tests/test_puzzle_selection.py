"""GET /puzzles/next stacks several priority rules (due personal → weakest
motif → generic fallback) — exactly the kind of logic that's easy to get
subtly wrong, so each rule gets a seeded-DB test of its own."""

from datetime import datetime, timedelta, timezone

import chess
import pytest
from sqlalchemy import select

from app.models import Game, Move, Puzzle, PuzzleAttempt
from app.spaced_repetition import BOX_INTERVALS

pytestmark = pytest.mark.unit

FEN = chess.STARTING_FEN


def past() -> datetime:
    return datetime.now(timezone.utc) - timedelta(hours=1)


def future() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=2)


@pytest.fixture()
def seed(db_session):
    """Factory for personal/generic puzzles and attempt history. Personal
    puzzles hang off one real stored move so source_move_id is genuine."""
    game = Game(pgn="", analysis_status="complete")
    move = Move(ply=1, san="e4", fen_before=FEN, fen_after=FEN)
    game.moves.append(move)
    db_session.add(game)

    class Seed:
        def personal(self, motif: str, due_at: datetime | None = None) -> Puzzle:
            puzzle = Puzzle(
                source_move=move, fen=FEN, solution="e2e4", motif=motif,
                due_at=due_at or past(),
            )  # fmt: skip
            db_session.add(puzzle)
            db_session.commit()
            return puzzle

        def generic(
            self, motif: str, difficulty: int = 1200, due_at: datetime | None = None
        ) -> Puzzle:
            puzzle = Puzzle(
                fen=FEN, solution="e2e4", motif=motif, difficulty=difficulty,
                due_at=due_at or past(),
            )  # fmt: skip
            db_session.add(puzzle)
            db_session.commit()
            return puzzle

        def attempts(self, puzzle: Puzzle, *results: bool) -> None:
            """Attempt history only — doesn't touch the puzzle's due date."""
            for correct in results:
                puzzle.attempts.append(PuzzleAttempt(correct=correct))
            db_session.commit()

    return Seed()


def next_id(client, motif: str | None = None) -> int:
    url = f"/puzzles/next?motif={motif}" if motif else "/puzzles/next"
    response = client.get(url)
    assert response.status_code == 200, response.text
    return response.json()["id"]


def test_due_personal_puzzle_beats_generic(client, seed):
    personal = seed.personal("fork")
    seed.generic("fork")

    body = client.get("/puzzles/next").json()
    assert body["id"] == personal.id
    assert body["source_move_id"] is not None
    assert body["solution"] == ["e2e4"]  # served as a list, stored as string


def test_generic_fallback_when_no_personal_puzzle_is_due(client, seed):
    seed.personal("fork", due_at=future())
    generic = seed.generic("fork")
    assert next_id(client) == generic.id


def test_weakest_motif_comes_first_among_due_personals(client, seed):
    fork = seed.personal("fork")
    pin = seed.personal("pin")
    seed.attempts(fork, True, True)  # fork: recently solid
    seed.attempts(pin, True, False, False)  # pin: struggling

    assert next_id(client) == pin.id


def test_unattempted_motif_counts_as_weakest(client, seed):
    fork = seed.personal("fork")
    seed.attempts(fork, True)
    skewer = seed.personal("skewer")  # never attempted → nothing proven

    assert next_id(client) == skewer.id


def test_generic_fallback_prefers_the_weak_motif_too(client, seed):
    strong = seed.generic("fork")
    weak = seed.generic("pin")
    seed.attempts(strong, True, True)
    seed.attempts(weak, False)

    assert next_id(client) == weak.id


def test_generic_ties_break_by_lowest_difficulty(client, seed):
    seed.generic("fork", difficulty=1800)
    easy = seed.generic("fork", difficulty=900)
    assert next_id(client) == easy.id


def test_motif_filter_overrides_weakness_ordering(client, seed):
    fork = seed.personal("fork")
    pin = seed.personal("pin")
    seed.attempts(fork, True)
    seed.attempts(pin, False)  # pin is weaker, but the filter asks for fork

    assert next_id(client, motif="fork") == fork.id
    assert client.get("/puzzles/next?motif=back_rank_mate").status_code == 404


def test_404_when_nothing_is_due(client, seed):
    seed.personal("fork", due_at=future())
    assert client.get("/puzzles/next").status_code == 404


# --- attempts: recording + Leitner scheduling through the API ---


def test_correct_attempt_advances_the_box_and_reschedules(client, seed):
    puzzle = seed.personal("fork")

    response = client.post(
        f"/puzzles/{puzzle.id}/attempt", json={"correct": True, "hint_level_used": 2}
    )
    assert response.status_code == 201
    body = response.json()
    assert body["correct"] is True
    assert body["box"] == 2

    # the puzzle is no longer due, so the queue moves on
    assert client.get("/puzzles/next").status_code == 404
    detail = client.get(f"/puzzles/{puzzle.id}").json()
    assert [a["correct"] for a in detail["attempts"]] == [True]


def test_wrong_attempt_resets_to_box_one_due_soon(client, seed, db_session):
    puzzle = seed.personal("fork")
    puzzle.box = 4
    db_session.commit()

    body = client.post(
        f"/puzzles/{puzzle.id}/attempt", json={"correct": False}
    ).json()
    assert body["box"] == 1

    db_session.expire_all()
    naive_now = datetime.now(timezone.utc).replace(tzinfo=None)
    assert puzzle.due_at <= naive_now + BOX_INTERVALS[1]


def test_revealed_answer_keeps_the_box(client, seed):
    puzzle = seed.personal("fork")
    body = client.post(
        f"/puzzles/{puzzle.id}/attempt", json={"correct": True, "hint_level_used": 4}
    ).json()
    assert body["box"] == 1  # solved, but the move was shown — no advance


def test_attempt_on_unknown_puzzle_404s(client):
    assert client.post("/puzzles/999/attempt", json={"correct": True}).status_code == 404


def test_attempts_accumulate_per_puzzle(client, seed, db_session):
    puzzle = seed.personal("fork")
    client.post(f"/puzzles/{puzzle.id}/attempt", json={"correct": False})
    client.post(f"/puzzles/{puzzle.id}/attempt", json={"correct": True})

    stored = db_session.scalars(
        select(PuzzleAttempt).where(PuzzleAttempt.puzzle_id == puzzle.id)
    ).all()
    assert [a.correct for a in stored] == [False, True]
