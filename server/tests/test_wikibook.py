"""Wikibooks opening-theory lookup: title building, HTML sanitizing, and the
/wikibook/line walk with its cache. All upstream calls are mocked — the
autouse conftest kill-switch is re-enabled per test via _wikibook_on."""

import pytest

from app import wikibook
from app.models import WikibookCache

pytestmark = pytest.mark.unit


# --- page titles ------------------------------------------------------------


def test_page_title_alternates_white_and_black_notation():
    assert wikibook.page_title(["e4"]) == "Chess Opening Theory/1. e4"
    assert (
        wikibook.page_title(["d4", "d5", "c4"])
        == "Chess Opening Theory/1. d4/1...d5/2. c4"
    )


def test_page_url_underscores_and_escapes():
    assert wikibook.page_url("Chess Opening Theory/1. e4/1...e5") == (
        "https://en.wikibooks.org/wiki/Chess_Opening_Theory/1._e4/1...e5"
    )


def test_valid_san_accepts_real_moves_and_rejects_junk():
    for san in ["e4", "Nf3", "O-O", "O-O-O", "exd5", "e8=Q", "Bb5+", "Qxf7#"]:
        assert wikibook.valid_san(san), san
    for junk in ["", "e4 e5", "<script>", "1.e4", "a" * 9]:
        assert not wikibook.valid_san(junk), junk


# --- sanitizer --------------------------------------------------------------


def test_sanitize_keeps_prose_and_drops_chrome():
    html = (
        '<div class="mw-parser-output">'
        '<table class="wikitable"><tr><td>diagram</td></tr></table>'
        "<p>The <b>Queen's pawn</b> opening.</p>"
        '<script>alert("x")</script>'
        '<div class="toc"><ul><li>contents</li></ul></div>'
        "<h2>Control e4</h2><p>The chief approach.</p>"
        "</div>"
    )
    clean = wikibook.sanitize(html)
    assert clean == (
        "<p>The <b>Queen's pawn</b> opening.</p>"
        "<h2>Control e4</h2><p>The chief approach.</p>"
    )


def test_sanitize_drops_boilerplate_sections_and_citation_markers():
    """Statistics/Theory table/References/See also/External links trail every
    theory page — the panel keeps only the instructive prose. Inline [1]
    markers go too, since their targets are in the dropped References."""
    html = (
        '<p>Best by test.<sup class="reference"><a href="#cite_note-1">[1]</a></sup></p>'
        "<h2>Ideas</h2><p>Keep this plan.</p>"
        "<h2>Statistics</h2><p>46% of continuations.</p>"
        "<h2>Theory table</h2><p>1. e4</p><h3>All possible Black responses</h3><ul><li>rows</li></ul>"
        '<h2>References</h2><ul><li>↑ Fischer, Bobby (1969).</li></ul>'
        "<h2>See also</h2><ul><li>Batsford chess openings 2.</li></ul>"
        '<h2>External links</h2><ul><li><a href="https://www.365chess.com">365Chess</a></li></ul>'
    )
    assert wikibook.sanitize(html) == (
        "<p>Best by test.</p><h2>Ideas</h2><p>Keep this plan.</p>"
    )


def test_sanitize_drops_move_grid_and_orphaned_sections():
    """On root pages "All possible Black responses" is its own h2 whose body
    is a table the sanitizer strips — the heading must not survive alone,
    and neither may any other heading left with an empty body."""
    html = (
        "<h2>Ideas</h2><p>Keep this plan.</p>"
        "<h2>All possible Black responses</h2><table><tr><td>grid</td></tr></table>"
        '<h2>Illustrative games</h2><div class="thumb">only chrome</div>'
    )
    assert wikibook.sanitize(html) == "<h2>Ideas</h2><p>Keep this plan.</p>"


def test_sanitize_rewrites_wiki_links_and_unwraps_fragments():
    html = '<p><a href="/wiki/Chess">chess</a> and <a href="#note">note</a></p>'
    clean = wikibook.sanitize(html)
    assert (
        '<a href="https://en.wikibooks.org/wiki/Chess" target="_blank" '
        'rel="noopener">chess</a>' in clean
    )
    assert "note</p>" in clean and "#note" not in clean


def test_sanitize_drops_images_and_escapes_text():
    clean = wikibook.sanitize('<p><img src="x.png">1 &lt; 2 &amp; so</p>')
    assert clean == "<p>1 &lt; 2 &amp; so</p>"


def test_sanitize_survives_nested_dropped_subtrees():
    html = "<table><tr><td><table><tr><td>inner</td></tr></table></td></tr></table><p>after</p>"
    assert wikibook.sanitize(html) == "<p>after</p>"


def test_sanitize_drops_footer_navbox():
    """The Chess Opening Theory footer is an unclassed inline-styled <div>
    wrapping bucket-branch/bucket-leaf/hlist divs — none of it may leak."""
    html = (
        "<p>prose</p>"
        '<div style="display:grid;border:1px #ddd solid;">'
        '<div style="background-color:darkslategrey;">'
        '<div style="float:left;"><a href="/wiki/Template:X">v</a> · t · e</div>'
        "Chess Opening Theory</div>"
        '<div class="bucket-branch"><div class="bucket-leaf">'
        '<a href="/wiki/Chess_Opening_Theory/1._e4">1. e4</a></div></div>'
        '<div class="hlist"><ul><li>Berlin</li><li>Beverwijk</li></ul></div>'
        "</div>"
    )
    assert wikibook.sanitize(html) == "<p>prose</p>"


# --- /wikibook/line ---------------------------------------------------------


@pytest.fixture()
def _wikibook_on(monkeypatch):
    monkeypatch.setenv("LEECHESS_WIKIBOOK", "on")


def fake_fetch(book: dict[str, tuple[str, str]]):
    """fetch_page stub serving from a dict of title → (title, html)."""

    def fetch(title: str):
        return book.get(title)

    return fetch


THEORY = {
    "Chess Opening Theory/1. e4": ("Chess Opening Theory/1. e4", "<p>King's pawn.</p>"),
    "Chess Opening Theory/1. e4/1...e5": (
        "Chess Opening Theory/1. e4/1...e5",
        "<p>Open game.</p>",
    ),
}


def test_line_walks_until_out_of_book(client, monkeypatch, _wikibook_on):
    monkeypatch.setattr(wikibook, "fetch_page", fake_fetch(THEORY))
    response = client.get("/wikibook/line", params={"moves": "e4,e5,Nf3,Nc6"})
    assert response.status_code == 200
    pages = response.json()["pages"]
    assert [page["ply"] for page in pages] == [1, 2]
    assert pages[0]["html"] == "<p>King's pawn.</p>"
    assert pages[1]["url"] == (
        "https://en.wikibooks.org/wiki/Chess_Opening_Theory/1._e4/1...e5"
    )


def test_line_serves_repeat_requests_from_cache(
    client, db_session, monkeypatch, _wikibook_on
):
    calls: list[str] = []

    def counting_fetch(title: str):
        calls.append(title)
        return THEORY.get(title)

    monkeypatch.setattr(wikibook, "fetch_page", counting_fetch)
    assert client.get("/wikibook/line", params={"moves": "e4,e5"}).status_code == 200
    first = len(calls)
    assert client.get("/wikibook/line", params={"moves": "e4,e5"}).status_code == 200
    assert len(calls) == first  # second request never hit upstream
    # both the found pages and nothing else were cached
    assert db_session.query(WikibookCache).count() == 2


def test_line_refetches_rows_from_older_sanitizer(
    client, db_session, monkeypatch, _wikibook_on
):
    calls: list[str] = []

    def counting_fetch(title: str):
        calls.append(title)
        return THEORY.get(title)

    monkeypatch.setattr(wikibook, "fetch_page", counting_fetch)
    client.get("/wikibook/line", params={"moves": "e4"})
    row = db_session.get(WikibookCache, "Chess Opening Theory/1. e4")
    assert row.sanitizer_version == wikibook.SANITIZER_VERSION
    # a row sanitized by an older version (or pre-column NULL) is stale
    row.sanitizer_version = None
    db_session.commit()
    client.get("/wikibook/line", params={"moves": "e4"})
    assert len(calls) == 2  # refetched despite the cached row


def test_line_caches_out_of_book_negatively(client, db_session, monkeypatch, _wikibook_on):
    monkeypatch.setattr(wikibook, "fetch_page", fake_fetch(THEORY))
    client.get("/wikibook/line", params={"moves": "e4,e5,Nf3"})
    missing = db_session.get(WikibookCache, "Chess Opening Theory/1. e4/1...e5/2. Nf3")
    assert missing is not None and missing.html is None


def test_line_soft_fails_when_upstream_unavailable(client, monkeypatch, _wikibook_on):
    def broken_fetch(title: str):
        raise wikibook.WikibookUnavailable("boom")

    monkeypatch.setattr(wikibook, "fetch_page", broken_fetch)
    response = client.get("/wikibook/line", params={"moves": "e4,e5"})
    assert response.status_code == 200
    assert response.json()["pages"] == []


def test_line_rejects_non_san_input(client, _wikibook_on):
    assert (
        client.get("/wikibook/line", params={"moves": "e4,<script>"}).status_code == 422
    )
    assert client.get("/wikibook/line", params={"moves": ""}).status_code == 422


def test_line_disabled_by_kill_switch(client, monkeypatch):
    def exploding_fetch(title: str):  # pragma: no cover — must never run
        raise AssertionError("kill switch ignored")

    monkeypatch.setattr(wikibook, "fetch_page", exploding_fetch)
    response = client.get("/wikibook/line", params={"moves": "e4"})
    assert response.status_code == 200
    assert response.json()["pages"] == []
