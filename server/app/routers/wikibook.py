"""Wikibooks opening-theory pages for the Review screen's WikiBook panel."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import wikibook
from app.db import get_db
from app.schemas import WikibookLineOut, WikibookPageOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/wikibook", tags=["wikibook"])


@router.get("/line", response_model=WikibookLineOut)
def get_line(
    moves: str = Query(..., description="comma-separated SAN, e.g. e4,e5,Nf3"),
    db: Session = Depends(get_db),
) -> WikibookLineOut:
    """Theory pages for every prefix of the move sequence, stopping at the
    first line Wikibooks doesn't cover. Failures are soft — upstream trouble
    just truncates the walk, so the panel shows what's known so far."""
    sans = [san for san in moves.split(",") if san]
    if not sans:
        raise HTTPException(status_code=422, detail="moves must not be empty")
    if not all(wikibook.valid_san(san) for san in sans):
        raise HTTPException(status_code=422, detail="moves must be SAN")

    pages: list[WikibookPageOut] = []
    if not wikibook.enabled():
        return WikibookLineOut(pages=pages)
    for ply in range(1, min(len(sans), wikibook.MAX_PLIES) + 1):
        try:
            row = wikibook.lookup(db, sans[:ply])
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
