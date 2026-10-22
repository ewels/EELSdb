from export_accounts import classify, php_unserialize, summarise

BASE = dict(display_name="Jane Smith", registered="2015-03-01 10:00:00", is_admin=False, owns_spectra=False,
            old_forum_posts=0, new_forum_posts=0, spam_submissions_only=False, favourites=[])


def test_php_unserialize():
    assert php_unserialize('a:2:{i:0;s:5:"21525";i:1;i:21526;}') == ["21525", 21526]
    assert php_unserialize('a:1:{s:13:"administrator";b:1;}') == {"administrator": True}
    assert php_unserialize('s:5:"Ångs";') == "Ångs"
    assert php_unserialize("") is None
    assert php_unserialize("not php") is None


def test_classify_rules():
    assert classify(BASE) == ("keep", "older")
    assert classify({**BASE, "registered": "2024-05-01", "owns_spectra": True}) == ("keep", "contributor")
    assert classify({**BASE, "is_admin": True, "display_name": "qWertyuiop asdfghjkl"})[0] == "keep"
    assert classify({**BASE, "display_name": "mRGzrhtYBINLDti iCCvOWZixW"}) == ("drop", "spam")
    assert classify({**BASE, "display_name": "Abcdefgh Ijklmnop"}) == ("keep", "older")  # no [a-z][A-Z]
    assert classify({**BASE, "new_forum_posts": 1}) == ("drop", "spam")
    assert classify({**BASE, "spam_submissions_only": True}) == ("drop", "spam")
    assert classify({**BASE, "registered": "2024-02-02", "favourites": [1]}) == ("review", "newer with favourites")
    assert classify({**BASE, "registered": "2025-02-02"}) == ("review", "newer, no activity")


def test_summarise():
    meta = {"QUnCYkNw_capabilities": 'a:1:{s:10:"subscriber";b:1;}', "eelsdb_favourites": ["21525", 'a:1:{i:0;s:5:"21526";}', "21525"]}
    posts = [
        {"post_type": "spectra", "post_status": "pending", "day": "2025-01-01", "ID": "9"},
        {"post_type": "reply", "post_status": "publish", "day": "2019-01-01", "ID": "10"},
    ]
    s = summarise({"display_name": "X", "user_registered": "2015-01-01"}, meta, posts)
    assert s["favourites"] == [21525, 21526]
    assert s["spam_submissions_only"] and not s["owns_spectra"] and s["old_forum_posts"] == 1
