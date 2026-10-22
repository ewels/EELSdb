"""exspy.data.eelsdb() against a local Worker must return the same spectra as against the live site.

Skipped unless EELSDB_API is set, for example:

    cd worker && npm run seed && npm run dev
    EELSDB_API=http://api.localhost:8787 uv run pytest tests/test_exspy_against_worker.py

EELSDB_SITE (default: EELSDB_API without "api.") serves the spectrum files. Live requests are limited to
1 per second with an honest User-Agent.
"""

import os
import time

import numpy as np
import pytest

API = os.environ.get("EELSDB_API")
pytestmark = pytest.mark.skipif(not API, reason="EELSDB_API is not set")

QUERIES = [
    {"formula": "B4C"},
    {"formula": "MgO", "spectrum_type": "lowloss"},
    {"element": ["Fe", "O"], "spectrum_type": "coreloss", "max_energy": "750"},
]


def run_eelsdb(monkeypatch, local, **query):
    import requests
    from exspy.data import eelsdb

    from http import USER_AGENT

    site = os.environ.get("EELSDB_SITE", API.replace("://api.", "://") if API else "")
    real_get = requests.get
    last = [0.0]

    def get(url, *args, headers=None, **kwargs):
        if local:
            url = url.replace("https://api.eelsdb.eu", API).replace("https://eelsdb.eu", site)
        else:
            time.sleep(max(0.0, last[0] + 1 - time.monotonic()))
            last[0] = time.monotonic()
        return real_get(url, *args, headers={"User-Agent": USER_AGENT}, **kwargs)

    monkeypatch.setattr(requests, "get", get)
    return eelsdb(show_progressbar=False, **query)


@pytest.mark.parametrize("query", QUERIES, ids=lambda q: ",".join(f"{k}={v}" for k, v in q.items()))
def test_same_spectra_as_live(monkeypatch, query):
    local = run_eelsdb(monkeypatch, True, **query)
    live = run_eelsdb(monkeypatch, False, **query)
    assert len(local) == len(live) > 0
    for a, b in zip(local, live):
        assert a.metadata.General.title == b.metadata.General.title
        assert a.original_metadata.json.as_dictionary() == b.original_metadata.json.as_dictionary()
        assert a.axes_manager[0].offset == b.axes_manager[0].offset
        assert a.axes_manager[0].scale == b.axes_manager[0].scale
        np.testing.assert_array_equal(a.data, b.data)
