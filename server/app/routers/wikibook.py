"""Wikibooks opening-theory pages for the Review screen's WikiBook panel."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import wikibook
from app.auth.backend import current_active_user
from app.auth.models import User
from app.db import get_db
from app.schemas import WikibookLineOut, WikibookPageOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/wikibook", tags=["wikibook"])


@router.get("/line", response_model=WikibookLineOut)
def get_line(
    moves: str = Query(..., description="comma-separated SAN, e.g. e4,e5,Nf3"),
    db: Session = Depends(get_db),
    _: User = Depends(current_active_user),
) -> WikibookLineOut:
    """Theory pages for every prefix of the move sequence, stopping at the
    first line Wikibooks doesn't cover. Failures are soft — upstream trouble
    just truncates the walk, so the panel shows what's known so far.

    Behind an account, which costs nothing: this only ever feeds the Review
    screen, and Review needs one anyway. Open, it was a way for anyone at all
    to make this server issue up to thirty sequential ten-second requests to
    Wikimedia — from leechess' address, against Wikimedia's rate limits — and
    to write a cache row per made-up line while doing it.
    """
    sans = [san for san in moves.split(",") if san]
    if not sans:
        raise HTTPException(status_code=422, detail="moves must not be empty")
    if not all(wikibook.valid_san(san) for san in sans):
        raise HTTPException(status_code=422, detail="moves must be SAN")

    pages: list[WikibookPageOut] = []
    if not wikibook.enabled():
        return WikibookLineOut(pages=pages)
    fetches_left = wikibook.MAX_FETCHES_PER_REQUEST
    for ply in range(1, min(len(sans), wikibook.MAX_PLIES) + 1):
        prefix = sans[:ply]
        row = wikibook.cached(db, prefix)
        if row is None:
            if fetches_left <= 0:
                # Budget spent and this ply is not cached yet. Stopping looks
                # the same to the panel as running out of book: it shows what
                # is known, and the next visit to this line fills in more.
                break
            fetches_left -= 1
            try:
                row = wikibook.lookup(db, prefix)
            except wikibook.WikibookUnavailable as exc:
                logger.warning("wikibooks unavailable at ply %d: %s", ply, exc)
                break
        if row.html is None or row.title is None:
            break  # out of book — deeper prefixes can't have pages either
        pages.append(
            WikibookPageOut(
                ply=ply,
                title=row.title,
                url=wikibook.page_url(row.title),
                html=row.html,
            )
        )
    return WikibookLineOut(pages=pages)
