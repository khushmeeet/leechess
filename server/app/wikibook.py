"""Wikibooks "Chess Opening Theory" lookup for the Review screen.

Wikibooks names its opening-theory pages after the move sequence —
Chess_Opening_Theory/1._d4/1...d5/2._c4 — so a game's opening line maps to
a chain of page titles, one per ply. The router walks that chain until the
first missing page ("out of book") and returns sanitized page HTML for each
ply on the way.

Pages are fetched from the MediaWiki API and cached in SQLite: found pages
until SANITIZER_VERSION moves (theory pages change on the order of years,
but sanitizer fixes must reach already-cached rows), missing pages for a
week (a line might get written). Wikimedia API etiquette per the
literature live-sync plan: descriptive User-Agent, maxlag=5, and the cache
keeps repeat traffic off their servers entirely.

LEECHESS_WIKIBOOK=off disables upstream fetching — both automated suites
set it so they can never hit the real Wikibooks API.

Content license: Wikibooks text is CC BY-SA; the client shows attribution
and a link back on every panel.
"""

import logging
import os
import re
from datetime import timedelta, timezone
from html import escape
from html.parser import HTMLParser
from urllib.parse import quote

import httpx
from sqlalchemy.orm import Session

from app.models import WikibookCache, utcnow

logger = logging.getLogger(__name__)

API_URL = "https://en.wikibooks.org/w/api.php"
ROOT = "Chess Opening Theory"
USER_AGENT = os.environ.get(
    "LEECHESS_WIKIBOOK_UA", "leechess/0.1 (personal chess study app)"
)

# Theory rarely runs past move 15; cap the walk so a 60-move game never
# probes 120 pages.
MAX_PLIES = 30
# A missing page might get written later — recheck weekly. Found pages are
# trusted forever.
MISSING_RECHECK = timedelta(days=7)

SAN_RE = re.compile(r"^[KQRBNa-h1-8xO\-=+#]{2,8}$")


class WikibookUnavailable(Exception):
    """Network/API failure — soft-fail, and never cached as 'missing'."""


def enabled() -> bool:
    return os.environ.get("LEECHESS_WIKIBOOK", "on").lower() != "off"


def valid_san(san: str) -> bool:
    return SAN_RE.fullmatch(san) is not None


def page_title(sans: list[str]) -> str:
    """Wikibooks page title for a move-sequence prefix: white plies read
    "1. e4", black plies "1...e5" (the space after White's dot is how the
    real page titles are written; MediaWiki treats space and underscore
    the same)."""
    segments = [ROOT]
    for index, san in enumerate(sans):
        number = index // 2 + 1
        segments.append(f"{number}. {san}" if index % 2 == 0 else f"{number}...{san}")
    return "/".join(segments)


def page_url(title: str) -> str:
    return "https://en.wikibooks.org/wiki/" + quote(title.replace(" ", "_"))


# --- HTML sanitizer ---------------------------------------------------------
#
# The MediaWiki parse API returns the page's full rendered HTML. Rebuild it
# keeping only harmless prose markup: the position-diagram template and
# theory table are dropped (the Review board already shows the position),
# unknown tags are unwrapped, and only http(s) hrefs survive on links.

# Bumped whenever the sanitizer's output changes — cached rows sanitized by
# an older version are refetched instead of served stale.
SANITIZER_VERSION = 4

KEEP_TAGS = {
    "p", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dt", "dd",
    "b", "strong", "i", "em", "code", "pre", "br", "blockquote", "sub", "sup",
}
DROP_WITH_CONTENT = {"script", "style", "table", "figure", "iframe", "form", "noscript"}
# bucket-branch/bucket-leaf/hlist: the Chess Opening Theory footer navbox is
# built from these (its outer wrapper is an unclassed styled <div>).
# reference: the inline [1] citation markers — their targets live in the
# References section, which _drop_sections removes.
DROP_CLASSES = {
    "mw-editsection", "noprint", "navbox", "navbar", "toc", "thumb", "gallery",
    "metadata", "hatnote", "bucket-branch", "bucket-leaf", "hlist", "reference",
}
VOID_TAGS = {"br", "img", "hr", "wbr", "input", "source", "meta", "link"}

# Boilerplate sections trailing every theory page — the panel wants the
# instructive prose, not the apparatus (the full page stays one click away
# via the attribution link).
DROP_SECTIONS = {
    "statistics", "theory table", "references", "notes", "see also",
    "external links", "bibliography", "further reading",
}
# "All possible Black responses" / "All possible White moves" … — the
# move-grid section, whose table body the sanitizer already strips.
DROP_SECTION_PREFIXES = ("all possible",)


def _rewrite_href(href: str) -> str | None:
    """Absolute http(s) URL for a link, or None to unwrap it."""
    if href.startswith("/wiki/"):
        return "https://en.wikibooks.org" + href
    if href.startswith("//"):
        return "https:" + href
    if href.startswith(("http://", "https://")):
        return href
    return None  # fragments, relative paths, javascript: …


class _Sanitizer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.skip_depth = 0  # >0 while inside a dropped subtree
        self.anchor_emitted: list[bool] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.skip_depth:
            if tag not in VOID_TAGS:
                self.skip_depth += 1
            return
        attributes = dict(attrs)
        classes = set((attributes.get("class") or "").split())
        # Inline-styled divs are always template chrome on these pages (the
        # footer navbox wrapper, position-diagram scaffolding) — prose divs
        # never carry a style attribute.
        if (
            tag in DROP_WITH_CONTENT
            or classes & DROP_CLASSES
            or (tag == "div" and attributes.get("style"))
        ):
            if tag not in VOID_TAGS:
                self.skip_depth = 1
            return
        if tag == "a":
            href = _rewrite_href(dict(attrs).get("href") or "")
            if href is not None:
                self.out.append(
                    f'<a href="{escape(href)}" target="_blank" rel="noopener">'
                )
            self.anchor_emitted.append(href is not None)
        elif tag in KEEP_TAGS:
            self.out.append(f"<{tag}>")
        # anything else (div, span, img, …) is unwrapped or dropped

    def handle_endtag(self, tag: str) -> None:
        if self.skip_depth:
            if tag not in VOID_TAGS:
                self.skip_depth -= 1
            return
        if tag == "a":
            if self.anchor_emitted and self.anchor_emitted.pop():
                self.out.append("</a>")
        elif tag in KEEP_TAGS and tag not in VOID_TAGS:
            self.out.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if not self.skip_depth:
            self.out.append(escape(data, quote=False))


def _drop_sections(html: str) -> str:
    """Remove whole <h2>-delimited sections whose title is boilerplate.
    Runs on sanitized output, where headings are flat <h2>text</h2> and
    subsections (h3+) sit inside their parent section's body."""
    parts = re.split(r"(<h2>.*?</h2>)", html)
    kept = [parts[0]]
    for heading, body in zip(parts[1::2], parts[2::2]):
        title = re.sub(r"<[^>]+>", "", heading).strip().lower()
        if title in DROP_SECTIONS or title.startswith(DROP_SECTION_PREFIXES):
            continue
        if not re.sub(r"<br>|\s", "", body):
            continue  # the section's content was all chrome — orphan heading
        kept.append(heading + body)
    return "".join(kept)


def sanitize(html: str) -> str:
    parser = _Sanitizer()
    parser.feed(html)
    parser.close()
    # Collapse the empty paragraphs MediaWiki templates leave behind.
    clean = re.sub(r"<p>(?:\s|<br>)*</p>", "", "".join(parser.out))
    return _drop_sections(clean).strip()


# --- Fetching + cache -------------------------------------------------------


def fetch_page(title: str) -> tuple[str, str] | None:
    """(resolved title, sanitized html) from the MediaWiki API, or None when
    the page doesn't exist. Raises WikibookUnavailable on network/API
    trouble so transient failures are never cached as 'missing'."""
    try:
        response = httpx.get(
            API_URL,
            params={
                "action": "parse",
                "page": title,
                "prop": "text",
                "redirects": 1,  # transposition pages redirect to the main line
                "disableeditsection": 1,
                "format": "json",
                "formatversion": 2,
                "maxlag": 5,
            },
            headers={"User-Agent": USER_AGENT},
            timeout=10.0,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise WikibookUnavailable(str(exc)) from exc
    if "error" in payload:
        if payload["error"].get("code") == "missingtitle":
            return None
        raise WikibookUnavailable(payload["error"].get("code", "unknown API error"))
    parse = payload["parse"]
    return parse["title"], sanitize(parse["text"])


def lookup(db: Session, sans: list[str]) -> WikibookCache:
    """Cached row for one move-sequence prefix, fetching on miss. A row with
    html=None means Wikibooks has no page for this line."""
    path = page_title(sans)
    row = db.get(WikibookCache, path)
    if row is not None:
        fetched = row.fetched_at
        if fetched.tzinfo is None:  # SQLite returns naive datetimes
            fetched = fetched.replace(tzinfo=timezone.utc)
        fresh = (
            row.sanitizer_version == SANITIZER_VERSION  # else re-sanitize
            if row.html is not None
            else utcnow() - fetched < MISSING_RECHECK
        )
        if fresh:
            return row
        db.delete(row)  # stale negative or outdated sanitize — refetch
        db.flush()

    result = fetch_page(path)
    if result is None and any(san[-1] in "+#" for san in sans):
        # Some pages omit check/mate suffixes from the title.
        result = fetch_page(page_title([san.rstrip("+#") for san in sans]))
    title, html = result if result is not None else (None, None)
    row = WikibookCache(
        path=path,
        title=title,
        html=html,
        fetched_at=utcnow(),
        sanitizer_version=SANITIZER_VERSION,
    )
    db.add(row)
    db.commit()
    return row
