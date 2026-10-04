"""Think first results: recorded per account, counted on Progress."""

from datetime import datetime, timedelta, timezone

import pytest

from app.models import CriticalMoment

pytestmark = pytest.mark.unit

FEN = "r1b3rk/pp3p1p/2n2p2/3p1B2/P4q2/1P5P/2QN1PP1/2R2RK1 w - - 5 21"


def moment(client, **overrides):
    body = {
        "fen": FEN,
        "found": True,
        "had_threat": True,
        "answered_threat": True,
        "candidates": 3,
        **overrides,
    }
    return client.post("/thinking/moments", json=body)


def test_a_moment_is_recorded_for_the_signed_in_account(
    client, db_session, signed_in_user
):
    response = moment(client)
    assert response.status_code == 201
    stored = db_session.get(CriticalMoment, response.json()["id"])
    assert stored.user_id == signed_in_user.id
    assert (stored.found, stored.had_threat, stored.answered_threat) == (
        True,
        True,
        True,
    )


def test_nobody_records_without_an_account(anon_client):
    assert moment(anon_client).status_code == 401


def test_the_candidate_count_is_checked(client):
    assert moment(client, candidates=0).status_code == 422
    assert moment(client, candidates=4).status_code == 422


def test_an_answer_without_a_threat_is_not_kept(client, db_session):
    response = moment(client, had_threat=False, answered_threat=True)
    assert db_session.get(CriticalMoment, response.json()["id"]).answered_threat is None


def test_progress_counts_the_moments_found_and_the_threats_answered(client):
    moment(client, found=True, had_threat=True, answered_threat=True)
    moment(client, found=False, had_threat=True, answered_threat=False)
    moment(client, found=True, had_threat=False, answered_threat=None)

    thinking = client.get("/progress").json()["thinking"]
    assert thinking == {
        "moments": 3,
        "found": 2,
        "threats": 2,
        "answered": 1,
        "recent": [True, False, True],
    }


def test_progress_counts_only_the_window(client, db_session, signed_in_user):
    db_session.add(
        CriticalMoment(
            user_id=signed_in_user.id, fen=FEN, found=False, candidates=2,
            created_at=datetime.now(timezone.utc) - timedelta(days=40),
        )
    )  # fmt: skip
    db_session.commit()
    moment(client, found=True)

    assert (
        client.get("/progress", params={"days": 30}).json()["thinking"]["moments"] == 1
    )
    assert client.get("/progress").json()["thinking"]["moments"] == 2
