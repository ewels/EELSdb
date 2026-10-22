# /// script
# requires-python = ">=3.12"
# dependencies = ["h5py", "numpy", "rosettasciio"]
# ///
"""Write a HyperSpy file for every seeded spectrum (migrated and Corex), as review does for new submissions.

Reads the cached files (download_files.py, corex.py), writes each `.hspy` under data/cache/files/ for R2 and
data/fixtures/hspy.json for build_seed.py.

    uv run python/hspy_files.py
"""

import hashlib
import json
import urllib.parse

from build_seed import API_FIXTURES, COREX, FIXTURES, TYPE_CODES, load, num
from eelsdb.io import read_any
from eelsdb.review import write_hspy
from record_api import ROOT

CACHE = ROOT / "data" / "cache" / "files"
FIXTURE = FIXTURES / "hspy.json"


def migrated():
    for s in load(API_FIXTURES / "spectra" / "all.json")["body"]:
        if "download_link" not in s:
            continue
        path = urllib.parse.unquote(urllib.parse.urlparse(s["download_link"]).path).lstrip("/")
        acq = {"beam_energy_kv": num(s.get("beamenergy"), "kV"), "convergence_mrad": num(s.get("convergence"), "mrad"),
               "collection_mrad": num(s.get("collection"), "mrad")}
        slug = s["permalink"].rstrip("/").rsplit("/", 1)[-1]
        yield s["id"], slug, s["title"], TYPE_CODES[s["type"]], path, acq, s.get("reference")


def corex():
    for r in load(COREX) if COREX.exists() else []:
        msa = next(f for f in r["files"] if f["role"] == "msa")
        yield r["id"], r["slug"], r["title"], "coreloss", msa["key"], {}, None


def main():
    records, missing = [], 0
    for sid, slug, title, type_, source, acq, reference in [*migrated(), *corex()]:
        if not (CACHE / source).exists():
            missing += 1
            continue
        sp = read_any(CACHE / source)
        key = f"files/{sid}/{slug}.hspy"
        path = CACHE / key
        path.parent.mkdir(parents=True, exist_ok=True)
        write_hspy(path, sp.energy, sp.intensity, title, acq, reference, eels=type_ != "xrayabs")
        data = path.read_bytes()
        records.append({"spectrum_id": sid, "key": key, "filename": path.name, "bytes": len(data),
                        "sha256": hashlib.sha256(data).hexdigest()})
    FIXTURE.write_text(json.dumps(records, indent=1) + "\n")
    print(f"{len(records)} HSPY files" + (f", {missing} sources missing (run download_files / corex)" if missing else ""))


if __name__ == "__main__":
    main()
