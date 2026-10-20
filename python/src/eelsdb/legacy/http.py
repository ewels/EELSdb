"""Polite read-only HTTP for the live site: GET only, at most 1 request per second."""

import time
import urllib.error
import urllib.request

USER_AGENT = "EELSdb-rewrite/0.1 (+https://github.com/ewels/EELSdb)"
MIN_INTERVAL_S = 1.0

_last_request = 0.0


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_follow = urllib.request.build_opener()
_no_follow = urllib.request.build_opener(_NoRedirect)


def get(url, follow_redirects=True):
    """Return (status, headers, body_bytes, final_url). HTTP errors are returned, not raised."""
    global _last_request
    wait = _last_request + MIN_INTERVAL_S - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last_request = time.monotonic()
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    opener = _follow if follow_redirects else _no_follow
    try:
        with opener.open(req, timeout=60) as res:
            return res.status, res.headers, res.read(), res.url
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read(), url
