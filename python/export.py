# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Bulk export: one zip with every public spectrum file and its API v2 metadata, built from the public API.

    uv run python/export.py [--out eelsdb-spectra.zip] [--api http://api.localhost:8787]

An admin then uploads the zip on the moderation page, for /downloads/.
"""

import argparse
import json
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.eelsdb.eu"

README = """# EELS Data Base: all public spectra

Exported {date} from {api} ({count} spectra).

- `metadata.json`: every spectrum as returned by API v2 ({api}/v2/spectra), including
  where each acquisition value came from.
- `spectra/{{id}}-{{slug}}/`: the data files of each spectrum.

Licence: spectra are open data under the Open Data Commons Open Database Licence (ODbL),
unless a spectrum's `licence` field says otherwise. Credit the contributors and the EELS Data Base:

Philip Ewels, Thierry Sikora, Virginie Serin, Chris P. Ewels and Luc Lajaunie. "A Complete Overhaul
of the Electron Energy-Loss Spectroscopy and X-Ray Absorption Spectroscopy Database: eelsdb.eu."
Microscopy and Microanalysis 22, 717-724 (2016). doi:10.1017/S1431927616000179
"""


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "EELSdb-export (+https://github.com/ewels/EELSdb)"})
    with urllib.request.urlopen(req, timeout=120) as res:
        return res.read()


def all_spectra(api, fetcher=fetch):
    url = f"{api}/v2/spectra?per_page=500&sort=id"
    out = []
    while url:
        page = json.loads(fetcher(url))
        out += page["results"]
        url = page["next"]
    return out


def build(dest, api=API, fetcher=fetch, site=None):
    """Write the archive to `dest`; returns the number of spectra."""
    api = api.rstrip("/")
    spectra = all_spectra(api, fetcher)
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for s in spectra:
            folder = f"spectra/{s['id']}-{Path(s['slug']).name}"
            used = set()
            for f in s["files"]:
                url = f["url"]
                # The stored file name, never the uploader's: it becomes a path inside the archive.
                name = Path(urllib.parse.unquote(urllib.parse.urlparse(url).path)).name or "file"
                if name in used:
                    name = f"{f['role']}-{name}"
                used.add(name)
                if site:
                    # A local Worker serves files at its own address, not at eelsdb.eu.
                    url = site + urllib.parse.urlparse(url).path
                z.writestr(f"{folder}/{name}", fetcher(url))
        z.writestr("metadata.json", json.dumps(spectra, indent=1, ensure_ascii=False))
        date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        z.writestr("README.md", README.format(date=date, api=api, count=len(spectra)))
    return len(spectra)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--out", default="eelsdb-spectra.zip")
    parser.add_argument("--api", default=API)
    args = parser.parse_args()
    api = args.api.rstrip("/")
    site = api.replace("://api.", "://", 1)
    count = build(args.out, api, site=site if "localhost" in site else None)
    print(f"{args.out}: {count} spectra, {Path(args.out).stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
